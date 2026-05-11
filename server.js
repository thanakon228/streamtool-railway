const express  = require("express");
const cors     = require("cors");
const admin    = require("firebase-admin");
const { WebcastPushConnection } = require("tiktok-live-connector");

// ── Firebase Admin ────────────────────────────────────────────────────────────
const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!svcJson) { console.error("FIREBASE_SERVICE_ACCOUNT is required"); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svcJson)) });
const db = admin.firestore();

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

// ── Helpers ───────────────────────────────────────────────────────────────────
async function verifyAuth(req) {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return null;
  try { return await admin.auth().verifyIdToken(token); } catch { return null; }
}

async function getUserConfig(uid) {
  const snap = await db.doc(`users/${uid}/config/main`).get();
  return snap.exists ? snap.data() : null;
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "3.0.0-railway", youtube: ytPollers.size, tiktok: tiktokConns.size });
});

// ── Register Overlay ──────────────────────────────────────────────────────────
app.post("/api/registerOverlay", async (req, res) => {
  const decoded = await verifyAuth(req);
  if (!decoded) return res.status(401).json({ error: "Unauthorized" });

  const configSnap = await db.doc(`users/${decoded.uid}/config/main`).get();
  if (!configSnap.exists) return res.status(404).json({ error: "Config not found" });

  const { overlayId } = configSnap.data();
  if (!overlayId) return res.status(400).json({ error: "No overlayId" });

  await db.doc(`overlayTokens/${overlayId}`).set({
    uid: decoded.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// YOUTUBE
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/startYouTubeChat", async (req, res) => {
  const decoded = await verifyAuth(req);
  if (!decoded) return res.status(401).json({ error: "Unauthorized" });

  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: "videoId required" });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "YOUTUBE_API_KEY not configured" });

  try {
    const videoRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`
    );
    const videoData = await videoRes.json();
    const liveChatId = videoData.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) return res.status(404).json({ error: "ไม่พบ live chat — ตรวจสอบ Video ID" });

    const sessionData = {
      videoId, liveChatId, nextPageToken: null, active: true,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.doc(`users/${decoded.uid}/sessions/youtube`).set(sessionData);
    await db.doc(`activeSessions/${decoded.uid}`).set(
      { uid: decoded.uid, youtube: sessionData }, { merge: true }
    );
    // onSnapshot จะ trigger startYouTubePoller อัตโนมัติ
    res.json({ ok: true, liveChatId });
  } catch (e) {
    console.error("startYouTubeChat:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/stopYouTubeChat", async (req, res) => {
  const decoded = await verifyAuth(req);
  if (!decoded) return res.status(401).json({ error: "Unauthorized" });
  const uid = decoded.uid;
  await db.doc(`users/${uid}/sessions/youtube`).set(
    { active: false, stoppedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
  );
  await db.doc(`activeSessions/${uid}`).set({ youtube: { active: false } }, { merge: true });
  stopYouTubePoller(uid);
  res.json({ ok: true });
});

// ── YouTube poller (per-user setTimeout loop) ─────────────────────────────────
const ytPollers = new Map(); // uid → timeoutId

async function fetchYouTubeChatPage(uid) {
  const sessionSnap = await db.doc(`activeSessions/${uid}`).get();
  if (!sessionSnap.exists) return 5000;
  const session = sessionSnap.data()?.youtube;
  if (!session?.active) return null; // signal to stop

  const config = await getUserConfig(uid);
  if (!config?.overlayId) return 5000;

  const apiKey = process.env.YOUTUBE_API_KEY;
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", session.liveChatId);
    url.searchParams.set("part", "snippet,authorDetails");
    url.searchParams.set("key", apiKey);
    if (session.nextPageToken) url.searchParams.set("pageToken", session.nextPageToken);

    const resp  = await fetch(url.toString());
    const data  = await resp.json();

    if (data.error) { console.error("YouTube API:", data.error.message); return 5000; }

    const { nextPageToken, items = [], pollingIntervalMillis = 5000 } = data;
    const isFirstPoll = !session.nextPageToken;

    await db.doc(`activeSessions/${uid}`).set(
      { youtube: { nextPageToken, pollingIntervalMillis } }, { merge: true }
    );

    if (!isFirstPoll && items.length > 0) {
      const batch = db.batch();
      for (const item of items) {
        const msg = {
          platform: "youtube",
          displayName: item.authorDetails.displayName,
          message: item.snippet.displayMessage,
          authorChannelId: item.authorDetails.channelId,
          sentAt: item.snippet.publishedAt,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        batch.set(db.doc(`overlays/${config.overlayId}/chatMessages/${item.id}`), msg);
        batch.set(db.doc(`users/${uid}/chatMessages/${item.id}`), msg);
      }
      await batch.commit();
    }
    return Math.max(pollingIntervalMillis, 2000);
  } catch (e) {
    console.error(`fetchYouTubeChatPage uid=${uid}:`, e.message);
    return 5000;
  }
}

function startYouTubePoller(uid) {
  if (ytPollers.has(uid)) return;
  console.log(`YouTube poller start uid=${uid}`);

  const tick = async () => {
    const interval = await fetchYouTubeChatPage(uid);
    if (interval === null) { ytPollers.delete(uid); return; } // session inactive
    ytPollers.set(uid, setTimeout(tick, interval));
  };
  ytPollers.set(uid, setTimeout(tick, 0));
}

function stopYouTubePoller(uid) {
  const id = ytPollers.get(uid);
  if (id) { clearTimeout(id); ytPollers.delete(uid); console.log(`YouTube poller stop uid=${uid}`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIKTOK
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/startTikTokChat", async (req, res) => {
  const decoded = await verifyAuth(req);
  if (!decoded) return res.status(401).json({ error: "Unauthorized" });

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "username required" });

  const tiktokData = { username, active: true, startedAt: admin.firestore.FieldValue.serverTimestamp() };
  await db.doc(`users/${decoded.uid}/sessions/tiktok`).set(tiktokData);
  await db.doc(`activeSessions/${decoded.uid}`).set(
    { uid: decoded.uid, tiktok: tiktokData }, { merge: true }
  );
  res.json({ ok: true });
});

app.post("/api/stopTikTokChat", async (req, res) => {
  const decoded = await verifyAuth(req);
  if (!decoded) return res.status(401).json({ error: "Unauthorized" });
  const uid = decoded.uid;
  await db.doc(`users/${uid}/sessions/tiktok`).set(
    { active: false, stoppedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }
  );
  await db.doc(`activeSessions/${uid}`).set({ tiktok: { active: false } }, { merge: true });
  stopTikTokConnection(uid);
  res.json({ ok: true });
});

// ── TikTok persistent connection manager ──────────────────────────────────────
const tiktokConns = new Map(); // uid → WebcastPushConnection

async function startTikTokConnection(uid, username) {
  if (tiktokConns.has(uid)) return;

  const config = await getUserConfig(uid);
  if (!config?.overlayId) { console.error(`No overlayId uid=${uid}`); return; }

  const overlayId  = config.overlayId;
  const connectedAt = Date.now();
  const sessionId  = process.env.TIKTOK_SESSION_ID || null;

  const conn = new WebcastPushConnection(username, {
    ...(sessionId ? { sessionId } : {}),
    requestPollingIntervalMs: 2000,
    enableExtendedGiftInfo: false,
  });

  conn.on("chat", async (data) => {
    let msgTime = Date.now();
    if (data?.createTime != null) {
      const t = Number(data.createTime);
      if (Number.isFinite(t) && t > 0) msgTime = t > 1e12 ? t : t * 1000;
    }
    if (msgTime < connectedAt - 3000) return;

    const msgId = `${data.userId}_${data.createTime || msgTime}`;
    const msg = {
      platform: "tiktok",
      displayName: data.nickname || data.uniqueId || "viewer",
      message: data.comment || "",
      userId: String(data.userId || ""),
      sentAt: new Date(msgTime).toISOString(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await Promise.all([
        db.doc(`overlays/${overlayId}/chatMessages/${msgId}`).set(msg, { merge: true }),
        db.doc(`users/${uid}/chatMessages/${msgId}`).set(msg, { merge: true }),
      ]);
    } catch (e) { console.error(`TikTok write uid=${uid}:`, e.message); }
  });

  conn.on("disconnected", () => {
    tiktokConns.delete(uid);
    console.log(`TikTok disconnected uid=${uid}, retry in 5s`);
    setTimeout(async () => {
      const snap = await db.doc(`activeSessions/${uid}`).get();
      if (snap.exists && snap.data()?.tiktok?.active) {
        startTikTokConnection(uid, snap.data().tiktok.username);
      }
    }, 5000);
  });

  conn.on("error", (err) => console.error(`TikTok error uid=${uid}:`, err?.message || err));

  try {
    await conn.connect();
    tiktokConns.set(uid, conn);
    console.log(`TikTok connected uid=${uid} (@${username})`);
  } catch (e) {
    console.error(`TikTok connect failed uid=${uid}:`, e.message);
  }
}

async function stopTikTokConnection(uid) {
  const conn = tiktokConns.get(uid);
  if (!conn) return;
  try { await conn.disconnect(); } catch {}
  tiktokConns.delete(uid);
  console.log(`TikTok stopped uid=${uid}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DONATE
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/donate", async (req, res) => {
  const decoded = await verifyAuth(req);
  if (!decoded) return res.status(401).json({ error: "Unauthorized" });

  const { base64, url, payload, message, displayName, remark } = req.body || {};
  const apiKey = process.env.EASYSLIP_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "EASYSLIP_API_KEY not configured" });

  if ([base64, url, payload].filter(Boolean).length !== 1)
    return res.status(400).json({ error: "Provide exactly one of: base64, url, payload" });

  const verifyBody = { checkDuplicate: true, remark: remark || `uid:${decoded.uid}` };
  if (base64) verifyBody.base64 = base64.startsWith("data:image/") ? base64 : `data:image/jpeg;base64,${base64}`;
  if (url)    verifyBody.url     = String(url).trim();
  if (payload) verifyBody.payload = String(payload).trim();

  try {
    const resp = await fetch("https://api.easyslip.com/v2/verify/bank", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(verifyBody),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) return res.status(400).json({ error: data?.error?.message || `EasySlip ${resp.status}` });
    if (!data?.success) return res.status(400).json({ error: data?.error?.message || "Verify failed" });

    const transRef = data?.data?.rawSlip?.transRef;
    const amount   = data?.data?.amountInSlip ?? data?.data?.rawSlip?.amount?.amount;
    if (!transRef) return res.status(500).json({ error: "Missing transRef" });

    const config = await getUserConfig(decoded.uid);
    if (!config?.overlayId) return res.status(400).json({ error: "No overlayId" });

    const donorName = displayName || decoded.name || decoded.email || "donor";
    const donationDoc = db.doc(`users/${decoded.uid}/donations/${transRef}`);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(donationDoc)).exists)
        throw Object.assign(new Error("Duplicate slip"), { code: "DUPLICATE_SLIP" });
      tx.set(donationDoc, {
        overlayId: config.overlayId, slipId: transRef,
        amount: Number(amount || 0), displayName: donorName,
        message: message || "", provider: "easyslip",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        easyslip: data?.data || null,
      });
    });

    // Overlay alert
    await db.doc(`overlays/${config.overlayId}/alerts/${transRef}`).set({
      displayName: donorName, amount: Number(amount || 0),
      message: message || "", provider: "easyslip", slipId: transRef,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ ok: true, slipId: transRef, amount: Number(amount || 0) });
  } catch (e) {
    if (e?.code === "DUPLICATE_SLIP") return res.status(409).json({ error: "Duplicate slip" });
    console.error("donate:", e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Firestore listener: เปิด/ปิด connection ตาม activeSessions
// ═══════════════════════════════════════════════════════════════════════════════
db.collection("activeSessions").onSnapshot((snap) => {
  snap.docChanges().forEach((change) => {
    const uid  = change.doc.id;
    const data = change.doc.data();

    // TikTok
    if (data.tiktok?.active && !tiktokConns.has(uid))
      startTikTokConnection(uid, data.tiktok.username);
    else if (!data.tiktok?.active && tiktokConns.has(uid))
      stopTikTokConnection(uid);

    // YouTube
    if (data.youtube?.active && !ytPollers.has(uid))
      startYouTubePoller(uid);
    else if (!data.youtube?.active && ytPollers.has(uid))
      stopYouTubePoller(uid);
  });
}, (err) => console.error("activeSessions listener:", err));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StreamTool Railway server on port ${PORT}`));

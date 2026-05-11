const express  = require("express");
const http     = require("http");
const { Server } = require("socket.io");
const cors     = require("cors");
const jwt      = require("jsonwebtoken");
const fs       = require("fs");
const path     = require("path");
const { WebcastPushConnection } = require("tiktok-live-connector");

// ── Config ────────────────────────────────────────────────────────────────────
const PASSWORD      = process.env.DASHBOARD_PASSWORD || "admin123";
const JWT_SECRET    = process.env.JWT_SECRET         || "change-this-secret";
const OVERLAY_ID    = process.env.OVERLAY_ID         || "default-overlay";
const YT_KEY        = process.env.YOUTUBE_API_KEY    || "";
const EASYSLIP_KEY  = process.env.EASYSLIP_API_KEY   || "";
const TT_SESSION    = process.env.TIKTOK_SESSION_ID  || null;

// ── Express + Socket.IO ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/dashboard", (_, res) => res.sendFile(path.join(__dirname, "public/dashboard.html")));
app.get("/overlay/*", (_, res) => res.sendFile(path.join(__dirname, "public/overlay/index.html")));

// ── Data persistence ──────────────────────────────────────────────────────────
const DONATIONS_FILE = path.join(__dirname, "donations.json");
const SESSIONS_FILE  = path.join(__dirname, "sessions.json");

let donations = [];
try { donations = JSON.parse(fs.readFileSync(DONATIONS_FILE, "utf8")); } catch {}

let savedSessions = { youtube: null, tiktok: null };
try { savedSessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")); } catch {}

function saveDonations() {
  fs.writeFileSync(DONATIONS_FILE, JSON.stringify(donations, null, 2));
}
function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ youtube: ytSession, tiktok: ttSession }, null, 2));
}

// ── In-memory session state ───────────────────────────────────────────────────
let ytSession = null;
let ttSession = null;

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid token" }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/health", (_, res) => res.json({
  status: "ok", youtube: !!ytPoller, tiktok: tiktokConns.size,
}));

// Login
app.post("/api/login", (req, res) => {
  if (req.body.password !== PASSWORD)
    return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  const token = jwt.sign({ role: "streamer" }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ ok: true, token, overlayId: OVERLAY_ID });
});

// Session state
app.get("/api/session", auth, (_, res) => res.json({
  youtube: { active: ytSession?.active || false, videoId: ytSession?.videoId || "" },
  tiktok:  { active: ttSession?.active || false, username: ttSession?.username || "" },
  overlayId: OVERLAY_ID,
}));

// Donations list
app.get("/api/donations", auth, (_, res) => res.json(donations));

// ── YouTube ───────────────────────────────────────────────────────────────────
app.post("/api/startYouTubeChat", auth, async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: "videoId required" });
  if (!YT_KEY)  return res.status(503).json({ error: "YOUTUBE_API_KEY not set" });

  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${YT_KEY}`
    );
    const d = await r.json();
    const liveChatId = d.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) return res.status(404).json({ error: "ไม่พบ live chat — ตรวจสอบ Video ID" });

    ytSession = { videoId, liveChatId, nextPageToken: null, active: true };
    saveSessions();
    startYouTubePoller();
    io.to("dashboard").emit("session", { youtube: { active: true, videoId } });
    res.json({ ok: true, liveChatId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/stopYouTubeChat", auth, (_, res) => {
  if (ytSession) ytSession.active = false;
  stopYouTubePoller();
  saveSessions();
  io.to("dashboard").emit("session", { youtube: { active: false, videoId: "" } });
  res.json({ ok: true });
});

// ── TikTok ────────────────────────────────────────────────────────────────────
app.post("/api/startTikTokChat", auth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "username required" });
  ttSession = { username, active: true };
  saveSessions();
  startTikTokConnection(username);
  io.to("dashboard").emit("session", { tiktok: { active: true, username } });
  res.json({ ok: true });
});

app.post("/api/stopTikTokChat", auth, (_, res) => {
  if (ttSession) ttSession.active = false;
  stopTikTokConnection();
  saveSessions();
  io.to("dashboard").emit("session", { tiktok: { active: false, username: "" } });
  res.json({ ok: true });
});

// ── Donate ────────────────────────────────────────────────────────────────────
app.post("/api/donate", auth, async (req, res) => {
  const { base64, url, payload, message, displayName } = req.body || {};
  if (!EASYSLIP_KEY) return res.status(503).json({ error: "EASYSLIP_API_KEY not set" });
  if ([base64, url, payload].filter(Boolean).length !== 1)
    return res.status(400).json({ error: "Provide exactly one of: base64, url, payload" });

  const body = { checkDuplicate: true };
  if (base64)  body.base64  = base64.startsWith("data:image/") ? base64 : `data:image/jpeg;base64,${base64}`;
  if (url)     body.url     = String(url).trim();
  if (payload) body.payload = String(payload).trim();

  try {
    const r = await fetch("https://api.easyslip.com/v2/verify/bank", {
      method: "POST",
      headers: { Authorization: `Bearer ${EASYSLIP_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok)       return res.status(400).json({ error: d?.error?.message || `EasySlip ${r.status}` });
    if (!d?.success) return res.status(400).json({ error: d?.error?.message || "Verify failed" });

    const transRef = d?.data?.rawSlip?.transRef;
    const amount   = d?.data?.amountInSlip ?? d?.data?.rawSlip?.amount?.amount;
    if (!transRef) return res.status(500).json({ error: "Missing transRef" });
    if (donations.find(x => x.slipId === transRef))
      return res.status(409).json({ error: "Duplicate slip" });

    const donation = {
      slipId: transRef, amount: Number(amount || 0),
      displayName: displayName || "donor", message: message || "",
      createdAt: new Date().toISOString(),
    };
    donations.unshift(donation);
    if (donations.length > 1000) donations.length = 1000;
    saveDonations();

    io.to("dashboard").emit("donation", donation);
    io.to(`overlay:${OVERLAY_ID}`).emit("alert", donation);

    res.json({ ok: true, slipId: transRef, amount: donation.amount });
  } catch (e) {
    console.error("donate:", e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// YouTube poller
// ═══════════════════════════════════════════════════════════════════════════════
let ytPoller = null;

async function fetchYouTubePage() {
  if (!ytSession?.active || !YT_KEY) return null;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", ytSession.liveChatId);
    url.searchParams.set("part", "snippet,authorDetails");
    url.searchParams.set("key", YT_KEY);
    if (ytSession.nextPageToken) url.searchParams.set("pageToken", ytSession.nextPageToken);

    const r = await fetch(url.toString());
    const d = await r.json();
    if (d.error) { console.error("YouTube API:", d.error.message); return 5000; }

    const { nextPageToken, items = [], pollingIntervalMillis = 5000 } = d;
    const isFirst = !ytSession.nextPageToken;
    ytSession.nextPageToken = nextPageToken;

    if (!isFirst) {
      for (const item of items) {
        const msg = {
          id: item.id, platform: "youtube",
          displayName: item.authorDetails.displayName,
          message: item.snippet.displayMessage,
          sentAt: item.snippet.publishedAt,
        };
        io.to("dashboard").emit("chat", msg);
        io.to(`overlay:${OVERLAY_ID}`).emit("chat", msg);
      }
    }
    return Math.max(pollingIntervalMillis, 2000);
  } catch (e) {
    console.error("fetchYouTubePage:", e.message);
    return 5000;
  }
}

function startYouTubePoller() {
  if (ytPoller) return;
  const tick = async () => {
    const next = await fetchYouTubePage();
    if (next === null) { ytPoller = null; return; }
    ytPoller = setTimeout(tick, next);
  };
  ytPoller = setTimeout(tick, 0);
  console.log("YouTube poller started");
}

function stopYouTubePoller() {
  if (ytPoller) { clearTimeout(ytPoller); ytPoller = null; }
  console.log("YouTube poller stopped");
}

// ═══════════════════════════════════════════════════════════════════════════════
// TikTok persistent connection
// ═══════════════════════════════════════════════════════════════════════════════
const tiktokConns = new Map();

async function startTikTokConnection(username) {
  if (tiktokConns.has("main")) return;
  const connectedAt = Date.now();

  const conn = new WebcastPushConnection(username, {
    ...(TT_SESSION ? { sessionId: TT_SESSION } : {}),
    requestPollingIntervalMs: 2000,
    enableExtendedGiftInfo: false,
  });

  conn.on("chat", (data) => {
    let t = Date.now();
    if (data?.createTime != null) {
      const n = Number(data.createTime);
      if (Number.isFinite(n) && n > 0) t = n > 1e12 ? n : n * 1000;
    }
    if (t < connectedAt - 3000) return;

    const msg = {
      id: `${data.userId}_${data.createTime || t}`,
      platform: "tiktok",
      displayName: data.nickname || data.uniqueId || "viewer",
      message: data.comment || "",
      sentAt: new Date(t).toISOString(),
    };
    io.to("dashboard").emit("chat", msg);
    io.to(`overlay:${OVERLAY_ID}`).emit("chat", msg);
  });

  conn.on("disconnected", () => {
    tiktokConns.delete("main");
    console.log("TikTok disconnected, retry in 5s");
    if (ttSession?.active) setTimeout(() => startTikTokConnection(username), 5000);
  });

  conn.on("error", (e) => console.error("TikTok error:", e?.message || e));

  try {
    await conn.connect();
    tiktokConns.set("main", conn);
    console.log(`TikTok connected @${username}`);
  } catch (e) {
    console.error("TikTok connect failed:", e.message);
  }
}

function stopTikTokConnection() {
  const c = tiktokConns.get("main");
  if (c) { c.disconnect().catch(() => {}); tiktokConns.delete("main"); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Socket.IO auth
// ═══════════════════════════════════════════════════════════════════════════════
io.on("connection", (socket) => {
  const { token, overlayId } = socket.handshake.auth;

  if (overlayId) {
    socket.join(`overlay:${overlayId}`);
    console.log(`Overlay connected: ${overlayId}`);
    return;
  }
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      socket.join("dashboard");
      console.log("Dashboard connected");
      return;
    } catch {}
  }
  socket.disconnect();
});

// ── Resume saved sessions on startup ─────────────────────────────────────────
if (savedSessions.youtube?.active) {
  ytSession = savedSessions.youtube;
  startYouTubePoller();
  console.log("YouTube session resumed");
}
if (savedSessions.tiktok?.active) {
  ttSession = savedSessions.tiktok;
  startTikTokConnection(ttSession.username);
  console.log(`TikTok session resumed @${ttSession.username}`);
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`StreamTool on port ${PORT}`));

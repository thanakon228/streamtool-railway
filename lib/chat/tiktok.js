const { WebcastPushConnection } = require("tiktok-live-connector");

function createTikTokChat({ sessionId: ttSessionId, sessionStore, emit, onSessionChange }) {
  const conns = new Map();

  async function connect(username) {
    if (conns.has("main")) return;
    const connectedAt = Date.now();

    const conn = new WebcastPushConnection(username, {
      ...(ttSessionId ? { sessionId: ttSessionId } : {}),
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

      emit("chat", {
        id: `${data.userId}_${data.createTime || t}`,
        platform: "tiktok",
        displayName: data.nickname || data.uniqueId || "viewer",
        chatimg:     data.profilePictureUrl || "",
        chatbadges:  [],
        message:     data.comment || "",
        sentAt:      new Date(t).toISOString(),
        hasDonation: false,
        bits:        0,
      });
    });

    conn.on("disconnected", () => {
      conns.delete("main");
      console.log("TikTok disconnected, retry in 5s");
      if (sessionStore.tiktok?.active) setTimeout(() => connect(username), 5000);
    });

    conn.on("error", (e) => console.error("TikTok error:", e?.message || e));

    try {
      await conn.connect();
      conns.set("main", conn);
      console.log(`TikTok connected @${username}`);
    } catch (e) {
      console.error("TikTok connect failed:", e.message);
    }
  }

  function disconnect() {
    const c = conns.get("main");
    if (c) { c.disconnect().catch(() => {}); conns.delete("main"); }
  }

  return {
    connCount: () => conns.size,
    isActive: () => conns.size > 0,
    getSession: () => sessionStore.tiktok,

    start(username) {
      sessionStore.tiktok = { username, active: true };
      onSessionChange?.();
      connect(username);
    },

    stop() {
      if (sessionStore.tiktok) sessionStore.tiktok.active = false;
      disconnect();
      onSessionChange?.();
    },

    resumeIfActive() {
      if (sessionStore.tiktok?.active) {
        connect(sessionStore.tiktok.username);
        console.log(`TikTok session resumed @${sessionStore.tiktok.username}`);
      }
    },
  };
}

module.exports = { createTikTokChat };

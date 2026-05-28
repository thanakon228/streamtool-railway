const WebSocket = require("ws");

// Kick uses Pusher WebSocket. App key is public (extracted from kick.com client bundle).
const PUSHER_APP_KEY = "eb1d5f283081a78b932c";
const PUSHER_URL     = `wss://ws-us2.pusher.com/app/${PUSHER_APP_KEY}?protocol=7&client=js&version=8.4.0-rc2&flash=false`;

async function resolveChatroomId(channelSlug) {
  const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channelSlug)}`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });
  if (!r.ok) throw new Error(`Kick channel lookup failed: ${r.status}`);
  const d = await r.json();
  if (!d?.chatroom?.id) throw new Error("Kick channel has no chatroom");
  return d.chatroom.id;
}

function createKickChat({ channel, sessionStore, emit, onSessionChange }) {
  let ws = null;
  let pingTimer = null;
  let reconnectTimer = null;

  function cleanup() {
    if (pingTimer)     { clearInterval(pingTimer); pingTimer = null; }
    if (reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch {} ws = null; }
  }

  async function connect(slug) {
    cleanup();
    let chatroomId;
    try { chatroomId = await resolveChatroomId(slug); }
    catch (e) {
      console.error("Kick:", e.message);
      if (sessionStore.kick?.active) reconnectTimer = setTimeout(() => connect(slug), 10000);
      return;
    }

    ws = new WebSocket(PUSHER_URL);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        event: "pusher:subscribe",
        data:  { auth: "", channel: `chatrooms.${chatroomId}.v2` },
      }));
      console.log(`Kick connected #${slug} (chatroom ${chatroomId})`);
      // Pusher requires ping every ~120s; keep it conservative at 30s.
      pingTimer = setInterval(() => {
        try { ws.send(JSON.stringify({ event: "pusher:ping", data: {} })); } catch {}
      }, 30000);
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.event !== "App\\Events\\ChatMessageEvent") return;
      let data;
      try { data = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data; } catch { return; }

      emit("chat", {
        id:          String(data.id || `kick_${Date.now()}`),
        platform:    "kick",
        displayName: data.sender?.username || "viewer",
        chatimg:     "",
        chatbadges:  (data.sender?.identity?.badges || []).map(b => b.text).filter(Boolean),
        message:     String(data.content || ""),
        sentAt:      data.created_at || new Date().toISOString(),
        hasDonation: false,
        bits:        0,
      });
    });

    ws.on("close", () => {
      console.log("Kick WS closed");
      cleanup();
      if (sessionStore.kick?.active) reconnectTimer = setTimeout(() => connect(slug), 5000);
    });

    ws.on("error", (e) => console.error("Kick error:", e?.message || e));
  }

  return {
    isActive: () => !!ws && ws.readyState === WebSocket.OPEN,
    getSession: () => sessionStore.kick,

    start(slug) {
      const channelSlug = String(slug || channel || "").trim().toLowerCase();
      if (!channelSlug) throw Object.assign(new Error("channel required"), { code: 400 });
      sessionStore.kick = { channel: channelSlug, active: true };
      onSessionChange?.();
      connect(channelSlug);
    },

    stop() {
      if (sessionStore.kick) sessionStore.kick.active = false;
      cleanup();
      onSessionChange?.();
    },

    resumeIfActive() {
      if (sessionStore.kick?.active) {
        connect(sessionStore.kick.channel);
        console.log(`Kick session resumed #${sessionStore.kick.channel}`);
      }
    },
  };
}

module.exports = { createKickChat };

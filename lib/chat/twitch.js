const tmi = require("tmi.js");

function createTwitchChat({ channel, oauth, sessionStore, emit, onSessionChange }) {
  let client = null;

  function start(targetChannel) {
    if (client) return;
    const ch = (targetChannel || channel || "").replace(/^#/, "").toLowerCase();
    if (!ch) throw Object.assign(new Error("channel required"), { code: 400 });

    client = new tmi.Client({
      options:    { debug: false, skipUpdatingEmotesets: true },
      connection: { reconnect: true, secure: true },
      channels:   [ch],
      identity:   oauth ? { username: "streamtool", password: oauth } : undefined,
    });

    client.on("message", (_chan, tags, message, self) => {
      if (self) return;
      emit("chat", {
        id:          tags.id || `twitch_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        platform:    "twitch",
        displayName: tags["display-name"] || tags.username || "viewer",
        chatimg:     "",
        chatbadges:  Object.keys(tags.badges || {}),
        message:     String(message || ""),
        sentAt:      new Date().toISOString(),
        hasDonation: !!tags.bits,
        bits:        Number(tags.bits) || 0,
      });
    });

    client.on("connected", () => console.log(`Twitch connected #${ch}`));
    client.on("disconnected", (reason) => console.log(`Twitch disconnected: ${reason}`));

    sessionStore.twitch = { channel: ch, active: true };
    onSessionChange?.();
    client.connect().catch(e => console.error("Twitch connect failed:", e?.message || e));
  }

  function stop() {
    if (client) { client.disconnect().catch(() => {}); client = null; }
    if (sessionStore.twitch) sessionStore.twitch.active = false;
    onSessionChange?.();
  }

  return {
    isActive: () => !!client && client.readyState() === "OPEN",
    getSession: () => sessionStore.twitch,
    start,
    stop,
    resumeIfActive() {
      if (sessionStore.twitch?.active) {
        start(sessionStore.twitch.channel);
        console.log(`Twitch session resumed #${sessionStore.twitch.channel}`);
      }
    },
  };
}

module.exports = { createTwitchChat };

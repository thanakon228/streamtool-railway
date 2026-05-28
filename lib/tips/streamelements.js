const ioClient = require("socket.io-client");

// StreamElements realtime: wss://realtime.streamelements.com — auth via "authenticate" event
// Event shape: { type: "tip" | "follow" | ..., data: { amount, currency, username, message } }
function createStreamElements({ jwt, accountId, onTip, onStatus }) {
  let socket = null;
  const seen = new Set();

  function status(s, detail) { onStatus?.({ provider: "streamelements", status: s, detail }); }

  function start() {
    if (socket) return;
    if (!jwt) { status("error", "no jwt"); return; }

    socket = ioClient("https://realtime.streamelements.com", {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 3000,
    });

    socket.on("connect", () => {
      status("connected");
      socket.emit("authenticate", { method: "jwt", token: jwt });
    });
    socket.on("authenticated",  () => status("authenticated"));
    socket.on("unauthorized",   (e) => status("error", "unauthorized: " + (e?.message || "")));
    socket.on("disconnect",     () => status("disconnected"));
    socket.on("connect_error",  (e) => status("error", e?.message || String(e)));

    const handle = (event) => {
      if (!event || event.type !== "tip") return;
      if (accountId && event.channel && event.channel !== accountId) return;
      const d = event.data || {};
      const tipId = String(event._id || event.id || `${d.username}_${event.createdAt || Date.now()}`);
      if (seen.has(tipId)) return;
      seen.add(tipId);
      if (seen.size > 5000) {
        const keep = [...seen].slice(-4000);
        seen.clear(); keep.forEach(x => seen.add(x));
      }
      onTip({
        tipId,
        source:      "streamelements",
        amount:      Number(d.amount || 0),
        currency:    String(d.currency || "USD").toUpperCase(),
        displayName: String(d.username || d.displayName || "anonymous").slice(0, 50),
        message:     String(d.message || "").slice(0, 200),
        createdAt:   event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString(),
      });
    };

    socket.on("event",       handle);
    socket.on("event:test",  handle);
  }

  function stop() {
    if (socket) { socket.disconnect(); socket = null; }
    status("stopped");
  }

  return { start, stop, isActive: () => !!socket && socket.connected };
}

module.exports = { createStreamElements };

const ioClient = require("socket.io-client");

// Streamlabs Socket API: wss://sockets.streamlabs.com — auth via ?token=
// Event shape: { type: "donation" | "subscription" | ..., message: [{ from, amount, currency, message, ... }] }
function createStreamlabs({ token, onTip, onStatus }) {
  let socket = null;
  const seen = new Set(); // tipId / hash dedup within session

  function status(s, detail) { onStatus?.({ provider: "streamlabs", status: s, detail }); }

  function start() {
    if (socket) return;
    if (!token) { status("error", "no token"); return; }

    socket = ioClient(`https://sockets.streamlabs.com?token=${encodeURIComponent(token)}`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 3000,
    });

    socket.on("connect",    () => status("connected"));
    socket.on("disconnect", () => status("disconnected"));
    socket.on("error",      (e) => status("error", e?.message || String(e)));

    socket.on("event", (event) => {
      if (!event || event.type !== "donation" || !Array.isArray(event.message)) return;
      for (const m of event.message) {
        const tipId = String(m._id || m.id || `${m.from}_${m.created_at || Date.now()}`);
        if (seen.has(tipId)) continue;
        seen.add(tipId);
        if (seen.size > 5000) {
          // trim — drop oldest 1000
          const keep = [...seen].slice(-4000);
          seen.clear(); keep.forEach(x => seen.add(x));
        }
        onTip({
          tipId,
          source:      "streamlabs",
          amount:      Number(m.amount || 0),
          currency:    String(m.currency || "USD").toUpperCase(),
          displayName: String(m.from || m.name || "anonymous").slice(0, 50),
          message:     String(m.message || "").slice(0, 200),
          createdAt:   m.created_at ? new Date(m.created_at).toISOString() : new Date().toISOString(),
        });
      }
    });
  }

  function stop() {
    if (socket) { socket.disconnect(); socket = null; }
    status("stopped");
  }

  return { start, stop, isActive: () => !!socket && socket.connected };
}

module.exports = { createStreamlabs };

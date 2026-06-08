const EVENT_TYPES = [
  "follow", "sub", "donate", "raid", "cheer",
  "chat", "gift", "like", "host", "custom",
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function validateEvent(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object" };
  if (!body.type || !EVENT_TYPES.includes(body.type)) {
    return { ok: false, error: `Invalid type. Allowed: ${EVENT_TYPES.join(", ")}` };
  }
  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return { ok: false, error: "Field 'name' is required" };
  }
  return { ok: true };
}

function normalizeEvent(body) {
  return {
    id:       body.id || makeId(),
    type:     body.type,
    name:     body.name.trim(),
    amount:   body.amount != null ? String(body.amount) : "",
    message:  body.message != null ? String(body.message) : "",
    platform: body.platform != null ? String(body.platform) : "",
    avatar:   body.avatar != null ? String(body.avatar) : "",
    meta:     body.meta && typeof body.meta === "object" ? body.meta : {},
    ts:       body.ts || new Date().toISOString(),
  };
}

function mapDonation(d) {
  const unit = (!d.currency || d.currency === "THB") ? "บาท" : d.currency;
  return normalizeEvent({
    type:     "donate",
    name:     d.displayName || "anonymous",
    amount:   `${d.amount || 0} ${unit}`,
    message:  d.message || "",
    platform: d.source || "streamtool",
    meta:     { slipId: d.slipId, isTest: !!d.isTest },
  });
}

function mapChat(msg) {
  return normalizeEvent({
    type:     "chat",
    name:     msg.displayName || msg.username || msg.name || "viewer",
    message:  msg.message || msg.text || "",
    platform: msg.platform || "",
    amount:   msg.hasDonation ? (msg.donationAmount || "") : "",
    avatar:   msg.avatar || "",
    meta:     { hasDonation: !!msg.hasDonation },
  });
}

function createLiveEvents({ io, overlayId, apiKey, maxHistory = 100, externalUrl = "", externalKey = "" }) {
  const history = [];

  function push(event, { broadcast = true } = {}) {
    history.unshift(event);
    if (history.length > maxHistory) history.length = maxHistory;
    if (broadcast) {
      io.to("dashboard").emit("liveEvent", event);
      io.to(`overlay:${overlayId}`).emit("liveEvent", event);
    }
    forwardExternal(event);
    return event;
  }

  async function forwardExternal(event) {
    if (!externalUrl) return;
    try {
      await fetch(`${externalUrl.replace(/\/$/, "")}/api/events`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key":    externalKey || apiKey,
        },
        body: JSON.stringify(event),
      });
    } catch (e) {
      console.warn("liveEvents forward:", e.message);
    }
  }

  function requireApiKey(req, res, next) {
    const key = req.get("x-api-key") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!apiKey || !key || key !== apiKey) {
      return res.status(401).json({ error: "Unauthorized", hint: "Send X-API-Key header" });
    }
    next();
  }

  function mount(app) {
    app.get("/api/events/types", (_req, res) => res.json({ types: EVENT_TYPES }));

    app.get("/api/events", (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 20, maxHistory);
      res.json({ events: history.slice(0, limit) });
    });

    app.get("/api/events/:id", (req, res) => {
      const event = history.find((e) => e.id === req.params.id);
      if (!event) return res.status(404).json({ error: "Event not found" });
      res.json(event);
    });

    app.post("/api/events", requireApiKey, (req, res) => {
      const check = validateEvent(req.body);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const event = push(normalizeEvent(req.body));
      res.status(201).json({ ok: true, event });
    });

    app.post("/api/events/batch", requireApiKey, (req, res) => {
      const items = req.body?.events;
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: "Body.events must be a non-empty array" });
      }
      if (items.length > 50) return res.status(400).json({ error: "Max 50 events per batch" });
      const created = [];
      for (const item of items) {
        const check = validateEvent(item);
        if (!check.ok) return res.status(400).json({ error: check.error, item });
        created.push(push(normalizeEvent(item)));
      }
      res.status(201).json({ ok: true, count: created.length, events: created });
    });

    app.post("/api/webhook/streamtool", requireApiKey, (req, res) => {
      const check = validateEvent(req.body);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const event = push(normalizeEvent({ ...req.body, platform: req.body.platform || "webhook" }));
      res.status(201).json({ ok: true, event });
    });
  }

  function onSocketConnection(socket) {
    socket.emit("liveEventsHello", { ok: true, history: history.slice(0, 20) });
    socket.on("liveEvent", (payload, ack) => {
      const check = validateEvent(payload);
      if (!check.ok) {
        if (typeof ack === "function") ack({ ok: false, error: check.error });
        return;
      }
      const event = push(normalizeEvent(payload));
      if (typeof ack === "function") ack({ ok: true, event });
    });
  }

  return { mount, onSocketConnection, push, mapDonation, mapChat, history, EVENT_TYPES };
}

module.exports = { createLiveEvents, EVENT_TYPES };

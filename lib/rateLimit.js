// Tiny dependency-free in-memory rate limiter (fixed window, keyed by client IP).
// Good enough for a single-instance Railway deploy; resets on restart.
// For real client IPs behind Railway's proxy, set `app.set("trust proxy", 1)`.

function rateLimit({ windowMs, max, message = "คำขอถี่เกินไป กรุณาลองใหม่อีกครั้ง" }) {
  const hits = new Map(); // ip -> { count, reset }

  // Periodically drop expired buckets so the Map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (now > e.reset) hits.delete(ip);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function (req, res, next) {
    const now = Date.now();
    const ip  = req.ip
      || req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || "unknown";

    let e = hits.get(ip);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; hits.set(ip, e); }
    e.count++;

    if (e.count > max) {
      res.set("Retry-After", String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };

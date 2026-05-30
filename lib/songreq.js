// Song Request engine — viewers request songs via chat (!sr), the streamer
// plays them through YouTube Music Premium (one-click open) or the /player page.
// Resolves metadata via YouTube Data API v3 (shared key/quota with chat polling).

const DEFAULT_CONFIG = {
  maxDurationSec: 600,   // reject songs longer than this (0 = no limit)
  perUserMax:     2,     // max queued (non-paid) requests per viewer
  queueCap:       30,    // max queue length
  autoResolve:    true,  // text → YouTube search (100 quota); off = queue raw
  paidPriority:   true,  // donations bump the request to the top
  blockedIds:     [],    // videoIds to reject
  blockedWords:   [],    // reject if title/raw contains any (lowercase)
};

const QUOTA_BUDGET = 9000;   // stop search-resolving past this (of 10k/day default)

function iso8601ToSec(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || "") || [];
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

function extractVideoId(text) {
  const s = String(text || "").trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return null;
}

function fmtDuration(sec) {
  if (!sec && sec !== 0) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + ":" + String(s).padStart(2, "0");
}

function createSongRequest({ apiKey, persistence, emitState, emitNowPlaying }) {
  const saved = persistence.state.songreq || {};
  const state = {
    open:       !!saved.open,
    keyword:    saved.keyword || "!sr",
    config:     { ...DEFAULT_CONFIG, ...(saved.config || {}) },
    queue:      Array.isArray(saved.queue) ? saved.queue : [],
    nowPlaying: saved.nowPlaying || null,
    history:    Array.isArray(saved.history) ? saved.history.slice(0, 30) : [],
  };
  let quotaUsed = 0, quotaDay = "";

  function save() {
    persistence.saveSongreq({
      open: state.open, keyword: state.keyword, config: state.config,
      queue: state.queue, nowPlaying: state.nowPlaying, history: state.history.slice(0, 30),
    });
  }
  function pub() {
    return {
      open: state.open, keyword: state.keyword, config: state.config,
      queue: state.queue, nowPlaying: state.nowPlaying, history: state.history.slice(0, 20),
      quota: { used: quotaUsed, budget: QUOTA_BUDGET, hasKey: !!apiKey },
    };
  }
  function changed() { save(); emitState(pub()); }
  function changedNow() { save(); emitState(pub()); emitNowPlaying(npPublic()); }
  function npPublic() {
    const n = state.nowPlaying;
    return n ? {
      videoId: n.videoId, title: n.title, channel: n.channel, thumb: n.thumb,
      durationSec: n.durationSec, requester: n.requester, platform: n.platform,
    } : null;
  }

  // ── quota ──
  function quotaReset() {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== quotaDay) { quotaDay = day; quotaUsed = 0; }
  }
  function canSearch() { quotaReset(); return quotaUsed + 101 <= QUOTA_BUDGET; }

  // ── YouTube API ──
  async function fetchVideo(id) {
    quotaReset(); quotaUsed += 1;
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${id}&key=${apiKey}`;
    const r = await fetch(url);
    const d = await r.json().catch(() => null);
    const it = d && d.items && d.items[0];
    if (!it) return null;
    const th = it.snippet.thumbnails || {};
    return {
      videoId: id, title: it.snippet.title, channel: it.snippet.channelTitle,
      durationSec: iso8601ToSec(it.contentDetails && it.contentDetails.duration),
      thumb: (th.medium || th.default || {}).url || "",
    };
  }
  async function searchVideo(q) {
    quotaReset(); quotaUsed += 100;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(q)}&key=${apiKey}`;
    const r = await fetch(url);
    const d = await r.json().catch(() => null);
    const it = d && d.items && d.items[0];
    if (!it || !it.id || !it.id.videoId) return null;
    return fetchVideo(it.id.videoId);
  }

  // ── rules ──
  function blockedWord(text) {
    const t = String(text || "").toLowerCase();
    return state.config.blockedWords.some(w => w && t.includes(String(w).toLowerCase()));
  }
  function isDup(videoId, exceptId) {
    if (state.nowPlaying && state.nowPlaying.videoId === videoId) return true;
    return state.queue.some(x => x.videoId === videoId && x.id !== exceptId);
  }
  function userQueuedCount(requester) {
    const r = String(requester || "").toLowerCase();
    return state.queue.filter(x => !x.paid && String(x.requester).toLowerCase() === r).length;
  }

  // paid requests sit ahead of unpaid; FIFO within each class
  function insertItem(item) {
    if (item.paid) {
      let i = state.queue.findIndex(x => !x.paid);
      if (i < 0) i = state.queue.length;
      state.queue.splice(i, 0, item);
    } else {
      state.queue.push(item);
    }
  }
  function rejectItem(item, reason) {
    state.queue = state.queue.filter(x => x.id !== item.id);
    item.status = "rejected"; item.reason = reason;
    state.history.unshift(item); state.history = state.history.slice(0, 30);
    changed();
  }

  let seq = 0;
  function newId() { return `sr_${Date.now()}_${(seq++).toString(36)}`; }

  async function resolveItem(item) {
    if (item.videoId) return;
    let meta = null;
    const id = extractVideoId(item.raw);
    try {
      if (id) meta = await fetchVideo(id);
      else if (state.config.autoResolve && canSearch()) meta = await searchVideo(item.raw);
    } catch (e) { /* network/API error → leave unresolved */ }
    if (!meta) { changed(); return; }                       // unresolved → streamer can retry
    if (state.config.maxDurationSec && meta.durationSec > state.config.maxDurationSec)
      return rejectItem(item, `ยาวเกิน ${fmtDuration(state.config.maxDurationSec)}`);
    if (state.config.blockedIds.includes(meta.videoId)) return rejectItem(item, "อยู่ใน blocklist");
    if (blockedWord(meta.title))                        return rejectItem(item, "คำต้องห้าม");
    if (isDup(meta.videoId, item.id))                   return rejectItem(item, "เพลงซ้ำในคิว");
    Object.assign(item, meta);
    changed();
  }

  // ── public API ──
  function add({ raw, requester = "ผู้ขอ", platform = "manual", paid = false, amount = 0 }) {
    raw = String(raw || "").trim();
    if (!raw) return { ok: false, reason: "ว่าง" };
    if (state.queue.length >= state.config.queueCap) return { ok: false, reason: "คิวเต็ม" };
    if (!paid && userQueuedCount(requester) >= state.config.perUserMax)
      return { ok: false, reason: "เกินโควตาต่อคน" };
    if (blockedWord(raw)) return { ok: false, reason: "คำต้องห้าม" };
    const item = {
      id: newId(), requester: String(requester).slice(0, 50), platform,
      raw: raw.slice(0, 200), videoId: null, title: null, channel: null,
      durationSec: null, thumb: null, status: "queued", paid: !!paid,
      amount: Number(amount) || 0, at: Date.now(),
    };
    insertItem(item);
    changed();
    resolveItem(item);   // async — emits again when resolved/rejected
    return { ok: true, id: item.id };
  }

  // chat: "!sr <query>" → add (read-only chat; rejects only surface in dashboard)
  function captureChat(msg) {
    if (!state.open || !state.keyword) return;
    const text = String(msg && msg.message || "");
    const kw = state.keyword.toLowerCase();
    const idx = text.toLowerCase().indexOf(kw);
    if (idx < 0) return;
    const raw = text.slice(idx + state.keyword.length).trim();
    if (!raw) return;
    add({ raw, requester: msg.displayName, platform: msg.platform });
  }

  // donation whose message contains the keyword → paid (priority) request
  function captureDonation(don) {
    if (!state.config.paidPriority || !state.keyword) return;
    const text = String(don && don.message || "");
    const idx = text.toLowerCase().indexOf(state.keyword.toLowerCase());
    if (idx < 0) return;
    const raw = text.slice(idx + state.keyword.length).trim();
    if (!raw) return;
    add({ raw, requester: don.displayName, platform: "donation", paid: true, amount: don.amount });
  }

  function play(id) {
    const i = state.queue.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, reason: "ไม่พบในคิว" };
    if (state.nowPlaying) { state.nowPlaying.status = "played"; state.history.unshift(state.nowPlaying); }
    const item = state.queue.splice(i, 1)[0];
    item.status = "playing";
    state.nowPlaying = item;
    state.history = state.history.slice(0, 30);
    changedNow();
    return { ok: true, nowPlaying: npPublic() };
  }
  function next() {
    if (state.nowPlaying) { state.nowPlaying.status = "played"; state.history.unshift(state.nowPlaying); }
    state.nowPlaying = state.queue.shift() || null;
    if (state.nowPlaying) state.nowPlaying.status = "playing";
    state.history = state.history.slice(0, 30);
    changedNow();
    return { ok: true, nowPlaying: npPublic() };
  }
  function stop() {
    if (state.nowPlaying) { state.nowPlaying.status = "played"; state.history.unshift(state.nowPlaying); state.nowPlaying = null; }
    changedNow();
    return { ok: true };
  }
  function skip(id, reason = "skipped") {
    if (state.nowPlaying && state.nowPlaying.id === id) return next();
    const i = state.queue.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, reason: "ไม่พบ" };
    const item = state.queue.splice(i, 1)[0];
    item.status = "skipped"; item.reason = reason;
    state.history.unshift(item); state.history = state.history.slice(0, 30);
    changed();
    return { ok: true };
  }
  function remove(id) { return skip(id, "removed"); }
  function move(id, dir) {
    const i = state.queue.findIndex(x => x.id === id);
    if (i < 0) return { ok: false };
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= state.queue.length) return { ok: false };
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
    changed();
    return { ok: true };
  }
  function clearQueue() { state.queue = []; changed(); return { ok: true }; }

  function reresolve(id) {
    const item = state.queue.find(x => x.id === id);
    if (!item) return { ok: false };
    item.videoId = null;
    resolveItem(item);
    return { ok: true };
  }

  function setOpen(open, keyword) {
    state.open = !!open;
    if (keyword !== undefined) state.keyword = String(keyword).trim().slice(0, 30) || "!sr";
    changed();
  }
  function setConfig(c) {
    const cfg = state.config;
    if (c.maxDurationSec !== undefined) cfg.maxDurationSec = Math.max(0, Math.min(7200, Number(c.maxDurationSec) || 0));
    if (c.perUserMax    !== undefined) cfg.perUserMax    = Math.max(1, Math.min(10, Number(c.perUserMax) || 2));
    if (c.queueCap      !== undefined) cfg.queueCap      = Math.max(5, Math.min(100, Number(c.queueCap) || 30));
    if (typeof c.autoResolve  === "boolean") cfg.autoResolve  = c.autoResolve;
    if (typeof c.paidPriority === "boolean") cfg.paidPriority = c.paidPriority;
    if (Array.isArray(c.blockedIds))   cfg.blockedIds   = c.blockedIds.map(String).filter(Boolean).slice(0, 200);
    if (Array.isArray(c.blockedWords)) cfg.blockedWords = c.blockedWords.map(s => String(s).toLowerCase()).filter(Boolean).slice(0, 200);
    changed();
  }

  return {
    state: pub, captureChat, captureDonation,
    add, play, next, stop, skip, remove, move, clearQueue, reresolve,
    setOpen, setConfig,
  };
}

module.exports = { createSongRequest };

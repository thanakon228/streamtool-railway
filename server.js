// StreamTool — Copyright (C) 2026 thanakon228
// Licensed under the GNU Affero General Public License v3.0 or later.
// See LICENSE and NOTICE.md. Derivative ideas: github.com/steveseguin/social_stream
//
// This program is free software: you can redistribute it and/or modify it under
// the terms of the GNU Affero General Public License as published by the Free
// Software Foundation, either version 3 of the License, or (at your option) any
// later version. This program is distributed WITHOUT ANY WARRANTY; without even
// the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

const express  = require("express");
const http     = require("http");
const { Server } = require("socket.io");
const cors     = require("cors");
const jwt      = require("jsonwebtoken");
const path     = require("path");

const persistence          = require("./lib/persistence");
const { createYouTubeChat } = require("./lib/chat/youtube");
const { createTikTokChat }  = require("./lib/chat/tiktok");
const { createTwitchChat }  = require("./lib/chat/twitch");
const { createKickChat }    = require("./lib/chat/kick");
const { createFacebookChat } = require("./lib/chat/facebook");
const { createTtsRouter, DEFAULT_TIERS, STYLE_KEYS } = require("./lib/tts");
const { createTipManager } = require("./lib/tips");

// ── Config ────────────────────────────────────────────────────────────────────
const PASSWORD       = process.env.DASHBOARD_PASSWORD || "admin123";
const JWT_SECRET     = process.env.JWT_SECRET         || "change-this-secret";
const OVERLAY_ID     = process.env.OVERLAY_ID         || "default-overlay";
const YT_KEY         = process.env.YOUTUBE_API_KEY    || "";
const EASYSLIP_KEY   = process.env.EASYSLIP_API_KEY   || "";
const TT_SESSION     = process.env.TIKTOK_SESSION_ID  || null;
const GOOGLE_TTS_KEY  = process.env.GOOGLE_TTS_KEY      || "";
const GEMINI_TTS_KEY  = process.env.GEMINI_API_KEY      || "";
const ELEVEN_TTS_KEY  = process.env.ELEVENLABS_API_KEY  || "";
const STREAMLABS_TOKEN = process.env.STREAMLABS_SOCKET_TOKEN  || "";
const SE_JWT           = process.env.STREAMELEMENTS_JWT       || "";
const SE_ACCOUNT_ID    = process.env.STREAMELEMENTS_ACCOUNT_ID || "";
const TWITCH_CHANNEL   = process.env.TWITCH_CHANNEL  || "";
const TWITCH_OAUTH     = process.env.TWITCH_OAUTH    || "";
const KICK_CHANNEL     = process.env.KICK_CHANNEL    || "";
const FB_PAGE_TOKEN    = process.env.FACEBOOK_PAGE_TOKEN || "";

// ── Express + Socket.IO ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/dashboard",     (_, res) => res.sendFile(path.join(__dirname, "public/dashboard.html")));
app.get("/donate",        (_, res) => res.sendFile(path.join(__dirname, "public/donate.html")));
app.get("/overlay/goal",  (_, res) => res.sendFile(path.join(__dirname, "public/overlay/goal.html")));
app.get("/overlay/:id",   (_, res) => res.sendFile(path.join(__dirname, "public/overlay/index.html")));
app.get("/overlay",       (_, res) => res.sendFile(path.join(__dirname, "public/overlay/index.html")));
app.get("/widget/chat",   (_, res) => res.sendFile(path.join(__dirname, "public/widgets/chat.html")));
app.get("/widget/alert",  (_, res) => res.sendFile(path.join(__dirname, "public/widgets/alert.html")));
app.get("/widget/goal",   (_, res) => res.sendFile(path.join(__dirname, "public/widgets/goal.html")));
app.get("/widget/donate", (_, res) => res.sendFile(path.join(__dirname, "public/donate.html")));

// ── Goal + template ──────────────────────────────────────────────────────────
let goal = { target: 0, title: "Goal วันนี้" };
const DEFAULT_CHAT_CONFIG = {
  enabled:         true,
  maxMessages:     8,
  messageDuration: 25000,
  position:        "bottom-left",
  width:           360,
  fontSize:        13,
  showAvatar:      true,
  showPill:        true,
  showBadge:       true,
  hiddenPlatforms: [],
};

const DEFAULT_SPOTLIGHT = { enabled: false, intervalSec: 60, durationSec: 6 };

let templateConfig = {
  template:       "classic",
  alertAnimation: "slide",
  alertPosition:  "top-right",
  customCss:      "",
  chatConfig:     { ...DEFAULT_CHAT_CONFIG },
  spotlight:      { ...DEFAULT_SPOTLIGHT },
};

const VALID_CHAT_POSITIONS = ["top-left","top-right","bottom-left","bottom-right"];
const VALID_PLATFORMS      = ["youtube","tiktok","twitch","kick","facebook"];

function clamp(n, lo, hi) { const x = Number(n); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null; }

function sanitizeChatConfig(input) {
  if (!input || typeof input !== "object") return null;
  const out = { ...DEFAULT_CHAT_CONFIG, ...templateConfig.chatConfig };
  if (typeof input.enabled    === "boolean") out.enabled    = input.enabled;
  if (typeof input.showAvatar === "boolean") out.showAvatar = input.showAvatar;
  if (typeof input.showPill   === "boolean") out.showPill   = input.showPill;
  if (typeof input.showBadge  === "boolean") out.showBadge  = input.showBadge;
  const m  = clamp(input.maxMessages, 3, 20);              if (m  !== null) out.maxMessages     = Math.round(m);
  const d  = clamp(input.messageDuration, 0, 120000);      if (d  !== null) out.messageDuration = Math.round(d);
  const w  = clamp(input.width, 240, 500);                 if (w  !== null) out.width           = Math.round(w);
  const fs = clamp(input.fontSize, 11, 18);                if (fs !== null) out.fontSize        = Math.round(fs);
  if (VALID_CHAT_POSITIONS.includes(input.position)) out.position = input.position;
  if (Array.isArray(input.hiddenPlatforms)) {
    out.hiddenPlatforms = input.hiddenPlatforms
      .filter(p => typeof p === "string" && VALID_PLATFORMS.includes(p))
      .slice(0, VALID_PLATFORMS.length);
  }
  return out;
}

function goalCurrent() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return persistence.state.donations
    .filter(d => d.createdAt && new Date(d.createdAt) >= today && !d.isTest)
    .reduce((s, d) => s + (d.amount || 0), 0);
}
function emitGoal() {
  io.to(`overlay:${OVERLAY_ID}`).emit("goalUpdate", { ...goal, current: goalCurrent() });
  io.to("dashboard").emit("goalUpdate", { ...goal, current: goalCurrent() });
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid token" }); }
}

// ── Broadcast helpers (route chat events to both rooms) ──────────────────────
function emitChat(event, data) {
  io.to("dashboard").emit(event, data);
  io.to(`overlay:${OVERLAY_ID}`).emit(event, data);
}

// ── Chat module instances ─────────────────────────────────────────────────────
const yt = createYouTubeChat({
  apiKey:          YT_KEY,
  sessionStore:    persistence.state.sessions,
  emit:            emitChat,
  onSessionChange: persistence.saveSessions,
});

const tt = createTikTokChat({
  sessionId:       TT_SESSION,
  sessionStore:    persistence.state.sessions,
  emit:            emitChat,
  onSessionChange: persistence.saveSessions,
});

const twitch = createTwitchChat({
  channel:         TWITCH_CHANNEL,
  oauth:           TWITCH_OAUTH,
  sessionStore:    persistence.state.sessions,
  emit:            emitChat,
  onSessionChange: persistence.saveSessions,
});

const kick = createKickChat({
  channel:         KICK_CHANNEL,
  sessionStore:    persistence.state.sessions,
  emit:            emitChat,
  onSessionChange: persistence.saveSessions,
});

const facebook = createFacebookChat({
  pageToken:       FB_PAGE_TOKEN,
  sessionStore:    persistence.state.sessions,
  emit:            emitChat,
  onSessionChange: persistence.saveSessions,
});

// ── TTS router ────────────────────────────────────────────────────────────────
if (!persistence.state.voiceConfig) {
  persistence.state.voiceConfig = { tiers: DEFAULT_TIERS, style: "random" };
}
const tts = createTtsRouter({
  keys:      { google: GOOGLE_TTS_KEY, gemini: GEMINI_TTS_KEY, elevenLabs: ELEVEN_TTS_KEY },
  configRef: () => persistence.state.voiceConfig,
});

// ═══════════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/health", (_, res) => res.json({
  status:         "ok",
  youtube:        yt.isActive(),
  tiktok:         tt.connCount(),
  twitch:         twitch.isActive(),
  kick:           kick.isActive(),
  facebook:       facebook.isActive(),
  youtubeKey:     !!YT_KEY,
  easyslipKey:    !!EASYSLIP_KEY,
  googleTtsKey:   !!GOOGLE_TTS_KEY,
  geminiTtsKey:   !!GEMINI_TTS_KEY,
  elevenLabsKey:  !!ELEVEN_TTS_KEY,
  tiktokSession:  !!TT_SESSION,
  twitchEnv:      !!TWITCH_CHANNEL,
  kickEnv:        !!KICK_CHANNEL,
  facebookEnv:    !!FB_PAGE_TOKEN,
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
  youtube:  { active: yt.getSession()?.active       || false, videoId:     yt.getSession()?.videoId     || "" },
  tiktok:   { active: tt.getSession()?.active       || false, username:    tt.getSession()?.username    || "" },
  twitch:   { active: twitch.getSession()?.active   || false, channel:     twitch.getSession()?.channel || "" },
  kick:     { active: kick.getSession()?.active     || false, channel:     kick.getSession()?.channel   || "" },
  facebook: { active: facebook.getSession()?.active || false, liveVideoId: facebook.getSession()?.liveVideoId || "" },
  overlayId: OVERLAY_ID,
}));

// Donations list
app.get("/api/donations", auth, (_, res) => res.json(persistence.state.donations));

// Template config (public — no auth)
app.get("/api/template-config", (_, res) => res.json({
  overlayId: OVERLAY_ID,
  ...templateConfig,
  goal: { ...goal, current: goalCurrent() },
}));

// Template config — save (auth)
app.post("/api/template-config", auth, (req, res) => {
  const { template, alertAnimation, alertPosition, customCss, chatConfig, spotlight } = req.body || {};
  const validTpl   = ["classic","neon","minimal","gaming","cute","ocean","sunset","gold","forest","vapor"];
  const validAnims = ["slide","bounce","zoom","flip","drop"];
  const validPos   = ["top-right","top-left","bottom-right","bottom-left"];
  if (template       && validTpl.includes(template))         templateConfig.template       = template;
  if (alertAnimation && validAnims.includes(alertAnimation)) templateConfig.alertAnimation = alertAnimation;
  if (alertPosition  && validPos.includes(alertPosition))    templateConfig.alertPosition  = alertPosition;
  if (customCss !== undefined) templateConfig.customCss = String(customCss).slice(0, 20000);
  if (chatConfig !== undefined) {
    const next = sanitizeChatConfig(chatConfig);
    if (next) templateConfig.chatConfig = next;
  }
  if (spotlight && typeof spotlight === "object") {
    const cur = templateConfig.spotlight || { ...DEFAULT_SPOTLIGHT };
    const next = { ...cur };
    if (typeof spotlight.enabled === "boolean") next.enabled = spotlight.enabled;
    const iv = clamp(spotlight.intervalSec, 10, 600); if (iv !== null) next.intervalSec = Math.round(iv);
    const du = clamp(spotlight.durationSec, 3, 30);   if (du !== null) next.durationSec = Math.round(du);
    templateConfig.spotlight = next;
  }
  const payload = { overlayId: OVERLAY_ID, ...templateConfig };
  io.to(`overlay:${OVERLAY_ID}`).emit("templateUpdate", payload);
  io.to("dashboard").emit("templateUpdate", payload);
  res.json({ ok: true, config: templateConfig });
});

// Test chat — emit fake chat event to overlay + dashboard (auth)
app.post("/api/test-chat", auth, (req, res) => {
  const { platform = "youtube", displayName = "Tester", message = "ทดสอบข้อความ chat",
          hasDonation = false, bits = 0, chatimg = "" } = req.body || {};
  if (!VALID_PLATFORMS.includes(platform))
    return res.status(400).json({ error: "platform ไม่ถูกต้อง" });
  const msg = {
    id:          `test_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    platform,
    displayName: String(displayName).slice(0, 50),
    chatimg:     String(chatimg || "").slice(0, 500),
    chatbadges:  [],
    message:     String(message).slice(0, 300),
    sentAt:      new Date().toISOString(),
    hasDonation: !!hasDonation,
    bits:        Math.max(0, Math.min(100000, Number(bits) || 0)),
  };
  io.to("dashboard").emit("chat", msg);
  io.to(`overlay:${OVERLAY_ID}`).emit("chat", msg);
  res.json({ ok: true });
});

// Public donate info (no auth)
app.get("/api/donate/info", (_, res) => res.json({
  enabled: !!EASYSLIP_KEY,
  overlayId: OVERLAY_ID,
}));

async function verifySlipAndBuildDonation({ base64, url, payload, message, displayName, isPublic }) {
  const body = { checkDuplicate: true };
  if (base64)  body.base64  = base64.startsWith("data:image/") ? base64 : `data:image/jpeg;base64,${base64}`;
  if (url)     body.url     = String(url).trim();
  if (payload) body.payload = String(payload).trim();

  const r = await fetch("https://api.easyslip.com/v2/verify/bank", {
    method: "POST",
    headers: { Authorization: `Bearer ${EASYSLIP_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok)       throw Object.assign(new Error(d?.error?.message || (isPublic ? "ตรวจสอบสลิปไม่สำเร็จ" : `EasySlip ${r.status}`)), { code: 400 });
  if (!d?.success) throw Object.assign(new Error(d?.error?.message || (isPublic ? "สลิปไม่ถูกต้อง" : "Verify failed")), { code: 400 });

  const transRef = d?.data?.rawSlip?.transRef;
  const amount   = d?.data?.amountInSlip ?? d?.data?.rawSlip?.amount?.amount;
  if (!transRef) throw Object.assign(new Error(isPublic ? "ไม่พบข้อมูลสลิป" : "Missing transRef"), { code: 500 });
  if (persistence.findDonation(transRef))
    throw Object.assign(new Error(isPublic ? "สลิปนี้ถูกใช้งานไปแล้ว" : "Duplicate slip"), { code: 409 });

  return {
    slipId:      transRef,
    amount:      Number(amount || 0),
    displayName: (displayName || (isPublic ? "ผู้ไม่ประสงค์ออกนาม" : "donor")).trim().slice(0, 50),
    message:     (message || "").trim().slice(0, 200),
    createdAt:   new Date().toISOString(),
    source:      "easyslip",
  };
}

async function dispatchDonation(donation) {
  persistence.addDonation(donation);
  const unit = (!donation.currency || donation.currency === "THB") ? "บาท" : donation.currency;
  const ttsText  = `${donation.displayName} โดเนท ${donation.amount} ${unit}${donation.message ? ` ${donation.message}` : ""}`;
  const ttsAudio = await tts.generate(ttsText, { amount: donation.amount });
  io.to("dashboard").emit("donation", donation);
  io.to(`overlay:${OVERLAY_ID}`).emit("alert", { ...donation, ttsAudio });
  emitGoal();
}

// ── Tip provider manager ─────────────────────────────────────────────────────
const tips = createTipManager({
  env: { STREAMLABS_TOKEN, SE_JWT, SE_ACCOUNT_ID },
  persistence,
  onTip: async (tip) => {
    await dispatchDonation({
      slipId:      tip.tipId,
      amount:      tip.amount,
      currency:    tip.currency,
      displayName: tip.displayName,
      message:     tip.message,
      createdAt:   tip.createdAt,
      source:      tip.source,
    });
  },
  onStatus: (s) => {
    console.log(`Tip [${s.provider}] ${s.status}${s.detail ? ": " + s.detail : ""}`);
    io.to("dashboard").emit("tipStatus", s);
  },
});

app.get("/api/tips/status", auth, (_, res) => res.json(tips.status()));
app.post("/api/tips/:provider/start", auth, (req, res) => {
  try { tips.start(req.params.provider); res.json({ ok: true }); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});
app.post("/api/tips/:provider/stop", auth, (req, res) => {
  try { tips.stop(req.params.provider); res.json({ ok: true }); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

// Public donate endpoint (ผู้ชมใช้ — ไม่ต้อง auth)
app.post("/api/donate/public", async (req, res) => {
  if (!EASYSLIP_KEY) return res.status(503).json({ error: "ระบบโดเนทยังไม่เปิดใช้งาน" });
  const { base64, url, payload } = req.body || {};
  if ([base64, url, payload].filter(Boolean).length !== 1)
    return res.status(400).json({ error: "กรุณาแนบสลิปให้ถูกต้อง" });
  try {
    const donation = await verifySlipAndBuildDonation({ ...req.body, isPublic: true });
    await dispatchDonation(donation);
    res.json({ ok: true, amount: donation.amount });
  } catch (e) {
    if (e.code) return res.status(e.code).json({ error: e.message });
    console.error("donate/public:", e);
    res.status(500).json({ error: "เกิดข้อผิดพลาดในระบบ" });
  }
});

// Donate (auth)
app.post("/api/donate", auth, async (req, res) => {
  if (!EASYSLIP_KEY) return res.status(503).json({ error: "EASYSLIP_API_KEY not set" });
  const { base64, url, payload } = req.body || {};
  if ([base64, url, payload].filter(Boolean).length !== 1)
    return res.status(400).json({ error: "Provide exactly one of: base64, url, payload" });
  try {
    const donation = await verifySlipAndBuildDonation({ ...req.body, isPublic: false });
    await dispatchDonation(donation);
    res.json({ ok: true, slipId: donation.slipId, amount: donation.amount });
  } catch (e) {
    if (e.code) return res.status(e.code).json({ error: e.message });
    console.error("donate:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── YouTube routes ───────────────────────────────────────────────────────────
app.post("/api/startYouTubeChat", auth, async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: "videoId required" });
  try {
    const result = await yt.start(videoId);
    io.to("dashboard").emit("session", { youtube: { active: true, videoId } });
    res.json({ ok: true, liveChatId: result.liveChatId });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

app.post("/api/stopYouTubeChat", auth, (_, res) => {
  yt.stop();
  io.to("dashboard").emit("session", { youtube: { active: false, videoId: "" } });
  res.json({ ok: true });
});

// ── TikTok routes ────────────────────────────────────────────────────────────
app.post("/api/startTikTokChat", auth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "username required" });
  tt.start(username);
  io.to("dashboard").emit("session", { tiktok: { active: true, username } });
  res.json({ ok: true });
});

app.post("/api/stopTikTokChat", auth, (_, res) => {
  tt.stop();
  io.to("dashboard").emit("session", { tiktok: { active: false, username: "" } });
  res.json({ ok: true });
});

// ── Twitch routes ────────────────────────────────────────────────────────────
app.post("/api/startTwitchChat", auth, (req, res) => {
  try {
    twitch.start(req.body?.channel);
    const s = twitch.getSession();
    io.to("dashboard").emit("session", { twitch: { active: true, channel: s?.channel || "" } });
    res.json({ ok: true });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});
app.post("/api/stopTwitchChat", auth, (_, res) => {
  twitch.stop();
  io.to("dashboard").emit("session", { twitch: { active: false, channel: "" } });
  res.json({ ok: true });
});

// ── Kick routes ──────────────────────────────────────────────────────────────
app.post("/api/startKickChat", auth, (req, res) => {
  try {
    kick.start(req.body?.channel);
    const s = kick.getSession();
    io.to("dashboard").emit("session", { kick: { active: true, channel: s?.channel || "" } });
    res.json({ ok: true });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});
app.post("/api/stopKickChat", auth, (_, res) => {
  kick.stop();
  io.to("dashboard").emit("session", { kick: { active: false, channel: "" } });
  res.json({ ok: true });
});

// ── Facebook routes ──────────────────────────────────────────────────────────
app.post("/api/startFacebookChat", auth, (req, res) => {
  try {
    facebook.start(req.body?.liveVideoId);
    io.to("dashboard").emit("session", { facebook: { active: true, liveVideoId: req.body?.liveVideoId } });
    res.json({ ok: true });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});
app.post("/api/stopFacebookChat", auth, (_, res) => {
  facebook.stop();
  io.to("dashboard").emit("session", { facebook: { active: false, liveVideoId: "" } });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TTS endpoints (provider routing in lib/tts/*)
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/test-tts", auth, async (req, res) => {
  const { text, amount = 0, tier, style } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });
  const audio = tier
    ? await tts.test(text, tier, style)
    : await tts.generate(text, { amount, style });
  if (!audio) return res.status(500).json({ error: "TTS generation failed (check API keys)" });
  res.json({ ok: true, audio });
});

// Trigger a spotlight pick on the overlay right now (for testing).
app.post("/api/spotlight/test", auth, (_, res) => {
  io.to(`overlay:${OVERLAY_ID}`).emit("spotlightNow");
  res.json({ ok: true });
});

// Public TTS for the overlay's chat-spotlight (no auth — overlay is public).
app.post("/api/tts/speak", async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: "text required" });
  try {
    const audio = await tts.generate(text, { amount: 0 });
    if (!audio) return res.status(503).json({ error: "TTS unavailable" });
    res.json({ ok: true, audio });
  } catch (e) { res.status(500).json({ error: "TTS error" }); }
});

app.get("/api/tts/config", auth, (_, res) => res.json({
  config: persistence.state.voiceConfig,
  styles: ["random", "neutral", ...STYLE_KEYS],
  providers: {
    google:     { available: !!GOOGLE_TTS_KEY },
    gemini:     { available: !!GEMINI_TTS_KEY },
    elevenlabs: { available: !!ELEVEN_TTS_KEY },
  },
}));

app.post("/api/tts/config", auth, (req, res) => {
  const { tiers, style } = req.body || {};
  if (Array.isArray(tiers)) {
    const clean = tiers
      .filter(t => t && typeof t === "object" && ["google","gemini","elevenlabs"].includes(t.provider))
      .map(t => ({
        minAmount: Math.max(0, Number(t.minAmount) || 0),
        provider:  t.provider,
        voiceName: t.voiceName ? String(t.voiceName).slice(0, 80) : undefined,
        voiceId:   t.voiceId   ? String(t.voiceId).slice(0, 80)   : undefined,
        model:     t.model     ? String(t.model).slice(0, 40)     : undefined,
      }));
    if (clean.length) persistence.state.voiceConfig.tiers = clean;
  }
  if (style !== undefined) {
    persistence.state.voiceConfig.style = String(style).slice(0, 30) || "random";
  }
  persistence.saveVoiceConfig();
  res.json({ ok: true, config: persistence.state.voiceConfig });
});

// Test Alert
app.post("/api/test-alert", auth, async (req, res) => {
  const { displayName = "ทดสอบ", amount = 100, message = "ทดสอบระบบ alert 🎉" } = req.body || {};
  const donation = {
    slipId:      `test_${Date.now()}`,
    amount:      Number(amount) || 100,
    displayName: String(displayName).trim().slice(0, 50),
    message:     String(message).trim().slice(0, 200),
    createdAt:   new Date().toISOString(),
    isTest:      true,
    source:      "test",
  };
  const ttsText  = `${donation.displayName} โดเนท ${donation.amount} บาท${donation.message ? ` ${donation.message}` : ""}`;
  const ttsAudio = await tts.generate(ttsText, { amount: donation.amount });
  io.to(`overlay:${OVERLAY_ID}`).emit("alert", { ...donation, ttsAudio });
  res.json({ ok: true });
});

// Goal — get (public) / set (auth)
app.get("/api/goal", (_, res) => res.json({ ...goal, current: goalCurrent() }));

app.post("/api/goal", auth, (req, res) => {
  const { target, title } = req.body || {};
  if (target !== undefined) goal.target = Math.max(0, Number(target) || 0);
  if (title  !== undefined) goal.title  = String(title).trim().slice(0, 60) || "Goal วันนี้";
  emitGoal();
  res.json({ ok: true, goal: { ...goal, current: goalCurrent() } });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Socket.IO auth
// ═══════════════════════════════════════════════════════════════════════════════
io.on("connection", (socket) => {
  const { token, overlayId } = socket.handshake.auth;

  if (overlayId) {
    socket.join(`overlay:${overlayId}`);
    socket.emit("goalUpdate",     { ...goal, current: goalCurrent() });
    socket.emit("templateUpdate", { overlayId: OVERLAY_ID, ...templateConfig });
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
yt.resumeIfActive();
tt.resumeIfActive();
twitch.resumeIfActive();
kick.resumeIfActive();
facebook.resumeIfActive();
tips.resumeAll();

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`StreamTool on port ${PORT}`));

const fs   = require("fs");
const path = require("path");

// Where runtime state is stored. Default = repo root (ephemeral on Railway —
// wiped every redeploy). Set DATA_DIR to a mounted Railway Volume (e.g. /data)
// to persist settings across deploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const DONATIONS_FILE = path.join(DATA_DIR, "donations.json");
const SESSIONS_FILE  = path.join(DATA_DIR, "sessions.json");
const VOICE_FILE     = path.join(DATA_DIR, "voice-config.json");
const OVERLAY_FILE   = path.join(DATA_DIR, "overlay-config.json");
const SONGREQ_FILE   = path.join(DATA_DIR, "songreq.json");

const state = {
  donations: [],
  sessions: { youtube: null, tiktok: null, twitch: null, kick: null, facebook: null },
  tips:     { streamlabs: null, streamelements: null },
  voiceConfig: null,
  overlay:  null,   // { goal, templateConfig } — saved overlay theme + goal
  songreq:  null,   // { open, keyword, config, queue, nowPlaying, history }
};

try { state.donations = JSON.parse(fs.readFileSync(DONATIONS_FILE, "utf8")); } catch {}
try {
  const loaded = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  state.sessions = { ...state.sessions, ...(loaded.sessions || loaded) };
  if (loaded.tips) state.tips = { ...state.tips, ...loaded.tips };
} catch {}
try { state.voiceConfig = JSON.parse(fs.readFileSync(VOICE_FILE, "utf8")); } catch {}
try { state.overlay = JSON.parse(fs.readFileSync(OVERLAY_FILE, "utf8")); } catch {}
try { state.songreq = JSON.parse(fs.readFileSync(SONGREQ_FILE, "utf8")); } catch {}

function saveDonations() {
  fs.writeFileSync(DONATIONS_FILE, JSON.stringify(state.donations, null, 2));
}

function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({
    sessions: state.sessions,
    tips:     state.tips,
  }, null, 2));
}

function saveVoiceConfig() {
  fs.writeFileSync(VOICE_FILE, JSON.stringify(state.voiceConfig, null, 2));
}

function saveOverlay(overlay) {
  state.overlay = overlay;
  fs.writeFileSync(OVERLAY_FILE, JSON.stringify(overlay, null, 2));
}

function saveSongreq(songreq) {
  state.songreq = songreq;
  fs.writeFileSync(SONGREQ_FILE, JSON.stringify(songreq, null, 2));
}

function addDonation(d) {
  state.donations.unshift(d);
  if (state.donations.length > 1000) state.donations.length = 1000;
  saveDonations();
}

function findDonation(slipId) {
  return state.donations.find(x => x.slipId === slipId);
}

module.exports = {
  state,
  saveDonations,
  saveSessions,
  saveVoiceConfig,
  saveOverlay,
  saveSongreq,
  addDonation,
  findDonation,
};

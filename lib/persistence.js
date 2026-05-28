const fs   = require("fs");
const path = require("path");

const DONATIONS_FILE = path.join(__dirname, "..", "donations.json");
const SESSIONS_FILE  = path.join(__dirname, "..", "sessions.json");
const VOICE_FILE     = path.join(__dirname, "..", "voice-config.json");

const state = {
  donations: [],
  sessions: { youtube: null, tiktok: null, twitch: null, kick: null, facebook: null },
  tips:     { streamlabs: null, streamelements: null },
  voiceConfig: null,
};

try { state.donations = JSON.parse(fs.readFileSync(DONATIONS_FILE, "utf8")); } catch {}
try {
  const loaded = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  state.sessions = { ...state.sessions, ...(loaded.sessions || loaded) };
  if (loaded.tips) state.tips = { ...state.tips, ...loaded.tips };
} catch {}
try { state.voiceConfig = JSON.parse(fs.readFileSync(VOICE_FILE, "utf8")); } catch {}

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
  addDonation,
  findDonation,
};

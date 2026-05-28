// Style/emotion map — pattern ported from social_stream/tts.js STYLE_MAP
// Each style provides an `elevenTag` (action tag understood by ElevenLabs eleven_v3)
// and `geminiPrefix` (natural-language instruction prepended for Gemini TTS).
// Google Neural2 doesn't support style — text is sent raw.

const STYLE_MAP = {
  neutral:  { elevenTag: "",            geminiPrefix: "" },
  happy:    { elevenTag: "[happy]",     geminiPrefix: "Say in a happy and cheerful tone:" },
  sad:      { elevenTag: "[sad]",       geminiPrefix: "Say in a sad and somber tone:" },
  angry:    { elevenTag: "[angry]",     geminiPrefix: "Say in an angry tone:" },
  excited:  { elevenTag: "[excited]",   geminiPrefix: "Say excitedly with energy:" },
  whisper:  { elevenTag: "[whisper]",   geminiPrefix: "Whisper softly:" },
  evil:     { elevenTag: "[evil]",      geminiPrefix: "Say in an evil and menacing tone:" },
  shy:      { elevenTag: "[shy]",       geminiPrefix: "Say shyly and gently:" },
  laughing: { elevenTag: "[laughing]",  geminiPrefix: "Say while laughing playfully:" },
  serious:  { elevenTag: "[serious]",   geminiPrefix: "Say in a serious and formal tone:" },
};

const STYLE_KEYS = Object.keys(STYLE_MAP).filter(k => k !== "neutral");

function resolveStyle(name) {
  if (!name || name === "neutral") return STYLE_MAP.neutral;
  if (name === "random") {
    return STYLE_MAP[STYLE_KEYS[Math.floor(Math.random() * STYLE_KEYS.length)]];
  }
  return STYLE_MAP[name] || STYLE_MAP.neutral;
}

function stripTags(text) {
  return String(text || "").replace(/\[[^\]]+\]/g, "").trim();
}

module.exports = { STYLE_MAP, STYLE_KEYS, resolveStyle, stripTags };

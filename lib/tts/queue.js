const { generateGoogle }      = require("./google");
const { generateGemini }      = require("./gemini");
const { generateElevenLabs }  = require("./elevenlabs");

// Default tier ladder — overridable via voice-config.json (managed by persistence)
const DEFAULT_TIERS = [
  { minAmount: 500, provider: "elevenlabs", voiceId: "21m00Tcm4TlvDq8ikWAM", model: "eleven_v3" },
  { minAmount: 100, provider: "gemini",     voiceName: "Kore" },
  { minAmount: 0,   provider: "google",     voiceName: "th-TH-Neural2-C" },
];

function pickTier(amount, tiers) {
  const sorted = [...tiers].sort((a, b) => b.minAmount - a.minAmount);
  return sorted.find(t => amount >= (t.minAmount || 0)) || sorted[sorted.length - 1];
}

function createTtsRouter({ keys, configRef }) {
  return {
    // Generate TTS audio for a donation amount + text. Returns base64 string
    // (MP3 for Google/ElevenLabs, WAV for Gemini) or null on failure / disabled.
    async generate(text, { amount = 0, style, voiceOverride } = {}) {
      const cfg = configRef() || {};
      const tiers = Array.isArray(cfg.tiers) && cfg.tiers.length ? cfg.tiers : DEFAULT_TIERS;
      const tier  = voiceOverride || pickTier(amount, tiers);
      const useStyle = style || cfg.style || "random";

      switch (tier.provider) {
        case "elevenlabs":
          return generateElevenLabs({
            text,
            apiKey:  keys.elevenLabs,
            voiceId: tier.voiceId,
            model:   tier.model || "eleven_v3",
            style:   useStyle,
          });
        case "gemini":
          return generateGemini({
            text,
            apiKey:    keys.gemini,
            voiceName: tier.voiceName,
            style:     useStyle,
          });
        case "google":
        default:
          return generateGoogle({
            text,
            apiKey:    keys.google,
            voiceName: tier.voiceName,
          });
      }
    },

    // Test a specific tier directly (used by /api/tts/test)
    async test(text, tier, style = "random") {
      switch (tier.provider) {
        case "elevenlabs":
          return generateElevenLabs({ text, apiKey: keys.elevenLabs, voiceId: tier.voiceId, model: tier.model || "eleven_v3", style });
        case "gemini":
          return generateGemini({ text, apiKey: keys.gemini, voiceName: tier.voiceName, style });
        case "google":
        default:
          return generateGoogle({ text, apiKey: keys.google, voiceName: tier.voiceName });
      }
    },

    defaults: DEFAULT_TIERS,
  };
}

module.exports = { createTtsRouter, DEFAULT_TIERS, pickTier };

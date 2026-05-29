const { generateGoogle }      = require("./google");
const { generateGemini }      = require("./gemini");
const { generateElevenLabs }  = require("./elevenlabs");

// Default tier ladder — overridable via voice-config.json (managed by persistence)
const DEFAULT_TIERS = [
  { minAmount: 500, provider: "elevenlabs", voiceId: "21m00Tcm4TlvDq8ikWAM", model: "eleven_v3" },
  { minAmount: 100, provider: "gemini",     voiceName: "Kore" },
  { minAmount: 0,   provider: "google",     voiceName: "th-TH-Neural2-C" },
];

// Fallback order when a tier's chosen provider has no key (or fails):
// descend the quality ladder to whatever is actually configured.
const PROVIDER_PREFERENCE = ["elevenlabs", "gemini", "google"];

function pickTier(amount, tiers) {
  const sorted = [...tiers].sort((a, b) => b.minAmount - a.minAmount);
  return sorted.find(t => amount >= (t.minAmount || 0)) || sorted[sorted.length - 1];
}

function createTtsRouter({ keys, configRef }) {
  // Does this provider have an API key configured?
  const hasKey = (provider) =>
    provider === "elevenlabs" ? !!keys.elevenLabs :
    provider === "gemini"     ? !!keys.gemini     :
    provider === "google"     ? !!keys.google     : false;

  // Voice params to use for a provider when falling back: reuse the matching
  // tier from the live config if present, else the built-in default.
  const voiceParamsFor = (provider, tiers) =>
    tiers.find(t => t.provider === provider) ||
    DEFAULT_TIERS.find(t => t.provider === provider) || {};

  // Dispatch a single provider call. Returns base64 audio or null.
  const callProvider = (provider, t, text, style) => {
    switch (provider) {
      case "elevenlabs":
        return generateElevenLabs({ text, apiKey: keys.elevenLabs, voiceId: t.voiceId, model: t.model || "eleven_v3", style });
      case "gemini":
        return generateGemini({ text, apiKey: keys.gemini, voiceName: t.voiceName, style });
      case "google":
      default:
        return generateGoogle({ text, apiKey: keys.google, voiceName: t.voiceName });
    }
  };

  return {
    // Generate TTS audio for a donation amount + text. Returns base64 string
    // (MP3 for Google/ElevenLabs, WAV for Gemini) or null on failure / disabled.
    // The tier picks the preferred provider; if it has no key (or its API call
    // fails) we fall back to any other configured provider so a donation is
    // never silently left without audio.
    async generate(text, { amount = 0, style, voiceOverride } = {}) {
      const cfg = configRef() || {};
      const tiers = Array.isArray(cfg.tiers) && cfg.tiers.length ? cfg.tiers : DEFAULT_TIERS;
      const tier  = voiceOverride || pickTier(amount, tiers);
      const useStyle = style || cfg.style || "random";

      // Chosen provider first, then the rest of the ladder — only those with keys.
      const chain = [tier.provider, ...PROVIDER_PREFERENCE]
        .filter((p, i, arr) => arr.indexOf(p) === i)
        .filter(hasKey);

      if (!chain.length) {
        console.error("TTS: no provider has an API key configured — skipping audio");
        return null;
      }

      for (const provider of chain) {
        const params = provider === tier.provider ? tier : voiceParamsFor(provider, tiers);
        const audio  = await callProvider(provider, params, text, useStyle);
        if (audio) {
          if (provider !== tier.provider)
            console.warn(`TTS: tier provider "${tier.provider}" unavailable → fell back to "${provider}"`);
          return audio;
        }
      }
      console.error(`TTS: all providers failed (tried: ${chain.join(", ")})`);
      return null;
    },

    // Test a specific tier directly (used by /api/tts/test) — no fallback,
    // so the dashboard can verify exactly the provider it selected.
    async test(text, tier, style = "random") {
      return callProvider(tier.provider, tier, text, style);
    },

    defaults: DEFAULT_TIERS,
  };
}

module.exports = { createTtsRouter, DEFAULT_TIERS, pickTier };

const { resolveStyle, stripTags } = require("./styles");

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL    = "eleven_v3";            // required for action tags

async function generateElevenLabs({ text, apiKey, voiceId = DEFAULT_VOICE_ID, model = DEFAULT_MODEL, style = "random" }) {
  if (!apiKey) return null;
  try {
    const s = resolveStyle(style);
    // eleven_v3 understands inline action tags; other models do not — strip if not v3.
    const tagged = (model === "eleven_v3" && s.elevenTag)
      ? `${s.elevenTag} ${stripTags(text)}`
      : stripTags(text);

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key":   apiKey,
          "Content-Type": "application/json",
          "Accept":       "audio/mpeg",
        },
        body: JSON.stringify({
          text:     tagged,
          model_id: model,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("ElevenLabs:", r.status, errText.slice(0, 200));
      return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.toString("base64");
  } catch (e) {
    console.error("ElevenLabs error:", e.message);
    return null;
  }
}

module.exports = { generateElevenLabs };

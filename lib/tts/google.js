const { stripTags } = require("./styles");

async function generateGoogle({ text, apiKey, voiceName = "th-TH-Neural2-C", languageCode = "th-TH" }) {
  if (!apiKey) return null;
  try {
    const r = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: stripTags(text) },
          voice: { languageCode, name: voiceName },
          audioConfig: { audioEncoding: "MP3" },
        }),
      }
    );
    const d = await r.json();
    if (d.error) { console.error("Google TTS:", d.error.message); return null; }
    return d.audioContent || null;
  } catch (e) {
    console.error("Google TTS error:", e.message);
    return null;
  }
}

module.exports = { generateGoogle };

const { resolveStyle, stripTags } = require("./styles");

// Wrap raw PCM (16-bit signed LE, mono) into a WAV container so browsers
// can play it directly. Default sample rate matches Gemini TTS output (24 kHz).
function pcmToWav(pcmBase64, sampleRate = 24000) {
  const pcm = Buffer.from(pcmBase64, "base64");
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign    = numChannels * bitsPerSample / 8;
  const dataSize      = pcm.length;

  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);

  return buf.toString("base64");
}

async function generateGemini({ text, apiKey, voiceName = "Kore", style = "random" }) {
  if (!apiKey) return null;
  try {
    const s = resolveStyle(style);
    const prompt = s.geminiPrefix
      ? `${s.geminiPrefix} ${stripTags(text)}`
      : stripTags(text);

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
      }
    );
    const d = await r.json();
    if (d.error) { console.error("Gemini TTS:", d.error.message); return null; }

    const pcmBase64 = d?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!pcmBase64) { console.error("Gemini TTS: no audio in response"); return null; }
    return pcmToWav(pcmBase64, 24000);
  } catch (e) {
    console.error("Gemini TTS error:", e.message);
    return null;
  }
}

module.exports = { generateGemini, pcmToWav };

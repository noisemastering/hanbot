// ai/core/audioTranscriber.js
// Transcribes audio/voice messages using OpenAI Whisper

const axios = require("axios");

/**
 * Transcribes an audio message from a URL using OpenAI Whisper
 * @param {string} audioUrl - URL of the audio file (from Facebook CDN)
 * @param {object} openai - OpenAI client instance
 * @returns {object} - { success, transcription } or { success, error }
 */
async function transcribeAudio(audioUrl, openai) {
  try {
    console.log(`🎤 Downloading audio: ${audioUrl.substring(0, 80)}...`);

    // Download audio from Facebook CDN
    const response = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    const buffer = Buffer.from(response.data);
    console.log(`🎤 Audio downloaded: ${buffer.length} bytes`);

    if (buffer.length < 1000) {
      return { success: false, error: "Audio too short" };
    }

    // Create a File object from the buffer for the OpenAI SDK
    const file = new File([buffer], "audio.mp4", { type: "audio/mp4" });

    // Transcribe with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "es",
    });

    const text = transcription.text?.trim();
    console.log(`🎤 Whisper transcription: "${text}"`);

    if (!text) {
      return { success: false, error: "Empty transcription" };
    }

    return { success: true, transcription: text };
  } catch (error) {
    console.error("❌ Error transcribing audio:", error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { transcribeAudio };

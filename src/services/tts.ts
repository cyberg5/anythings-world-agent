import fetch from "node-fetch";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, stat } from "fs/promises";
import { config } from "../config.js";

const run = promisify(execFile);

/**
 * Narration via Google Cloud Text-to-Speech (official, paid-tier-capable API
 * with a genuinely generous free allowance — see README). Replaces the
 * earlier unofficial msedge-tts integration, which occasionally returned
 * corrupt/silent responses in production with no error thrown, resulting in
 * uploaded videos that had captions and video but dead silence underneath.
 *
 * TTS_VOICE in .env should be a real Google voice name, e.g. "en-US-Neural2-D"
 * (see https://cloud.google.com/text-to-speech/docs/voices for the full list).
 * The language code is derived automatically from the voice name's first two
 * segments (e.g. "en-US" from "en-US-Neural2-D").
 */
export async function synthesizeSpeech(text: string, outPath: string): Promise<string> {
  const languageCode = config.ttsVoice.split("-").slice(0, 2).join("-");

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.googleTtsApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: config.ttsVoice },
        audioConfig: { audioEncoding: "MP3" },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Google TTS request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  if (!data.audioContent) {
    throw new Error(`Google TTS returned no audio content. Raw response: ${JSON.stringify(data)}`);
  }

  await writeFile(outPath, Buffer.from(data.audioContent, "base64"));
  await assertValidAudio(outPath, text);
  return outPath;
}

/** Lightweight sanity check — a real API rarely returns garbage, but a corrupt
 *  or truncated write is still worth catching before it reaches ffmpeg. */
async function assertValidAudio(filePath: string, text: string): Promise<void> {
  const { size } = await stat(filePath);
  if (size < 500) {
    throw new Error(`TTS output file suspiciously small (${size} bytes) for text: "${text.slice(0, 60)}..."`);
  }

  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = parseFloat(stdout.trim());
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const minExpectedSeconds = Math.max(0.5, wordCount / 5);
  if (!duration || duration < minExpectedSeconds * 0.5) {
    throw new Error(`TTS output too short (${duration}s for an expected ~${minExpectedSeconds.toFixed(1)}s).`);
  }
}

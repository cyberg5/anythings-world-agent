import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import path from "path";
import { rename } from "fs/promises";
import { config } from "../config.js";

/**
 * Free narration via Microsoft Edge's "Read Aloud" engine — no signup, no API
 * key, no per-character cost. It's an unofficial use of Microsoft's endpoint
 * (there's no official free public API for it), so if Microsoft ever changes
 * it, this package's maintainers usually patch quickly, but check
 * https://www.npmjs.com/package/msedge-tts if synthesis suddenly starts
 * failing everywhere at once.
 *
 * Voice list: see https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts
 */
export async function synthesizeSpeech(text: string, outPath: string): Promise<string> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(config.ttsVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const dir = path.dirname(outPath);
  const { audioFilePath } = await tts.toFile(dir, text);

  // msedge-tts names the file itself (a hash); move it to the path the caller expects.
  if (audioFilePath !== outPath) {
    await rename(audioFilePath, outPath);
  }
  return outPath;
}

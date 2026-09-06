/**
 * Run with: npx tsx src/scripts/listVoices.ts
 * (or after `npm run build`: node dist/scripts/listVoices.js)
 * Prints every available voice, so you can pick one for TTS_VOICE in .env.
 */
import { MsEdgeTTS } from "msedge-tts";

async function main() {
  const tts = new MsEdgeTTS();
  const voices = await tts.getVoices();

  const persian = voices.filter((v) => v.Locale.startsWith("fa"));
  const english = voices.filter((v) => v.Locale.startsWith("en"));

  console.log("=== Persian voices ===");
  persian.forEach((v) => console.log(`${v.ShortName}  (${v.Gender})`));

  console.log("\n=== English voices ===");
  english.forEach((v) => console.log(`${v.ShortName}  (${v.Gender})`));
}

main().catch(console.error);

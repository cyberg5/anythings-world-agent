/**
 * Run with: npx tsx src/scripts/listVoices.ts
 * (or after `npm run build`: node dist/scripts/listVoices.js)
 * Prints available Piper voice names for English and Persian, so you can
 * pick one for TTS_VOICE in .env. Just reads a small catalog file — doesn't
 * download any actual (large) voice models.
 */
import fetch from "node-fetch";

const CATALOG_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json";

async function main() {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) {
    console.error(`Failed to fetch voice catalog: ${res.status}`);
    process.exit(1);
  }
  const catalog = (await res.json()) as Record<string, any>;

  for (const prefix of ["en_US", "en_GB", "fa_IR"]) {
    console.log(`\n=== ${prefix} voices ===`);
    Object.keys(catalog)
      .filter((name) => name.startsWith(prefix))
      .forEach((name) => console.log(name));
  }
}

main().catch(console.error);

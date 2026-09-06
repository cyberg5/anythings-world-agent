import fetch from "node-fetch";
import { writeFile } from "fs/promises";
import { config } from "../config.js";

/** Find a real, licensed photo matching a query and download it. */
export async function fetchStockImage(query: string, outPath: string): Promise<string> {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`,
    { headers: { Authorization: config.pexelsApiKey } }
  );
  if (!res.ok) {
    throw new Error(`Pexels search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const photo = data.photos?.[0];
  if (!photo) {
    throw new Error(`No stock image found for query: "${query}"`);
  }
  const imgRes = await fetch(photo.src.portrait ?? photo.src.large);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  await writeFile(outPath, buf);
  return outPath;
}

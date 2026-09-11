import fetch from "node-fetch";
import { writeFile } from "fs/promises";
import { config } from "../config.js";

/** Find a real, licensed photo matching a query and download it (fallback when no video clip fits). */
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

/**
 * Find a real, licensed VIDEO clip matching a query and download it — this
 * is what makes the final render look like actual documentary footage
 * instead of a slideshow of zoomed still photos. Falls back to null (caller
 * should then try fetchStockImage) when no decent clip exists for the query,
 * since some abstract concepts only have photos on Pexels.
 */
export async function fetchStockVideo(query: string, outPath: string): Promise<string | null> {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait`,
    { headers: { Authorization: config.pexelsApiKey } }
  );
  if (!res.ok) {
    throw new Error(`Pexels video search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const video = (data.videos ?? [])[0];
  if (!video) return null;

  const files: any[] = video.video_files ?? [];
  const candidate =
    files
      .filter((f) => f.height && f.width && f.height >= f.width)
      .sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0] ??
    files.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];

  if (!candidate?.link) return null;

  const videoRes = await fetch(candidate.link);
  const buf = Buffer.from(await videoRes.arrayBuffer());
  await writeFile(outPath, buf);
  return outPath;
}

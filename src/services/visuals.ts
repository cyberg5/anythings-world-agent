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
 * Find a real, licensed VIDEO clip matching a query and download it.
 *
 * IMPORTANT: only accepts clips that are GENUINELY portrait-oriented
 * (taller than wide). An earlier version fell back to whatever file existed
 * — including landscape clips — and force-fit them into the vertical frame
 * with a cover-crop. For a wide landscape source, that crop has to blow the
 * image up until its height fills 1920px, which crushes the frame down to a
 * thin, heavily zoomed-in sliver of the original scene — the "زوم شده" bug.
 * A gentle Ken-Burns still image beats that every time, so we now return
 * null (caller falls back to fetchStockImage) instead of forcing it.
 */
export async function fetchStockVideo(query: string, outPath: string): Promise<string | null> {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait`,
    { headers: { Authorization: config.pexelsApiKey } }
  );
  if (!res.ok) {
    throw new Error(`Pexels video search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const videos: any[] = data.videos ?? [];

  const portraitVideo = videos.find((v) => v.height && v.width && v.height > v.width);
  if (!portraitVideo) return null;

  const files: any[] = portraitVideo.video_files ?? [];
  const candidate = files
    .filter((f) => f.height && f.width && f.height >= f.width)
    .sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
  if (!candidate?.link) return null;

  const videoRes = await fetch(candidate.link);
  const buf = Buffer.from(await videoRes.arrayBuffer());
  await writeFile(outPath, buf);
  return outPath;
}

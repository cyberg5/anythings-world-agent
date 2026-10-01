import fetch from "node-fetch";
import { writeFile } from "fs/promises";
import { config } from "../config.js";

/**
 * Find a real, licensed photo matching a query and download it (fallback when
 * no video clip fits). Pexels is primary; Pixabay is an AUTOMATIC fallback
 * used when Pexels errors or has no portrait photo for the query. If no
 * Pixabay key is configured, a Pexels failure propagates as before.
 */
export async function fetchStockImage(query: string, outPath: string): Promise<string> {
  try {
    const url = await findPexelsImage(query);
    if (url) return downloadTo(url, outPath);
  } catch (pexelsErr) {
    if (!config.pixabayApiKey) throw pexelsErr;
  }
  if (config.pixabayApiKey) {
    const url = await findPixabayImage(query);
    if (url) return downloadTo(url, outPath);
  }
  throw new Error(`No stock image found for query: "${query}" (Pexels + Pixabay)`);
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
 * A gentle Ken-Burns still image beats that every time, so we return null
 * (caller falls back to fetchStockImage) instead of forcing it.
 *
 * Pexels is primary; Pixabay is an AUTOMATIC fallback tried when Pexels
 * errors or has no genuinely-portrait clip. Returns null only when NEITHER
 * provider has a portrait clip, so the caller's image fallback still kicks in.
 */
export async function fetchStockVideo(query: string, outPath: string): Promise<string | null> {
  let link: string | null = null;
  try {
    link = await findPexelsVideo(query);
  } catch (pexelsErr) {
    if (!config.pixabayApiKey) throw pexelsErr;
  }
  if (!link && config.pixabayApiKey) {
    link = await findPixabayVideo(query);
  }
  if (!link) return null;
  return downloadTo(link, outPath);
}

// ---- Pexels (primary) ----

async function findPexelsImage(query: string): Promise<string | null> {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`,
    { headers: { Authorization: config.pexelsApiKey } }
  );
  if (!res.ok) {
    throw new Error(`Pexels search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const photo = data.photos?.[0];
  if (!photo) return null;
  return photo.src.portrait ?? photo.src.large;
}

async function findPexelsVideo(query: string): Promise<string | null> {
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait`,
    { headers: { Authorization: config.pexelsApiKey } }
  );
  if (!res.ok) {
    throw new Error(`Pexels video search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const videos: any[] = data.videos ?? [];

  // Only consider videos whose ORIGINAL orientation is portrait — checking
  // the top-level width/height (the source clip's real shape), not just
  // individual encoded file variants.
  const portraitVideo = videos.find((v) => v.height && v.width && v.height > v.width);
  if (!portraitVideo) return null;

  const files: any[] = portraitVideo.video_files ?? [];
  const candidate = files
    .filter((f) => f.height && f.width && f.height >= f.width)
    .sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
  return candidate?.link ?? null;
}

// ---- Pixabay (automatic fallback) ----

async function findPixabayImage(query: string): Promise<string | null> {
  const res = await fetch(
    `https://pixabay.com/api/?key=${config.pixabayApiKey}&q=${encodeURIComponent(query)}` +
      `&image_type=photo&orientation=vertical&per_page=3&safesearch=true`
  );
  if (!res.ok) {
    throw new Error(`Pixabay image search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const hit = (data.hits ?? []).find((h: any) => h.imageHeight > h.imageWidth) ?? data.hits?.[0];
  if (!hit) return null;
  return hit.largeImageURL ?? hit.webformatURL ?? null;
}

async function findPixabayVideo(query: string): Promise<string | null> {
  const res = await fetch(
    `https://pixabay.com/api/videos/?key=${config.pixabayApiKey}&q=${encodeURIComponent(query)}` +
      `&per_page=5&safesearch=true`
  );
  if (!res.ok) {
    throw new Error(`Pixabay video search failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const hits: any[] = data.hits ?? [];

  // Pixabay has no portrait filter for videos, so enforce it ourselves: each
  // hit exposes variant files under `videos.{large,medium,small,tiny}`, each
  // with its own width/height. Pick the first hit that has a genuinely
  // portrait variant (height > width), then the variant nearest 1920 tall.
  for (const hit of hits) {
    const variants: any[] = Object.values(hit.videos ?? {});
    const portrait = variants
      .filter((f) => f.height && f.width && f.height > f.width)
      .sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
    if (portrait?.url) return portrait.url;
  }
  return null;
}

// ---- shared ----

async function downloadTo(url: string, outPath: string): Promise<string> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
  return outPath;
}

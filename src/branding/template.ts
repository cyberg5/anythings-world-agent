import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const run = promisify(execFile);

// ---- AnyThings World™ brand constants ----
export const BRAND = {
  width: 1080,
  height: 1920,
  fps: 30,
  fontColor: "white",
  accentColor: "0x1FD1A1",
  fontFile: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  captionFontSize: 46,
  titleFontSize: 56,
};

function escapeDrawtext(text: string): string {
  return text
    .replace(/%/g, " percent")
    .replace(/[ \t]+/g, " ")
    .replace(/'/g, "")
    .replace(/:/g, "\\:");
}

function escapeDrawtextFile(text: string): string {
  return text.replace(/%/g, " percent").replace(/[ \t]+/g, " ").replace(/'/g, "");
}

function wrapForDrawtext(text: string, maxCharsPerLine = 18): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxCharsPerLine && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

/**
 * One narration segment, built from either a real stock VIDEO clip (looped
 * and cropped to fill the frame — this is what makes the result look like
 * actual footage instead of a slideshow) or, when no suitable clip exists
 * for that segment's topic, a still image with a slow Ken Burns zoom as a
 * fallback. Either way: narration audio + a burned-in caption on top.
 */
export async function buildSegmentClip(opts: {
  mediaPath: string;
  mediaType: "video" | "image";
  audioPath: string;
  durationSeconds: number;
  captionText: string;
  outPath: string;
}): Promise<string> {
  const { mediaPath, mediaType, audioPath, durationSeconds, captionText, outPath } = opts;
  const caption = escapeDrawtext(captionText);

  const captionFilter =
    `drawtext=fontfile=${BRAND.fontFile}:text='${caption}':fontcolor=${BRAND.fontColor}:fontsize=${BRAND.captionFontSize}:` +
    `box=1:boxcolor=0x000000AA:boxborderw=20:x=(w-text_w)/2:y=h-380:line_spacing=8:expansion=none`;

  if (mediaType === "video") {
    const filterComplex =
      `[0:v]scale=${BRAND.width}:${BRAND.height}:force_original_aspect_ratio=increase,` +
      `crop=${BRAND.width}:${BRAND.height},setsar=1,${captionFilter}[v]`;

    await run("ffmpeg", [
      "-y",
      "-stream_loop", "-1",
      "-i", mediaPath,
      "-i", audioPath,
      "-filter_complex", filterComplex,
      "-map", "[v]",
      "-map", "1:a",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      "-pix_fmt", "yuv420p",
      outPath,
    ]);
  } else {
    const frames = Math.round(durationSeconds * BRAND.fps);
    const filter = [
      `zoompan=z='min(zoom+0.0007,1.15)':d=${frames}:s=${BRAND.width}x${BRAND.height}:fps=${BRAND.fps}`,
      captionFilter,
    ].join(",");

    await run("ffmpeg", [
      "-y",
      "-loop", "1",
      "-i", mediaPath,
      "-i", audioPath,
      "-filter:v", filter,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      "-pix_fmt", "yuv420p",
      outPath,
    ]);
  }

  return outPath;
}

/** Concatenate all segment clips into one video (re-encoding for safety). */
export async function concatClips(clipPaths: string[], outPath: string, workDir: string): Promise<string> {
  const listFile = path.join(workDir, "concat_list.txt");
  const fs = await import("fs/promises");
  await fs.writeFile(listFile, clipPaths.map((p) => `file '${p}'`).join("\n"));
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath]);
  return outPath;
}

/**
 * Brand pass: prepends a 2s title card (channel name + topic) and overlays
 * the AnyThings World™ watermark logo in the corner for the whole video.
 */
export async function applyBrandingPass(opts: {
  inputPath: string;
  logoPath: string;
  channelName: string;
  onScreenTitle: string;
  outPath: string;
  workDir: string;
}): Promise<string> {
  const { inputPath, logoPath, channelName, onScreenTitle, outPath, workDir } = opts;
  const fs = await import("fs/promises");

  const introPath = path.join(workDir, "intro_card.mp4");
  const title = escapeDrawtextFile(wrapForDrawtext(onScreenTitle, 18));
  const channel = escapeDrawtext(channelName);

  const titleFile = path.join(workDir, "intro_title.txt");
  await fs.writeFile(titleFile, title);

  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=0x0B0B0F:s=${BRAND.width}x${BRAND.height}:d=2:r=${BRAND.fps}`,
    "-i", logoPath,
    "-filter_complex",
    `[1:v]scale=220:-1[logo];` +
      `[0:v][logo]overlay=(W-w)/2:340[bg];` +
      `[bg]drawtext=fontfile=${BRAND.fontFile}:textfile='${titleFile}':fontcolor=white:fontsize=${BRAND.titleFontSize}:` +
      `x=(w-text_w)/2:y=700:line_spacing=14:text_align=center:expansion=none,` +
      `drawtext=fontfile=${BRAND.fontFile}:text='${channel}':fontcolor=${BRAND.accentColor}:fontsize=36:` +
      `x=(w-text_w)/2:y=h-160:expansion=none`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-an",
    introPath,
  ]);

  const combined = path.join(workDir, "combined.mp4");
  const listFile = path.join(workDir, "brand_concat.txt");
  const introWithAudio = path.join(workDir, "intro_with_audio.mp4");
  await run("ffmpeg", [
    "-y", "-i", introPath,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-shortest", "-c:v", "copy", "-c:a", "aac",
    introWithAudio,
  ]);
  await fs.writeFile(listFile, [introWithAudio, inputPath].map((p) => `file '${p}'`).join("\n"));
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", combined]);

  await run("ffmpeg", [
    "-y",
    "-i", combined,
    "-i", logoPath,
    "-filter_complex",
    `[1:v]scale=140:-1,format=rgba,colorchannelmixer=aa=0.85[wm];[0:v][wm]overlay=W-w-40:H-h-260`,
    "-c:a", "copy",
    outPath,
  ]);

  return outPath;
}

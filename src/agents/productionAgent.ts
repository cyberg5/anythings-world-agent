import path from "path";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { synthesizeSpeech } from "../services/tts.js";
import { fetchStockImage, fetchStockVideo } from "../services/visuals.js";
import { buildSegmentClip, concatClips, applyBrandingPass } from "../branding/template.js";
import { config } from "../config.js";
import type { ProducedVideo, VideoScript } from "../types.js";

const run = promisify(execFile);
const LOGO_PATH = path.resolve("assets/logo_watermark_256.png");

export async function produceVideo(script: VideoScript): Promise<ProducedVideo> {
  const workDir = await mkdtemp(path.join(tmpdir(), "atw-video-"));
  try {
    const clipPaths: string[] = [];

    for (const [i, seg] of script.narrationSegments.entries()) {
      const audioPath = path.join(workDir, `narration_${i}.wav`); // Piper outputs WAV
      const clipPath = path.join(workDir, `segment_${i}.mp4`);

      await synthesizeSpeech(seg.text, audioPath);
      // Use the REAL synthesized duration, not the script's approxSeconds
      // estimate, as the target for the video/image build below — this is
      // now the authoritative `-t` cutoff in template.ts (see its comment),
      // not just an informational number.
      const realAudioSeconds = await getDuration(audioPath);

      // Prefer real b-roll footage — this is what makes the result look like
      // an actual documentary instead of a slideshow of zoomed photos. Not
      // every topic has a matching stock clip, so fall back to a still image.
      const videoPath = path.join(workDir, `video_${i}.mp4`);
      const fetchedVideo = await fetchStockVideo(seg.visualQuery, videoPath).catch(() => null);

      if (fetchedVideo) {
        await buildSegmentClip({
          mediaPath: fetchedVideo,
          mediaType: "video",
          audioPath,
          durationSeconds: realAudioSeconds,
          captionText: seg.text,
          outPath: clipPath,
        });
      } else {
        const imagePath = path.join(workDir, `image_${i}.jpg`);
        await fetchStockImage(seg.visualQuery, imagePath);
        await buildSegmentClip({
          mediaPath: imagePath,
          mediaType: "image",
          audioPath,
          durationSeconds: realAudioSeconds,
          captionText: seg.text,
          outPath: clipPath,
        });
      }

      // Defense in depth: a real production run once produced a single
      // ~3500-second segment (video looped far longer than intended) even
      // though the narration audio behind it validated fine on its own —
      // catch that class of bug here too, independent of tts.ts's own check.
      const actualSegSeconds = await getDuration(clipPath);
      const maxPlausible = Math.max(20, realAudioSeconds * 2);
      if (actualSegSeconds > maxPlausible) {
        throw new Error(
          `Segment ${i} rendered at ${actualSegSeconds.toFixed(1)}s but narration was only ` +
            `${realAudioSeconds.toFixed(1)}s — looks like a runaway render, aborting this attempt.`
        );
      }

      clipPaths.push(clipPath);
    }

    const mainCut = path.join(workDir, "main_cut.mp4");
    await concatClips(clipPaths, mainCut, workDir);

    // Catch a runaway BEFORE spending time on the (slower) branding pass —
    // format-aware bound, generous enough to never false-positive on a
    // legitimately long video, tight enough to catch the class of bug above
    // if it ever slips past the per-segment check too.
    const mainCutSeconds = await getDuration(mainCut);
    const maxPlausibleTotal = script.format === "long" ? 500 : 200;
    if (mainCutSeconds > maxPlausibleTotal) {
      throw new Error(
        `Concatenated video is ${mainCutSeconds.toFixed(1)}s (format: ${script.format}) — ` +
          `looks like a runaway render, aborting before the branding pass.`
      );
    }

    const finalPath = path.resolve(`output/${slugify(script.topic)}.mp4`);
    await mkdir(path.dirname(finalPath), { recursive: true }); // output/ may not exist yet (git doesn't track empty dirs)
    await applyBrandingPass({
      inputPath: mainCut,
      logoPath: LOGO_PATH,
      channelName: config.channelName,
      onScreenTitle: script.onScreenTitle,
      outPath: finalPath,
      workDir,
    });

    // One more check: the branding pass (intro card + watermark) should only
    // add ~2s (the intro) to mainCut's length. A real incident saw a ~80s
    // unexplained gap appear specifically between mainCut and the final
    // branded file, smaller than the earlier multi-thousand-second bugs but
    // still wrong — catch it here with a generous tolerance, narrowing down
    // that the branding pass itself (not segment building or the main concat,
    // both already checked above) is where any remaining inflation is coming
    // from, if this ever fires again.
    const finalSeconds = await getDuration(finalPath);
    if (finalSeconds > mainCutSeconds + 10) {
      throw new Error(
        `Final branded video is ${finalSeconds.toFixed(1)}s but the pre-branding cut was only ` +
          `${mainCutSeconds.toFixed(1)}s — the branding pass inflated the duration, aborting.`
      );
    }

    return { filePath: finalPath, durationSeconds: finalSeconds, script };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function getDuration(filePath: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

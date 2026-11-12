export type VideoFormat = "short" | "long";

/** Where a pipeline run publishes. One run = one platform (see TARGET_PLATFORM in config.ts). */
export type Platform = "youtube" | "tiktok" | "instagram";

export interface TrendCandidate {
  topic: string;
  angle: string;
  reasonScore: number; // 0-1 heuristic score of why this topic is hot right now
  sourceChannelContext?: string; // which reference channel/niche inspired the *topic* only
  format: VideoFormat;
}

export interface SourcedFact {
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  publishedDate?: string;
}

export interface ResearchDossier {
  topic: string;
  angle: string;
  format: VideoFormat;
  facts: SourcedFact[];
  summary: string;
}

export interface VideoScript {
  topic: string;
  format: VideoFormat;
  hookLine: string; // first ~3 seconds
  narrationSegments: NarrationSegment[];
  citedSources: SourcedFact[];
  onScreenTitle: string;
  description: string; // YouTube description, includes AI-disclosure + sources
  tags: string[];
}

export interface NarrationSegment {
  text: string;
  visualQuery: string; // what to search stock footage/images for, tied to a cited fact
  approxSeconds: number;
}

export interface ProducedVideo {
  filePath: string;
  durationSeconds: number;
  script: VideoScript;
}

export interface QAResult {
  passed: boolean;
  reasons: string[];
}

export interface UploadResult {
  platform: Platform;
  // YouTube video id / Instagram media id / TikTok post id (or publish_id
  // when TikTok hasn't exposed a public post id yet — e.g. inbox drafts).
  videoId: string;
  url: string;
  // Platform-specific caption actually used (TikTok/Instagram). Saved as the
  // video's description instead of the YouTube-shaped one when present.
  caption?: string;
}

export interface PerformanceSnapshot {
  videoId: string;
  views: number;
  avgViewDurationSeconds: number;
  likes: number;
  capturedAt: string;
}

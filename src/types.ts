export interface TrendCandidate {
  topic: string;
  angle: string;
  reasonScore: number; // 0-1 heuristic score of why this topic is hot right now
  sourceChannelContext?: string; // which reference channel/niche inspired the *topic* only
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
  facts: SourcedFact[];
  summary: string;
}

export interface VideoScript {
  topic: string;
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
  youtubeVideoId: string;
  url: string;
}

export interface PerformanceSnapshot {
  youtubeVideoId: string;
  views: number;
  avgViewDurationSeconds: number;
  likes: number;
  capturedAt: string;
}

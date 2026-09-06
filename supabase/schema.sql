-- Run this once in the Supabase SQL editor for your project.

create table if not exists videos (
  id bigint generated always as identity primary key,
  topic text not null,
  youtube_video_id text not null unique,
  url text not null,
  description text,
  tags jsonb,
  sources jsonb, -- array of { claim, sourceUrl, sourceTitle, publishedDate }
  published_at timestamptz not null default now()
);

create table if not exists performance_snapshots (
  id bigint generated always as identity primary key,
  youtube_video_id text not null references videos(youtube_video_id),
  views integer not null default 0,
  avg_view_duration_seconds numeric not null default 0,
  likes integer not null default 0,
  captured_at timestamptz not null default now()
);

create index if not exists idx_perf_video on performance_snapshots(youtube_video_id);
create index if not exists idx_videos_topic on videos using gin (to_tsvector('simple', topic));

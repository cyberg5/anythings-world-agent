-- ============================================================
-- MULTI-PLATFORM UPGRADE (YouTube + TikTok + Instagram)
-- Run this ONCE in the Supabase SQL editor BEFORE uploading the new
-- pipeline code to GitHub — the new code filters on `platform` and will
-- fail if the column doesn't exist yet. Safe to re-run.
-- ============================================================

-- 1) Which platform each video row belongs to. Every existing row was a
--    YouTube upload, so the default keeps them correct automatically.
--    (youtube_video_id keeps its historical name but now holds the
--    platform's own id: YouTube id / Instagram media id / TikTok post id.)
alter table videos add column if not exists platform text not null default 'youtube';

do $$ begin
  alter table videos add constraint videos_platform_check
    check (platform in ('youtube', 'tiktok', 'instagram'));
exception when duplicate_object then null; end $$;

create index if not exists idx_videos_platform on videos(platform, published_at desc);

-- 2) Live OAuth tokens the pipeline rotates between runs (TikTok refresh
--    token rotates on every use; Instagram's is refreshed weekly).
--    RLS ON with NO policies = the app's anon key can never read it; only
--    the pipeline's service_role key (which bypasses RLS) can.
create table if not exists platform_tokens (
  key text primary key,
  value text not null,
  seed_hash text not null,
  updated_at timestamptz not null default now()
);
alter table platform_tokens enable row level security;

notify pgrst, 'reload schema';

-- Durable storage for published catalogues. Run once, in the Supabase SQL
-- Editor, against the Catalogue AI project.
--
-- Why: Render's free plan gives the container no persistent disk, so the
-- file-backed snapshots in app/data/published/ were wiped on every redeploy and
-- on every 15-minute idle spin-down. That is why published catalogues kept
-- disappearing from the live site.
--
-- The snapshot stored here holds URLs, not base64 — every image is uploaded to
-- the `catalogue-images` Storage bucket and referenced by its public URL, so a
-- row is kilobytes rather than the 42 MB one catalogue used to be. See
-- app/server/supabase-store.mjs.

create table if not exists public.published_catalogues (
  -- Matches the app's own category id, already validated against
  -- /^[a-zA-Z0-9_-]+$/ before it reaches storage.
  category_id  text primary key,
  title        text not null,
  snapshot     jsonb not null,
  published_at timestamptz not null default now()
);

-- The public site lists catalogues newest-first on every page load.
create index if not exists published_catalogues_published_at_idx
  on public.published_catalogues (published_at desc);

-- Locked down on purpose: RLS on, and no policies at all. Visitors never talk
-- to Supabase directly — they hit this app's own /api/published endpoints, and
-- only the server holds the service_role key, which bypasses RLS. An anon or
-- publishable key therefore reads nothing here, even if it leaks.
alter table public.published_catalogues enable row level security;

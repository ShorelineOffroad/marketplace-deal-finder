-- Marketplace Deal Finder — initial schema
-- Run this once in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run)

create table if not exists listings (
  id bigint generated always as identity primary key,
  external_id text not null unique,       -- Facebook Marketplace listing id
  category text not null,                 -- e.g. "power_tools"
  title text not null,
  description text,
  price numeric,
  currency text default 'CAD',
  url text not null,
  image_url text,
  location_city text,
  location_state text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- valuation (filled in by later pipeline steps)
  comparable_score numeric,               -- free first-pass score vs. group median
  llm_estimated_value numeric,            -- Claude Haiku's estimate
  llm_reasoning text,
  is_flagged boolean not null default false,
  flagged_at timestamptz
);

-- Speeds up the comparable-based scoring pass (grouping by category, ordering by price)
create index if not exists listings_category_price_idx on listings (category, price);

-- Speeds up the dashboard query (flagged deals, most underpriced first)
create index if not exists listings_flagged_idx on listings (is_flagged, flagged_at desc) where is_flagged = true;

-- Locked down with no policies: only the service_role key (used server-side by the
-- scrape route and dashboard) can access this table. The publishable key, if it were
-- ever exposed client-side, gets zero rows rather than full read/write access.
alter table listings enable row level security;

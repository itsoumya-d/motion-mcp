-- Motion MCP production billing schema.
-- Apply in Supabase before replacing the local JSON ledger adapter.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  local_fingerprint text,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stripe_subscription_id text unique,
  plan text not null check (plan in ('free', 'pro', 'team', 'enterprise')),
  status text not null,
  included_monthly_credits integer not null default 0,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  delta integer not null,
  reason text not null,
  ref_id text,
  reservation_id text,
  reservation_status text check (reservation_status in ('reserved', 'committed', 'refunded')),
  balance_after integer not null,
  created_at timestamptz not null default now()
);

create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  operation text not null,
  framework text,
  component_id text,
  asset_path text,
  prompt text,
  status text not null,
  validation_ok boolean,
  credits_charged integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists quiver_usage_records (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid references generations(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  operation text not null,
  model text not null,
  quiver_pricing_credits numeric not null,
  motion_credits_reserved integer not null,
  motion_credits_committed integer not null,
  quiver_request_id text,
  quiver_trace_id text,
  rate_limit jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_created_idx on credit_ledger(user_id, created_at desc);
create index if not exists generations_project_created_idx on generations(project_id, created_at desc);
create index if not exists quiver_usage_generation_idx on quiver_usage_records(generation_id);

-- =============================================================================
-- ColoPlus Tech: One-Click Migration SQL (Safe / Idempotent)
-- Run this in Supabase Dashboard -> SQL Editor -> + New query -> Run
-- Fixes:
--   1. Adds missing columns (fse_email, ppm_cycle_days, last_ppm_date, next_ppm_date, photo_url)
--   2. Creates submitted_ppms table for cross-device FSE submissions & Admin Accept/Override
--   3. Enforces Admin-only edits for Fuel Level AND Light & Battery (BUB)
--   4. Adds RPCs for FSE PPM submission and cross-device sync
--   5. Resets current_dl to 0 while preserving daily usage (cpd)
-- =============================================================================

-- 1. Add missing columns to public.sites, public.ppm_checklists, and public.calendar_tasks
alter table public.sites add column if not exists fse_email text;
alter table public.sites add column if not exists ppm_cycle_days integer not null default 30;
alter table public.sites add column if not exists last_ppm_date date;
alter table public.sites add column if not exists next_ppm_date date;
alter table public.ppm_checklists add column if not exists photo_url text;
alter table public.calendar_tasks add column if not exists assignee_email text;
alter table public.calendar_tasks add column if not exists specific_issue text;
alter table public.calendar_tasks add column if not exists email_sent_at timestamptz;
alter table public.machinery_repairs add column if not exists attachment_url text;

-- 1B. Create app_settings table to persist Finance Team email & saved team emails across devices
create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "Read app_settings" on public.app_settings;
create policy "Read app_settings" on public.app_settings
  for select using (true);

drop policy if exists "Admin manage app_settings" on public.app_settings;
create policy "Admin manage app_settings" on public.app_settings
  for all using (public.is_admin());

-- 2. Create submitted_ppms table (FSE submits PPM -> Admin Reviews: PENDING / ACCEPTED / OVERRIDDEN)
create table if not exists public.submitted_ppms (
  id text primary key,
  site_id text not null references public.sites(site_id) on delete cascade,
  submitted_date date not null default current_date,
  submitted_at text not null,
  submitted_by text not null,
  completed_count integer not null default 0,
  total_count integer not null default 12,
  review_status text not null default 'PENDING' check (review_status in ('PENDING', 'ACCEPTED', 'OVERRIDDEN')),
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_submitted_ppms_site
  on public.submitted_ppms (site_id, created_at desc);

alter table public.submitted_ppms enable row level security;

drop policy if exists "Read submitted_ppms" on public.submitted_ppms;
create policy "Read submitted_ppms" on public.submitted_ppms
  for select using (true);

drop policy if exists "Admin manage submitted_ppms" on public.submitted_ppms;
create policy "Admin manage submitted_ppms" on public.submitted_ppms
  for all using (public.is_admin());

-- 3. FSE SECURITY DEFINER RPC: Submit PPM Report (verified by Site ID + Tenant ID)
create or replace function public.fse_submit_ppm(
  p_id text,
  p_site_id text,
  p_tenant_id text,
  p_submitted_date date,
  p_submitted_at text,
  p_submitted_by text,
  p_completed_count integer,
  p_total_count integer,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
begin
  select * into v_site from public.fse_verify_site(p_site_id, p_tenant_id);
  if not found then
    raise exception 'Unauthorized: Invalid Site ID or Tenant ID';
  end if;

  insert into public.submitted_ppms (
    id, site_id, submitted_date, submitted_at, submitted_by,
    completed_count, total_count, review_status, items
  ) values (
    p_id, v_site.site_id, p_submitted_date, p_submitted_at, p_submitted_by,
    p_completed_count, p_total_count, 'PENDING', p_items
  )
  on conflict (id) do update set
    completed_count = excluded.completed_count,
    items = excluded.items;

  return true;
end;
$$;

grant execute on function public.fse_submit_ppm(text, text, text, date, text, text, integer, integer, jsonb) to anon, authenticated;

-- 4. Ensure fse_update_contact exists (for saving FSE email)
create or replace function public.fse_update_contact(
  p_site_id text,
  p_tenant_id text,
  p_fse_name text,
  p_fse_phone text,
  p_fse_email text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site public.sites%rowtype;
begin
  select * into v_site from public.fse_verify_site(p_site_id, p_tenant_id);
  if not found then
    raise exception 'Unauthorized: Invalid Site ID or Tenant ID';
  end if;

  update public.sites
    set fse_name = coalesce(nullif(trim(p_fse_name), ''), fse_name),
        fse_phone = coalesce(nullif(trim(p_fse_phone), ''), fse_phone),
        fse_email = coalesce(nullif(trim(p_fse_email), ''), fse_email),
        updated_at = now()
    where site_id = v_site.site_id;
  return true;
end;
$$;

grant execute on function public.fse_update_contact(text, text, text, text, text) to anon, authenticated;

-- 5. Enforce Admin-only for Fuel Level AND Light & Battery (BUB) edits
do $$
begin
  revoke execute on function public.fse_update_fuel_level(text, text, numeric, numeric) from anon;
exception when undefined_function then null;
end $$;

do $$
begin
  revoke execute on function public.fse_update_bub_light(text, text, numeric, integer, text, text, numeric, text, text) from anon;
exception when undefined_function then null;
end $$;

-- 6. Reset all active sites' current diesel level to 0 while preserving daily usage (cpd)
update public.sites
set current_dl = 0,
    updated_at = now()
where is_active = true;

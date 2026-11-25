-- =============================================================================
-- ColoPlus Tech: Smart Diesel, Light & BUB, Repairs & PPM Supabase Schema
-- =============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. ACTIVE SITES TABLE (Admin-only write access via RLS)
-- -----------------------------------------------------------------------------
create table if not exists public.sites (
  site_id text primary key,
  tenant_id text not null,
  state text not null,
  address text not null,
  fse_name text not null,
  fse_phone text not null,
  fse_email text,
  ppm_cycle_days integer not null default 30,
  last_ppm_date date,
  next_ppm_date date,
  security_name text,
  security_phone text,
  power_source text default 'In-house',
  grid_status text default 'ONLINE (NEPA AVAILABLE)',
  grid_hours_per_day numeric(4,1) default 12.0,
  nepa_token_status text default 'LOADED',
  load_kw numeric(6,2) default 0,
  tank_cap numeric(10,2) not null default 1000,
  current_dl numeric(10,2) not null default 0,
  cpd numeric(8,2) not null default 40,
  cph numeric(8,2) generated always as (round((cpd / 24.0)::numeric, 2)) stored,
  battery_soc integer default 85 check (battery_soc between 0 and 100),
  battery_voltage text default '52.8 V',
  battery_autonomy_hours numeric(5,1) default 8.0,
  battery_status text default 'HEALTHY',
  last_supply_qty numeric(10,2) default 0,
  last_supply_date date,
  last_supply_time time,
  previous_supply_date date,
  previous_supply_time time,
  previous_supply_qty numeric(10,2),
  supplier text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. DIESEL DELIVERIES LEDGER (FSE & Admin can insert)
-- -----------------------------------------------------------------------------
create table if not exists public.diesel_deliveries (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(site_id) on delete cascade,
  qty_litres numeric(10,2) not null check (qty_litres > 0),
  received_date date not null,
  received_time time not null,
  supplier text not null,
  logged_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_deliveries_site_date
  on public.diesel_deliveries (site_id, received_date desc, received_time desc);

-- -----------------------------------------------------------------------------
-- 3. HOURLY DIESEL SCANS (Automated via pg_cron or Edge Function)
-- -----------------------------------------------------------------------------
create table if not exists public.hourly_diesel_scans (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(site_id) on delete cascade,
  scanned_at timestamptz not null default now(),
  diesel_level_l numeric(10,2) not null,
  cph_deducted numeric(8,2) not null,
  days_remaining numeric(6,1) not null,
  status text not null check (status in ('CRITICAL', 'WARNING', 'HEALTHY')),
  alert_triggered boolean not null default false
);

create index if not exists idx_hourly_scans_time
  on public.hourly_diesel_scans (scanned_at desc, site_id);

-- -----------------------------------------------------------------------------
-- 4. MACHINERY REPAIRS & CONSTANT-REPAIR ASSETS
-- -----------------------------------------------------------------------------
create table if not exists public.machinery_repairs (
  id uuid primary key default gen_random_uuid(),
  ticket_id text unique not null,
  site_id text not null references public.sites(site_id) on delete cascade,
  machinery_name text not null,
  issue text not null,
  is_constant_repair boolean not null default false,
  repeat_count integer not null default 1,
  priority text not null default 'High' check (priority in ('Low', 'Medium', 'High', 'Critical')),
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Resolved')),
  technician text,
  cost_ngn numeric(12,2) default 0,
  logged_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. SITE PPM MAINTENANCE CHECKLISTS
-- -----------------------------------------------------------------------------
create table if not exists public.ppm_checklists (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(site_id) on delete cascade,
  task text not null,
  category text not null default 'PPM',
  done boolean not null default false,
  photo_url text,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. CALENDAR & TASKS
-- -----------------------------------------------------------------------------
create table if not exists public.calendar_tasks (
  id uuid primary key default gen_random_uuid(),
  site_id text references public.sites(site_id) on delete set null,
  title text not null,
  due_date date not null,
  category text not null default 'GENERAL' check (category in ('FUEL', 'BUB', 'PPM', 'GENERAL')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. HOURLY DIESEL SCAN STORED PROCEDURE (for pg_cron)
-- -----------------------------------------------------------------------------
create or replace function public.run_hourly_diesel_scan()
returns void
language plpgsql
security definer
as $$
declare
  rec record;
  new_dl numeric(10,2);
  days_left numeric(6,1);
  site_status text;
begin
  for rec in select * from public.sites where is_active = true loop
    new_dl := greatest(0, round((rec.current_dl - rec.cph)::numeric, 2));
    days_left := round((new_dl / greatest(rec.cpd, 1))::numeric, 1);

    if days_left <= 2.0 then
      site_status := 'CRITICAL';
    elsif days_left <= 4.0 then
      site_status := 'WARNING';
    else
      site_status := 'HEALTHY';
    end if;

    update public.sites
      set current_dl = new_dl,
          updated_at = now()
      where site_id = rec.site_id;

    insert into public.hourly_diesel_scans (
      site_id, diesel_level_l, cph_deducted, days_remaining, status, alert_triggered
    ) values (
      rec.site_id, new_dl, rec.cph, days_left, site_status, (new_dl <= 200 or days_left <= 2.0)
    );
  end loop;
end;
$$;

-- Schedule hourly scan via pg_cron (enable pg_cron extension in Supabase Dashboard first):
-- select cron.schedule('coloplus-hourly-diesel-scan', '0 * * * *', $$select public.run_hourly_diesel_scan();$$);

-- -----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY (RLS) — Admin-Only Site Editing
-- -----------------------------------------------------------------------------
alter table public.sites enable row level security;
alter table public.diesel_deliveries enable row level security;
alter table public.hourly_diesel_scans enable row level security;
alter table public.machinery_repairs enable row level security;
alter table public.ppm_checklists enable row level security;
alter table public.calendar_tasks enable row level security;

-- Helper function to check Admin role claim in JWT
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- Sites: Public/FSE read active sites; ONLY Admin can insert/update/delete master sites
create policy "Read active sites" on public.sites
  for select using (is_active = true);

create policy "Admin only insert sites" on public.sites
  for insert with check (public.is_admin());

create policy "Admin only update sites" on public.sites
  for update using (public.is_admin());

create policy "Admin only delete sites" on public.sites
  for delete using (public.is_admin());

-- Operational logs: Authenticated FSEs & Admins can read and insert
create policy "Read deliveries" on public.diesel_deliveries for select using (true);
create policy "Insert deliveries" on public.diesel_deliveries for insert with check (auth.role() = 'authenticated');

create policy "Read hourly scans" on public.hourly_diesel_scans for select using (true);

create policy "Read repairs" on public.machinery_repairs for select using (true);
create policy "Insert repairs" on public.machinery_repairs for insert with check (auth.role() = 'authenticated');
create policy "Update repairs" on public.machinery_repairs for update using (auth.role() = 'authenticated');

create policy "Read ppm" on public.ppm_checklists for select using (true);
create policy "Manage ppm" on public.ppm_checklists for all using (auth.role() = 'authenticated');

create policy "Read tasks" on public.calendar_tasks for select using (true);
create policy "Manage tasks" on public.calendar_tasks for all using (auth.role() = 'authenticated');

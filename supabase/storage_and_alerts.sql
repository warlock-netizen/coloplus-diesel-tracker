-- =============================================================================
-- ColoPlus Tech: Supabase Storage (ppm-evidence) & Real-Time Alert Triggers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SUPABASE STORAGE BUCKET: ppm-evidence (20MB limit, image/* & video/*)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ppm-evidence',
  'ppm-evidence',
  true,
  20971520, -- 20 MB in bytes
  array['image/*', 'video/*']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS Policies for ppm-evidence
-- Allows FSEs (via anon/publishable key after site verification) and Admins
-- to upload, view, update, and delete PPM photo/video evidence.
drop policy if exists "Public read ppm-evidence" on storage.objects;
create policy "Public read ppm-evidence"
  on storage.objects for select
  using (bucket_id = 'ppm-evidence');

drop policy if exists "Allow upload ppm-evidence" on storage.objects;
create policy "Allow upload ppm-evidence"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'ppm-evidence');

drop policy if exists "Allow update ppm-evidence" on storage.objects;
create policy "Allow update ppm-evidence"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'ppm-evidence');

drop policy if exists "Allow delete ppm-evidence" on storage.objects;
create policy "Allow delete ppm-evidence"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'ppm-evidence');

-- -----------------------------------------------------------------------------
-- 2. ALERT LOGS TABLE (Ready for Supabase Database Webhooks -> WhatsApp/Email)
-- -----------------------------------------------------------------------------
create table if not exists public.alert_logs (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references public.sites(site_id) on delete cascade,
  scan_id uuid references public.hourly_diesel_scans(id) on delete set null,
  diesel_level_l numeric(10,2) not null,
  days_remaining numeric(6,1) not null,
  severity text not null check (severity in ('CRITICAL', 'WARNING')),
  message text not null,
  webhook_dispatched boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_alert_logs_created_at
  on public.alert_logs (created_at desc, site_id);

alter table public.alert_logs enable row level security;

drop policy if exists "Read alert_logs" on public.alert_logs;
create policy "Read alert_logs"
  on public.alert_logs for select
  using (true);

drop policy if exists "Admin update alert_logs" on public.alert_logs;
create policy "Admin update alert_logs"
  on public.alert_logs for update
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 3. REAL-TIME TRIGGER ON HOURLY DIESEL SCANS (alert_triggered = true)
-- -----------------------------------------------------------------------------
create or replace function public.handle_hourly_scan_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_severity text;
  v_msg text;
begin
  v_severity := case
    when new.diesel_level_l <= 200 or new.days_remaining <= 2.0 then 'CRITICAL'
    else 'WARNING'
  end;

  v_msg := format(
    '[%s] Site %s low diesel alert: %s L remaining (%s days autonomy). Immediate reorder required.',
    v_severity,
    new.site_id,
    to_char(new.diesel_level_l, 'FM999990.0'),
    to_char(new.days_remaining, 'FM990.0')
  );

  insert into public.alert_logs (
    site_id,
    scan_id,
    diesel_level_l,
    days_remaining,
    severity,
    message
  ) values (
    new.site_id,
    new.id,
    new.diesel_level_l,
    new.days_remaining,
    v_severity,
    v_msg
  );

  return new;
end;
$$;

drop trigger if exists trg_hourly_scan_alert on public.hourly_diesel_scans;
create trigger trg_hourly_scan_alert
  after insert on public.hourly_diesel_scans
  for each row
  when (new.alert_triggered = true)
  execute function public.handle_hourly_scan_alert();

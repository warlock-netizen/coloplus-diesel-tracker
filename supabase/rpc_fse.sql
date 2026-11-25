-- =============================================================================
-- ColoPlus Tech: SECURITY DEFINER RPCs for FSE Site-Verified Operational Writes
-- Run this in Supabase SQL Editor so FSEs can log operational updates using
-- their Site ID + Tenant ID without needing individual Supabase Auth accounts.
-- =============================================================================

-- Helper: Verify active Site ID + Tenant ID
create or replace function public.fse_verify_site(p_site_id text, p_tenant_id text)
returns setof public.sites
language sql
security definer
set search_path = public
as $$
  select * from public.sites
  where is_active = true
    and upper(trim(site_id)) = upper(trim(p_site_id))
    and (
      upper(trim(tenant_id)) = upper(trim(p_tenant_id))
      or upper(trim(split_part(tenant_id, '(', 1))) = upper(trim(p_tenant_id))
    )
  limit 1;
$$;

-- 1. FSE Update Fuel Level & CPD
create or replace function public.fse_update_fuel_level(
  p_site_id text,
  p_tenant_id text,
  p_current_dl numeric,
  p_cpd numeric
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
    set current_dl = greatest(0, p_current_dl),
        cpd = greatest(1, p_cpd),
        updated_at = now()
    where site_id = v_site.site_id;
  return true;
end;
$$;

-- 2. FSE Log Diesel Delivery (Date + Time + Shifts Previous Date)
create or replace function public.fse_log_delivery(
  p_site_id text,
  p_tenant_id text,
  p_qty numeric,
  p_date date,
  p_time time,
  p_supplier text,
  p_logged_by text
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

  insert into public.diesel_deliveries (site_id, qty_litres, received_date, received_time, supplier, logged_by)
  values (v_site.site_id, p_qty, p_date, p_time, p_supplier, p_logged_by);

  update public.sites
    set previous_supply_date = v_site.last_supply_date,
        previous_supply_time = v_site.last_supply_time,
        previous_supply_qty = v_site.last_supply_qty,
        last_supply_qty = p_qty,
        last_supply_date = p_date,
        last_supply_time = p_time,
        supplier = p_supplier,
        current_dl = least(v_site.tank_cap, v_site.current_dl + p_qty),
        updated_at = now()
    where site_id = v_site.site_id;

  return true;
end;
$$;

-- 3. FSE Update Light & Battery (BUB) Telemetry
create or replace function public.fse_update_bub_light(
  p_site_id text,
  p_tenant_id text,
  p_batt_hrs numeric,
  p_batt_soc integer,
  p_batt_volt text,
  p_batt_status text,
  p_grid_hrs numeric,
  p_grid_status text,
  p_token_status text
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
    set battery_autonomy_hours = coalesce(p_batt_hrs, battery_autonomy_hours),
        battery_soc = coalesce(p_batt_soc, battery_soc),
        battery_voltage = coalesce(p_batt_volt, battery_voltage),
        battery_status = coalesce(p_batt_status, battery_status),
        grid_hours_per_day = coalesce(p_grid_hrs, grid_hours_per_day),
        grid_status = coalesce(p_grid_status, grid_status),
        nepa_token_status = coalesce(p_token_status, nepa_token_status),
        updated_at = now()
    where site_id = v_site.site_id;

  return true;
end;
$$;

-- 4. FSE Log Machinery Repair / Constant-Repair Asset
create or replace function public.fse_log_repair(
  p_site_id text,
  p_tenant_id text,
  p_machinery text,
  p_issue text,
  p_logged_by text
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

  insert into public.machinery_repairs (
    ticket_id, site_id, machinery_name, issue, is_constant_repair, repeat_count, priority, status, technician
  ) values (
    'RCA-' || extract(epoch from now())::bigint::text,
    v_site.site_id, p_machinery, p_issue, true, 1, 'High', 'Open', p_logged_by
  );

  return true;
end;
$$;

-- 5. Calendar Task Insert (accessible to FSE & Admin)
create or replace function public.fse_add_task(
  p_site_id text,
  p_title text,
  p_due_date date,
  p_category text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.calendar_tasks (site_id, title, due_date, category, done)
  values (nullif(p_site_id, 'ALL SITES'), p_title, p_due_date, p_category, false)
  returning id into v_id;
  return v_id;
end;
$$;

-- Grant execute permissions to anon & authenticated clients
grant execute on function public.fse_verify_site(text, text) to anon, authenticated;
grant execute on function public.fse_update_fuel_level(text, text, numeric, numeric) to anon, authenticated;
grant execute on function public.fse_log_delivery(text, text, numeric, date, time, text, text) to anon, authenticated;
grant execute on function public.fse_update_bub_light(text, text, numeric, integer, text, text, numeric, text, text) to anon, authenticated;
grant execute on function public.fse_log_repair(text, text, text, text, text) to anon, authenticated;
grant execute on function public.fse_add_task(text, text, date, text) to anon, authenticated;

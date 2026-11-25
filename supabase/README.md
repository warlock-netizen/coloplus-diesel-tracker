# ColoPlus Tech — Supabase Backend Architecture

This directory contains the PostgreSQL database schema, Row Level Security (RLS) policies, and automated **Hourly Diesel Scan** procedure for deploying the ColoPlus Tech backend on **Supabase**.

## 1. Database Tables ([`schema.sql`](./schema.sql))

| Table | Purpose | Write Access |
| :--- | :--- | :--- |
| `sites` | Master record for the 14 active tower sites (fuel level, CPD/CPH, BUB battery, light hours, FSE & tenant details) | **Admin Only** (`app_metadata.role = 'admin'`) |
| `diesel_deliveries` | Audit ledger of diesel deliveries (quantity, date received, **time received**, supplier, FSE) | Authenticated FSE & Admin |
| `hourly_diesel_scans` | Hourly automated snapshots of diesel levels, CPH deducted, autonomy days, and alert flags | System (`pg_cron` / Edge Function) |
| `machinery_repairs` | Repairs & PPM tickets plus **machinery requiring constant repair** (`is_constant_repair`, `repeat_count`) | Authenticated FSE & Admin |
| `ppm_checklists` | Per-site Preventive & Planned Maintenance (PPM) punch lists | Authenticated FSE & Admin |
| `calendar_tasks` | Scheduled refuels, PPM inspections, and field tasks | Authenticated FSE & Admin |

## 2. Site Login Verification Flow
1. User enters **`site_id`** and **`tenant_id`** in the frontend.
2. Query Supabase (or RPC) to verify matching active site:
   ```sql
   select site_id, tenant_id, state, address, fse_name, fse_phone
   from public.sites
   where upper(site_id) = upper($1)
     and upper(tenant_id) = upper($2)
     and is_active = true;
   ```
3. On match, the frontend displays the **FSE Detail Popup** with the verified FSE contact and unlocks the site workspace.

## 3. Hourly Diesel Scan Setup
In the Supabase Dashboard:
1. Run [`schema.sql`](./schema.sql) in the **SQL Editor**.
2. Enable **`pg_cron`** under **Database → Extensions**.
3. Run the cron schedule statement:
   ```sql
   select cron.schedule(
     'coloplus-hourly-diesel-scan',
     '0 * * * *',
     $$select public.run_hourly_diesel_scan();$$
   );
   ```
This automatically deducts 1 hour of `cph` from each active site every hour, updates `current_dl`, and logs alerts to `hourly_diesel_scans` whenever a site drops to `<= 200L` or `<= 2.0` days autonomy.

## 4. Resend Email Alerts (`send-alert-email` Edge Function)
[`supabase/functions/send-alert-email/index.ts`](./functions/send-alert-email/index.ts) sends critical diesel alerts via **Resend** to the site's `fse_email` and `ADMIN_ALERT_EMAIL`:

1. Create an API key at [resend.com](https://resend.com).
2. In Supabase Dashboard (**Edge Functions → Secrets** or via CLI), set:
   - `RESEND_API_KEY` = `re_...`
   - `ADMIN_ALERT_EMAIL` = `your-admin-email@example.com`
   - `RESEND_FROM_EMAIL` = `ColoPlus NOC <onboarding@resend.dev>` (or your verified domain)
3. Deploy the Edge Function:
   ```bash
   supabase functions deploy send-alert-email
   ```
4. In Supabase Dashboard → **Database → Webhooks → Create a new hook**:
   - **Table:** `public.alert_logs`
   - **Events:** `Insert`
   - **Type:** `Supabase Edge Functions` → select `send-alert-email`.


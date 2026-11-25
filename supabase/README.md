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

## 4. Resend Email Alerts, Finance Notices, PPM Reminders & Password Recovery

[`supabase/functions/send-alert-email/index.ts`](./functions/send-alert-email/index.ts) uses **Resend** to handle:
- **Critical Diesel Alerts** (`alert_logs` webhook) → emails **Admin**, **Finance Team**, and **Site FSE**
- **Diesel Delivery Notices** (`type: "DIESEL_DELIVERY"`) → emails **Finance Team** and **Admin**
- **PPM Cycle Reminders** (`type: "PPM_REMINDER"`) → emails **Site FSE (`fse_email`)** and **Admin**

### Setup Steps
1. In **Supabase Dashboard → Edge Functions → Secrets**, add:
   - `RESEND_API_KEY` = your Resend API key (`re_...`)
   - `ADMIN_ALERT_EMAIL` = Admin email address
   - `FINANCE_TEAM_EMAIL` = Finance team email address
   - `RESEND_FROM_EMAIL` = `ColoPlus NOC <onboarding@resend.dev>` *(or your verified domain)*
2. Deploy the Edge Function:
   ```bash
   supabase functions deploy send-alert-email
   ```
3. In **Database → Webhooks → Create a new hook**:
   - **Table:** `public.alert_logs` | **Events:** `Insert` | **Target:** `send-alert-email` Edge Function.
4. **Password Recovery via Resend SMTP:**
   - Go to **Supabase Dashboard → Project Settings → Authentication → SMTP Settings**.
   - Enable **Custom SMTP** and enter:
     - **Host:** `smtp.resend.com`
     - **Port:** `465`
     - **Username:** `resend`
     - **Password:** your Resend API key (`re_...`)
     - **Sender email:** `onboarding@resend.dev` *(or your verified Resend domain)*
   - Now clicking **FORGOT PASSWORD?** in the Admin Portal sends recovery emails through Resend.


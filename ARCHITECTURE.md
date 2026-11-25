# ColoPlus Tech — Technical Architecture

This document describes the system architecture, security boundaries, database schema, and mathematical correlation engine powering **[ColoPlus Tech](https://coloplus-diesel-tracker.vercel.app/)**.

---

## 1. High-Level Component Architecture

```mermaid
flowchart TD
    UI["Single-Page Frontend (index.html)\nVanilla JS + Tailwind CSS + SVG Charts"]
    CACHE["Browser localStorage\n(Offline Cache & Session State)"]

    subgraph Supabase["Supabase Platform (kfomqkklnqrosxjxdlsu)"]
        AUTH["Supabase Auth (JWT)\nAdmin Email + Password"]
        REST["PostgREST API\n(RLS Enforced)"]
        RPC["SECURITY DEFINER RPCs\n(Site ID + Tenant ID Verified)"]
        STORAGE["Supabase Storage\nBucket: ppm-evidence (20MB)"]
        PG[("PostgreSQL Database")]
        CRON["pg_cron Scheduler\nHourly Diesel Scan"]
        HOOK["Database Webhook\nalert_logs INSERT"]
        EDGE["Deno Edge Function\nsend-alert-email"]
    end

    RESEND["Resend API & SMTP\n(Finance, Admin, FSE Emails)"]

    UI <--> CACHE
    UI -->|"Admin Auth"| AUTH
    UI -->|"Admin CRUD"| REST --> PG
    UI -->|"FSE Verified Writes"| RPC --> PG
    UI -->|"PPM Photo/Video"| STORAGE
    UI -->|"Delivery / Ticket / Custom Email"| EDGE
    CRON -->|"Hourly CPH Deduction"| PG
    PG -->|"Trigger -> alert_logs"| HOOK --> EDGE --> RESEND
    AUTH -->|"Password Recovery"| RESEND
```

---

## 2. Database Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    SITES ||--o{ DIESEL_DELIVERIES : receives
    SITES ||--o{ HOURLY_DIESEL_SCANS : tracked_by
    SITES ||--o{ MACHINERY_REPAIRS : logs
    SITES ||--o{ PPM_CHECKLISTS : maintains
    SITES ||--o{ CALENDAR_TASKS : schedules
    SITES ||--o{ ALERT_LOGS : triggers

    SITES {
        text site_id PK
        text tenant_id
        text state
        text address
        text fse_name
        text fse_phone
        text fse_email
        numeric load_kw
        numeric tank_cap
        numeric current_dl
        numeric cpd
        numeric cph
        integer battery_soc
        numeric battery_autonomy_hours
        numeric grid_hours_per_day
        integer ppm_cycle_days
        date last_ppm_date
        date next_ppm_date
        boolean is_active
        timestamptz updated_at
    }

    DIESEL_DELIVERIES {
        uuid id PK
        text site_id FK
        numeric qty_litres
        date received_date
        time received_time
        text supplier
        text logged_by
    }

    HOURLY_DIESEL_SCANS {
        uuid id PK
        text site_id FK
        timestamptz scanned_at
        numeric diesel_level_l
        numeric cph_deducted
        numeric days_remaining
        text status
        boolean alert_triggered
    }

    MACHINERY_REPAIRS {
        uuid id PK
        text ticket_id UK
        text site_id FK
        text machinery_name
        text issue
        boolean is_constant_repair
        integer repeat_count
        text status
        text technician
    }

    PPM_CHECKLISTS {
        uuid id PK
        text site_id FK
        text task
        text category
        boolean done
        text photo_url
    }

    CALENDAR_TASKS {
        uuid id PK
        text site_id FK
        text title
        date due_date
        text category
        boolean done
    }

    ALERT_LOGS {
        uuid id PK
        text site_id FK
        text alert_type
        text severity
        text message
        boolean acknowledged
    }
```

---

## 3. Authentication & Security Model

### Dual-Tier Access Control
1. **Admin Tier (Full Write Authorization)**
   - Authenticates via `supabase.auth.signInWithPassword({ email, password })`.
   - Frontend and PostgreSQL RLS both verify `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'` via `public.is_admin()`.
   - Exclusive permissions:
     - `INSERT` / `UPDATE` / `DELETE` on `public.sites` (including direct fuel calibration, generator size `load_kw`, adding/deactivating sites, and PPM timing).
     - Editing, adding, toggling, and deleting tasks on the 2-Month Calendar.
     - Resolving repair tickets and sending custom Resend emails.

2. **FSE Tier (Site-Scoped Operational Writes)**
   - Field engineers authenticate with **`Site ID` + `Tenant ID`** (no individual Supabase Auth account required).
   - All FSE database mutations execute through **`SECURITY DEFINER` PostgreSQL RPCs** (`supabase/rpc_fse.sql`), which call `public.fse_verify_site(p_site_id, p_tenant_id)` before modifying operational records:
     - `fse_log_delivery` — inserts into `diesel_deliveries` and shifts `last_supply_*` → `previous_supply_*`.
     - `fse_update_bub_light` — updates battery life, SOC, voltage, and utility light hours.
     - `fse_log_repair` — records site-locked repair tickets in `machinery_repairs`.
     - `fse_update_contact` — updates FSE name, phone, and email for PPM reminders.
   - `anon` execute access to `fse_update_fuel_level` is explicitly revoked so only Admins can directly calibrate tank levels.

3. **Zero Secrets in Frontend**
   - Only `NEXT_PUBLIC_SUPABASE_URL_1` and the public `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_1` exist in `index.html`.
   - `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_ALERT_EMAIL`, and `FINANCE_TEAM_EMAIL` live strictly inside **Supabase Edge Function Secrets** and **Supabase Auth SMTP Settings**.

---

## 4. Event & Notification Flow

```mermaid
sequenceDiagram
    participant FSE as Field Engineer (FSE)
    participant UI as ColoPlus Web App
    participant SB as Supabase DB & Storage
    participant EF as Edge Function (send-alert-email)
    participant RS as Resend API

    FSE->>UI: Login (Site ID + Tenant ID)
    UI->>FSE: Open FSE Detail Popup (Name, Phone, Email)
    FSE->>UI: Log Diesel Delivery (Date + Time + Qty)
    UI->>SB: RPC fse_log_delivery()
    UI->>EF: Invoke type="DIESEL_DELIVERY"
    EF->>RS: Email Finance Team & Admin

    FSE->>UI: Log Site Repair Ticket
    UI->>SB: RPC fse_log_repair()
    UI->>EF: Invoke type="REPAIR_TICKET"
    EF->>RS: Email Admin & Finance Team
    UI-->>UI: Trigger Admin Dashboard Alert Banner

    Note over SB: Every Hour (pg_cron 0 * * * *)
    SB->>SB: run_hourly_diesel_scan()
    SB->>SB: Insert alert_logs if DL <= 200L or <= 2.0d
    SB->>EF: Database Webhook (alert_logs INSERT)
    EF->>RS: Email Critical Alert to Admin, Finance & FSE
```

---

## 5. Mathematical Telemetry Engine

- **Hourly Burn Rate:** $\text{CPH} = \text{CPD} / 24$
- **12-Hour Shift Burn:** $\text{CPD}_{12h} = \text{CPD} / 2$
- **Live Date-Synchronized Fuel Level:**
  $$\text{currentDL} = \max\left(0,\; \text{baselineDL} - \text{CPH} \times \text{elapsedHoursSinceBaseline}\right)$$
- **Autonomy Days Remaining:** $\text{Days} = \text{currentDL} / \text{CPD}$
- **Status Thresholds:**
  - `CRITICAL`: $\text{Days} \le 2.0$ or $\text{currentDL} \le 200\text{ L}$
  - `WARNING`: $2.0 < \text{Days} \le 4.0$
  - `HEALTHY`: $\text{Days} > 4.0$
- **PPM Cycle Calendar Scheduling:**
  - Automatically derives `nextPpmDate` from `hoursToPpm / max(4, 24 - gridHoursPerDay)` (250 DG RH cycle) unless overridden by Admin's custom `lastPpmDate + ppmCycleDays`.

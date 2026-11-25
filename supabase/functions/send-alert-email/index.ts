// Supabase Edge Function: send-alert-email
// Handles:
//   1. Database Webhook on `public.alert_logs` (INSERT) -> Critical diesel alerts to Admin, Finance & FSE
//   2. `type: "DIESEL_DELIVERY"` -> Refuel cost & quantity notice to Finance Team & Admin
//   3. `type: "PPM_REMINDER"` -> Automated PPM cycle reminders to FSE (`fse_email`) & Admin

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "ColoPlus NOC <onboarding@resend.dev>";
const ADMIN_ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL") ?? "";
const FINANCE_TEAM_EMAIL = Deno.env.get("FINANCE_TEAM_EMAIL") ?? "";

async function sendResendEmail(to: string[], subject: string, html: string) {
  const cleanTo = [...new Set(to.map((e) => e.trim()).filter(Boolean))];
  if (cleanTo.length === 0) {
    return { skipped: true, reason: "No recipients configured" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: cleanTo, subject, html }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing RESEND_API_KEY secret" }), { status: 500 });
    }

    const payload = await req.json();
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const eventType: string = payload.type ?? "ALERT_LOG";

    // -------------------------------------------------------------------------
    // MODE 1: PPM CYCLE REMINDERS (to FSEs & Admin for sites due within 3 days)
    // -------------------------------------------------------------------------
    if (eventType === "PPM_REMINDER") {
      const targetSiteId: string | undefined = payload.site_id;
      const today = new Date();
      const horizon = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      let query = sb
        .from("sites")
        .select("site_id, tenant_id, state, address, fse_name, fse_email, ppm_cycle_days, last_ppm_date, next_ppm_date")
        .eq("is_active", true);

      if (targetSiteId) {
        query = query.eq("site_id", targetSiteId);
      } else {
        query = query.lte("next_ppm_date", horizon);
      }

      const { data: dueSites, error } = await query;
      if (error) throw error;

      const results = [];
      for (const s of dueSites ?? []) {
        const recipients: string[] = [];
        if (s.fse_email) recipients.push(s.fse_email);
        if (ADMIN_ALERT_EMAIL) recipients.push(ADMIN_ALERT_EMAIL);

        const subject = `[PPM REMINDER] Scheduled Maintenance Due (${s.next_ppm_date ?? "Soon"}) — ${s.site_id}`;
        const html = `
          <div style="font-family: monospace; background:#0b0d10; color:#f4f3ef; padding:24px; border:1px solid #333;">
            <h2 style="margin:0 0 12px; color:#22c55e;">// COLOPLUS TECH — PPM CYCLE REMINDER</h2>
            <p>Hello <strong>${s.fse_name ?? "FSE"}</strong>, regular Preventive &amp; Planned Maintenance (PPM) is due for your site.</p>
            <table style="width:100%; border-collapse:collapse; font-size:13px; margin:12px 0;">
              <tr><td style="padding:6px; border:1px solid #333;"><strong>Site ID</strong></td><td style="padding:6px; border:1px solid #333;">${s.site_id} (${s.tenant_id})</td></tr>
              <tr><td style="padding:6px; border:1px solid #333;"><strong>Location</strong></td><td style="padding:6px; border:1px solid #333;">${s.state} — ${s.address}</td></tr>
              <tr><td style="padding:6px; border:1px solid #333;"><strong>Cycle Period</strong></td><td style="padding:6px; border:1px solid #333;">${s.ppm_cycle_days ?? 30} Days (Last: ${s.last_ppm_date ?? "N/A"})</td></tr>
              <tr><td style="padding:6px; border:1px solid #333;"><strong>Next PPM Due Date</strong></td><td style="padding:6px; border:1px solid #333; color:#f59e0b;"><strong>${s.next_ppm_date ?? "N/A"}</strong></td></tr>
            </table>
            <p style="font-size:12px; opacity:0.8;">Please complete the 12-item PPM checklist (AVR, Top Gasket, Radiator, Fan Belt, Breaker, Modules, Solenoids, Kick Starters, BUB, Rectifier, DG RH, Janitor) and attach photo/video proof.</p>
          </div>
        `;
        results.push({ site_id: s.site_id, ...(await sendResendEmail(recipients, subject, html)) });
      }

      return new Response(JSON.stringify({ ok: true, reminders_sent: results.length, results }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // -------------------------------------------------------------------------
    // MODE 2: DIESEL DELIVERY NOTICE (to Finance Team & Admin)
    // -------------------------------------------------------------------------
    if (eventType === "DIESEL_DELIVERY") {
      const recipients: string[] = [];
      if (FINANCE_TEAM_EMAIL) recipients.push(FINANCE_TEAM_EMAIL);
      if (ADMIN_ALERT_EMAIL) recipients.push(ADMIN_ALERT_EMAIL);

      const subject = `[FINANCE & NOC] Diesel Delivery Logged — ${payload.site_id} (+${payload.qty}L)`;
      const html = `
        <div style="font-family: monospace; background:#0b0d10; color:#f4f3ef; padding:24px; border:1px solid #333;">
          <h2 style="margin:0 0 12px; color:#22c55e;">// DIESEL DELIVERY &amp; FINANCE AUDIT NOTICE</h2>
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Site ID</strong></td><td style="padding:6px; border:1px solid #333;">${payload.site_id}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Quantity Delivered</strong></td><td style="padding:6px; border:1px solid #333;">+${payload.qty} Litres</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Date &amp; Time Received</strong></td><td style="padding:6px; border:1px solid #333;">${payload.received_date} @ ${payload.received_time}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Supplier / Vendor</strong></td><td style="padding:6px; border:1px solid #333;">${payload.supplier}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Logged By</strong></td><td style="padding:6px; border:1px solid #333;">${payload.logged_by}</td></tr>
          </table>
        </div>
      `;
      const result = await sendResendEmail(recipients, subject, html);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // -------------------------------------------------------------------------
    // MODE 2B: NEW REPAIR / PPM TICKET ALERT (to Admin & Finance)
    // -------------------------------------------------------------------------
    if (eventType === "REPAIR_TICKET") {
      const recipients: string[] = [];
      if (ADMIN_ALERT_EMAIL) recipients.push(ADMIN_ALERT_EMAIL);
      if (FINANCE_TEAM_EMAIL) recipients.push(FINANCE_TEAM_EMAIL);

      const subject = `[REPAIR TICKET] ${payload.ticket_id ?? "NEW"} — ${payload.site_id} (${payload.category ?? "REPAIR"})`;
      const html = `
        <div style="font-family: monospace; background:#0b0d10; color:#f4f3ef; padding:24px; border:1px solid #333;">
          <h2 style="margin:0 0 12px; color:#f59e0b;">// NEW SITE REPAIR / PPM TICKET LOGGED</h2>
          <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Ticket ID</strong></td><td style="padding:6px; border:1px solid #333;">${payload.ticket_id ?? "N/A"}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Site ID</strong></td><td style="padding:6px; border:1px solid #333;">${payload.site_id} (${payload.tenant_id ?? ""})</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>State</strong></td><td style="padding:6px; border:1px solid #333;">${payload.state ?? "N/A"}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Category / Type</strong></td><td style="padding:6px; border:1px solid #333;">${payload.category ?? "GENERAL"}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Status</strong></td><td style="padding:6px; border:1px solid #333;">${payload.status ?? "OPEN"}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Technician / FSE</strong></td><td style="padding:6px; border:1px solid #333;">${payload.technician ?? "FSE"}</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Gen Run Hours</strong></td><td style="padding:6px; border:1px solid #333;">${payload.gen_run_hours ?? "N/A"} hrs</td></tr>
            <tr><td style="padding:6px; border:1px solid #333;"><strong>Issue Details</strong></td><td style="padding:6px; border:1px solid #333;">${payload.issue ?? ""}</td></tr>
          </table>
        </div>
      `;
      const result = await sendResendEmail(recipients, subject, html);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // -------------------------------------------------------------------------
    // MODE 3: CRITICAL DIESEL ALERT (alert_logs webhook -> Admin, Finance & FSE)
    // -------------------------------------------------------------------------
    const record = payload.record ?? payload;
    const siteId: string = record.site_id;
    const message: string = record.message ?? "Critical diesel / operational alert triggered.";
    const severity: string = record.severity ?? "CRITICAL";

    const { data: site } = await sb
      .from("sites")
      .select("site_id, tenant_id, state, address, fse_name, fse_email, current_dl, cpd")
      .eq("site_id", siteId)
      .maybeSingle();

    const recipients: string[] = [];
    if (site?.fse_email) recipients.push(site.fse_email);
    if (ADMIN_ALERT_EMAIL) recipients.push(ADMIN_ALERT_EMAIL);
    if (FINANCE_TEAM_EMAIL) recipients.push(FINANCE_TEAM_EMAIL);

    const dailyCostNgn = Math.round(Number(site?.cpd ?? 0) * 2100);
    const subject = `[${severity}] ColoPlus Diesel Alert — ${siteId}${site?.state ? ` (${site.state})` : ""}`;
    const html = `
      <div style="font-family: monospace; background:#0b0d10; color:#f4f3ef; padding:24px; border:1px solid #333;">
        <h2 style="margin:0 0 12px; color:#ef4444;">// COLOPLUS TECH — ${severity} ALERT</h2>
        <p style="margin:0 0 16px;">${message}</p>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <tr><td style="padding:6px; border:1px solid #333;"><strong>Site ID</strong></td><td style="padding:6px; border:1px solid #333;">${siteId}</td></tr>
          <tr><td style="padding:6px; border:1px solid #333;"><strong>Tenant ID</strong></td><td style="padding:6px; border:1px solid #333;">${site?.tenant_id ?? "N/A"}</td></tr>
          <tr><td style="padding:6px; border:1px solid #333;"><strong>State / Address</strong></td><td style="padding:6px; border:1px solid #333;">${site?.state ?? ""} — ${site?.address ?? ""}</td></tr>
          <tr><td style="padding:6px; border:1px solid #333;"><strong>FSE In Charge</strong></td><td style="padding:6px; border:1px solid #333;">${site?.fse_name ?? "N/A"}</td></tr>
          <tr><td style="padding:6px; border:1px solid #333;"><strong>Current Diesel</strong></td><td style="padding:6px; border:1px solid #333;">${site?.current_dl ?? "?"} L (CPD: ${site?.cpd ?? "?"} L/day)</td></tr>
          <tr><td style="padding:6px; border:1px solid #333;"><strong>Daily Burn Cost</strong></td><td style="padding:6px; border:1px solid #333;">NGN ${dailyCostNgn.toLocaleString()} / day</td></tr>
        </table>
      </div>
    `;

    const result = await sendResendEmail(recipients, subject, html);
    return new Response(JSON.stringify(result), {
      status: result.ok === false ? 502 : 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});

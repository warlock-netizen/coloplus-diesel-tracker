// Supabase Edge Function: send-alert-email
// Triggered by a Supabase Database Webhook on `public.alert_logs` (INSERT)
// Sends critical diesel & PPM alert emails via Resend (https://resend.com)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "ColoPlus NOC <alerts@resend.dev>";
const ADMIN_ALERT_EMAIL = Deno.env.get("ADMIN_ALERT_EMAIL") ?? "";

serve(async (req: Request) => {
  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing RESEND_API_KEY secret" }), { status: 500 });
    }

    const payload = await req.json();
    const record = payload.record ?? payload; // Supports Database Webhook payload or direct POST
    const siteId: string = record.site_id;
    const message: string = record.message ?? "Critical diesel / operational alert triggered.";
    const severity: string = record.severity ?? "CRITICAL";

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: site } = await sb
      .from("sites")
      .select("site_id, tenant_id, state, address, fse_name, fse_email, current_dl, cpd")
      .eq("site_id", siteId)
      .maybeSingle();

    const recipients: string[] = [];
    if (site?.fse_email) recipients.push(site.fse_email);
    if (ADMIN_ALERT_EMAIL && !recipients.includes(ADMIN_ALERT_EMAIL)) {
      recipients.push(ADMIN_ALERT_EMAIL);
    }

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "No fse_email or ADMIN_ALERT_EMAIL configured" }),
        { status: 200 }
      );
    }

    const subject = `[${severity}] ColoPlus Alert — ${siteId}${site?.state ? ` (${site.state})` : ""}`;
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
        </table>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipients,
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json();
    return new Response(JSON.stringify({ ok: resendRes.ok, resend: resendData }), {
      status: resendRes.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

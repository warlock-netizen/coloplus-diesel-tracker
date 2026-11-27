// Vercel Serverless Function: /api/send-email
// Native site email engine powered by Resend REST API (zero external dependencies)
// Env Vars (set in Vercel Project -> Settings -> Environment Variables):
//   RESEND_API_KEY       (required)
//   RESEND_FROM_EMAIL    (optional, defaults to "ColoPlus NOC <onboarding@resend.dev>")
//   ADMIN_ALERT_EMAIL    (optional, default Admin inbox)
//   FINANCE_TEAM_EMAIL   (optional, default Finance inbox)

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseEmailList(input) {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : String(input).split(/[,;\n]+/);
  return [...new Set(
    raw
      .map(s => String(s || '').trim())
      .filter(s => s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
  )];
}

function wrapBrandedHtml(title, accentHex, innerHtml, footerNote) {
  const accent = accentHex || '#22c55e';
  return `
    <div style="font-family: 'Courier New', Courier, monospace; background:#0b0d10; color:#f4f3ef; padding:24px; max-width:640px; margin:0 auto; border:1px solid #2b3038;">
      <div style="border-bottom:1px solid #2b3038; padding-bottom:14px; margin-bottom:18px;">
        <div style="font-size:11px; letter-spacing:2px; color:#a3a3a3; text-transform:uppercase;">COLOPLUS TECH // TELECOM ENERGY &amp; NOC COMMAND</div>
        <h2 style="margin:6px 0 0; font-size:18px; color:${accent}; letter-spacing:1px;">${escapeHtml(title)}</h2>
      </div>
      <div style="font-size:13px; line-height:1.65; color:#f4f3ef;">
        ${innerHtml}
      </div>
      <div style="margin-top:22px; padding-top:12px; border-top:1px solid #2b3038; font-size:11px; color:#a3a3a3;">
        ${escapeHtml(footerNote || 'Sent automatically from ColoPlus Tech Smart Diesel & Site Autonomy Platform.')}
      </div>
    </div>
  `;
}

function buildRowsTable(rows) {
  const trs = rows
    .filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '')
    .map(([k, v]) => `
      <tr>
        <td style="padding:7px 10px; border:1px solid #2b3038; color:#a3a3a3; width:38%; font-weight:bold;">${escapeHtml(k)}</td>
        <td style="padding:7px 10px; border:1px solid #2b3038; color:#f4f3ef;">${escapeHtml(v)}</td>
      </tr>
    `)
    .join('');
  return `<table style="width:100%; border-collapse:collapse; font-size:12px; margin:14px 0;">${trs}</table>`;
}

async function sendViaResend({ apiKey, from, to, cc, replyTo, subject, html }) {
  const body = { from, to, subject, html };
  if (cc && cc.length > 0) body.cc = cc;
  if (replyTo && replyTo.length > 0) body.reply_to = replyTo[0];

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  let data = {};
  try {
    data = await resp.json();
  } catch (_) {
    data = { message: 'Non-JSON response from Resend' };
  }

  let hint = '';
  const msg = String(data.message || data.error || '');
  if (!resp.ok && msg.toLowerCase().includes('only send testing emails')) {
    hint = 'Resend sandbox mode only allows sending to your own Resend account email until you verify a domain at resend.com/domains and set RESEND_FROM_EMAIL.';
  }

  return {
    ok: resp.ok,
    status: resp.status,
    id: data.id || null,
    to,
    error: resp.ok ? null : (msg || `Resend HTTP ${resp.status}`),
    hint,
    data
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
  const FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || 'ColoPlus NOC <onboarding@resend.dev>').trim();
  const ADMIN_ALERT_EMAIL = (process.env.ADMIN_ALERT_EMAIL || '').trim();
  const FINANCE_TEAM_EMAIL = (process.env.FINANCE_TEAM_EMAIL || '').trim();

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      configured: Boolean(RESEND_API_KEY),
      from: FROM_EMAIL,
      adminConfigured: Boolean(ADMIN_ALERT_EMAIL),
      financeConfigured: Boolean(FINANCE_TEAM_EMAIL)
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  if (!RESEND_API_KEY) {
    res.status(500).json({
      ok: false,
      error: 'Missing RESEND_API_KEY environment variable in Vercel.',
      hint: 'Add RESEND_API_KEY in Vercel Dashboard -> Settings -> Environment Variables and redeploy.'
    });
    return;
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (_) {
      res.status(400).json({ ok: false, error: 'Invalid JSON body' });
      return;
    }
  }
  payload = payload || {};

  const eventType = String(payload.type || 'CUSTOM_EMAIL').toUpperCase();
  const ccList = parseEmailList(payload.cc);
  const replyToList = parseEmailList(payload.reply_to || payload.replyTo);

  try {
    // -------------------------------------------------------------------------
    // 1. AUTOMATED FSE WELCOME & REMINDER EMAIL (triggered when FSE inputs email)
    // -------------------------------------------------------------------------
    if (eventType === 'FSE_WELCOME_REMINDER') {
      const to = parseEmailList(payload.to || payload.fse_email || payload.custom_email);
      if (to.length === 0) {
        res.status(400).json({ ok: false, error: 'Valid FSE email address is required' });
        return;
      }
      const siteId = payload.site_id || 'Assigned Site';
      const tenantId = payload.tenant_id || '';
      const fseName = payload.fse_name || 'Field Support Engineer';
      const nextPpm = payload.next_ppm_date || 'Check Portal Calendar';
      const lastPpm = payload.last_ppm_date || 'Not recorded';
      const cycleDays = payload.ppm_cycle_days ? `${payload.ppm_cycle_days} days` : '30 days';
      const currentDl = payload.current_dl != null ? `${payload.current_dl} L` : '0 L';
      const cpd = payload.cpd != null ? `${payload.cpd} L/day` : 'N/A';
      const autonomy = payload.autonomy || 'N/A';
      const triggerSource = payload.trigger_source || 'FSE Portal';

      const subject = payload.subject || `[COLOPLUS AUTO-REMINDER] ${siteId} — FSE Alert Channel Active (Next PPM: ${nextPpm})`;
      const inner = `
        <p style="margin:0 0 12px;">Hello <strong>${escapeHtml(fseName)}</strong>,</p>
        <p style="margin:0 0 12px;">Your email address has been registered on the <strong>ColoPlus Tech NOC Platform</strong> (${escapeHtml(triggerSource)}). You will automatically receive scheduled <strong>PPM Reminders</strong>, <strong>7-Day Diesel Depletion Alarms</strong>, and <strong>Site Task Assignments</strong> for your tower.</p>
        ${buildRowsTable([
          ['Site ID', tenantId ? `${siteId} (${tenantId})` : siteId],
          ['State / Location', [payload.state, payload.address].filter(Boolean).join(' — ')],
          ['Next Scheduled PPM', `${nextPpm} (Cycle: ${cycleDays})`],
          ['Last PPM Recorded', lastPpm],
          ['Live Diesel Level', `${currentDl} (Daily Usage: ${cpd})`],
          ['Fuel Autonomy Left', autonomy],
          ['Battery (BUB) Status', payload.battery_status || 'HEALTHY']
        ])}
        <p style="margin:12px 0 0; color:#f59e0b;"><strong>Reminder:</strong> Log incoming diesel deliveries with arrival dates in the FSE Portal and attach photo proof (*) for all 12 PPM checklist items before submitting your PPM report.</p>
      `;
      const html = wrapBrandedHtml('// AUTOMATED FSE REMINDER & ALERT REGISTRATION', '#22c55e', inner);
      const result = await sendViaResend({ apiKey: RESEND_API_KEY, from: FROM_EMAIL, to, cc: ccList, replyTo: replyToList, subject, html });
      res.status(result.ok ? 200 : 502).json(result);
      return;
    }

    // -------------------------------------------------------------------------
    // 2. PPM REMINDER (Single FSE or Batch of Registered FSEs)
    // -------------------------------------------------------------------------
    if (eventType === 'PPM_REMINDER') {
      const batch = Array.isArray(payload.sites) && payload.sites.length > 0
        ? payload.sites
        : [{
            site_id: payload.site_id,
            tenant_id: payload.tenant_id,
            state: payload.state,
            address: payload.address,
            fse_name: payload.fse_name,
            fse_email: payload.fse_email || payload.to || payload.custom_email,
            ppm_cycle_days: payload.ppm_cycle_days,
            last_ppm_date: payload.last_ppm_date,
            next_ppm_date: payload.next_ppm_date
          }];

      const results = [];
      for (const s of batch) {
        const recipients = parseEmailList(s.fse_email);
        if (payload.include_admin !== false && ADMIN_ALERT_EMAIL) recipients.push(ADMIN_ALERT_EMAIL);
        const clean = [...new Set(recipients)];
        if (clean.length === 0) continue;

        const subject = `[PPM REMINDER] Scheduled Maintenance Due (${s.next_ppm_date || 'Upcoming'}) — ${s.site_id || 'Site'}`;
        const inner = `
          <p style="margin:0 0 12px;">Hello <strong>${escapeHtml(s.fse_name || 'FSE')}</strong>, Preventive &amp; Planned Maintenance (PPM) is scheduled for your site.</p>
          ${buildRowsTable([
            ['Site ID', s.tenant_id ? `${s.site_id} (${s.tenant_id})` : (s.site_id || 'N/A')],
            ['Location', [s.state, s.address].filter(Boolean).join(' — ')],
            ['Last PPM Date', s.last_ppm_date || 'N/A'],
            ['Cycle Period', `${s.ppm_cycle_days || 30} days`],
            ['Next Scheduled PPM', s.next_ppm_date || 'Check Calendar']
          ])}
          <p style="margin:12px 0 0;">Please complete all 12 PPM checklist items with mandatory photo proof (*) in the FSE Portal.</p>
        `;
        const html = wrapBrandedHtml('// PPM SCHEDULE REMINDER', '#f59e0b', inner);
        const r = await sendViaResend({ apiKey: RESEND_API_KEY, from: FROM_EMAIL, to: clean, cc: ccList, replyTo: replyToList, subject, html });
        results.push({ site_id: s.site_id, ...r });
      }

      if (results.length === 0) {
        res.status(400).json({ ok: false, error: 'No valid FSE email recipients found for PPM reminder.' });
        return;
      }
      const anyOk = results.some(r => r.ok);
      const firstErr = results.find(r => !r.ok);
      res.status(anyOk ? 200 : 502).json({
        ok: anyOk,
        sent_count: results.filter(r => r.ok).length,
        total: results.length,
        error: anyOk ? null : (firstErr && firstErr.error),
        hint: firstErr && firstErr.hint ? firstErr.hint : '',
        results
      });
      return;
    }

    // -------------------------------------------------------------------------
    // 3. DIESEL DELIVERY NOTIFICATION (FSE -> Finance / Admin)
    // -------------------------------------------------------------------------
    if (eventType === 'DIESEL_DELIVERY') {
      const to = parseEmailList([
        ...(Array.isArray(payload.to) ? payload.to : [payload.to, payload.custom_email]),
        ADMIN_ALERT_EMAIL,
        FINANCE_TEAM_EMAIL
      ]);
      if (to.length === 0) {
        res.status(200).json({ ok: true, skipped: true, reason: 'No recipients configured' });
        return;
      }
      const qty = Number(payload.qty || 0);
      const estCost = Math.round(qty * 2100);
      const subject = `[DIESEL DELIVERY] +${qty} L Logged — ${payload.site_id || 'Site'} (${payload.received_date || ''})`;
      const inner = `
        <p style="margin:0 0 12px;">A Field Support Engineer has logged an incoming diesel delivery on the site portal.</p>
        ${buildRowsTable([
          ['Site ID', payload.site_id || 'N/A'],
          ['Quantity Delivered', `+${qty} Litres`],
          ['Arrival Date & Time', `${payload.received_date || 'N/A'} @ ${payload.received_time || '--:--'}`],
          ['Supplier / Vendor', payload.supplier || 'N/A'],
          ['Logged By (FSE)', payload.logged_by || 'FSE'],
          ['Est. Cost (@ NGN 2,100/L)', `NGN ${estCost.toLocaleString()}`]
        ])}
      `;
      const html = wrapBrandedHtml('// FSE DIESEL DELIVERY LOGGED', '#22c55e', inner);
      const result = await sendViaResend({ apiKey: RESEND_API_KEY, from: FROM_EMAIL, to, cc: ccList, replyTo: replyToList, subject, html });
      res.status(result.ok ? 200 : 502).json(result);
      return;
    }

    // -------------------------------------------------------------------------
    // 4. REPAIR TICKET / SITE COMPLAINT ALERT
    // -------------------------------------------------------------------------
    if (eventType === 'REPAIR_TICKET') {
      const to = parseEmailList([
        ...(Array.isArray(payload.to) ? payload.to : [payload.to, payload.custom_email]),
        ADMIN_ALERT_EMAIL
      ]);
      if (to.length === 0) {
        res.status(200).json({ ok: true, skipped: true, reason: 'No Admin email configured' });
        return;
      }
      const subject = `[${payload.category || 'REPAIR TICKET'}] ${payload.site_id || 'Site'} — ${payload.ticket_id || ''}`;
      const inner = `
        <p style="margin:0 0 12px;">A new repair ticket or site complaint was logged in ColoPlus NOC.</p>
        ${buildRowsTable([
          ['Ticket ID', payload.ticket_id || 'N/A'],
          ['Site ID', payload.tenant_id ? `${payload.site_id} (${payload.tenant_id})` : (payload.site_id || 'N/A')],
          ['State', payload.state || 'N/A'],
          ['Category', payload.category || 'GENERAL'],
          ['Status', payload.status || 'OPEN'],
          ['Logged By', payload.technician || 'FSE'],
          ['Issue Details', payload.issue || 'N/A']
        ])}
      `;
      const html = wrapBrandedHtml('// SITE REPAIR TICKET / COMPLAINT', '#ef4444', inner);
      const result = await sendViaResend({ apiKey: RESEND_API_KEY, from: FROM_EMAIL, to, cc: ccList, replyTo: replyToList, subject, html });
      res.status(result.ok ? 200 : 502).json(result);
      return;
    }

    // -------------------------------------------------------------------------
    // 5. CUSTOM EMAIL / TEAM TASK / 7-DAY FUEL ALARM / GENERAL DISPATCH
    // -------------------------------------------------------------------------
    const target = String(payload.target || 'CUSTOM').toUpperCase();
    let recipients = parseEmailList(payload.to || payload.custom_email);
    if (target === 'ADMIN' && ADMIN_ALERT_EMAIL) recipients.push(ADMIN_ALERT_EMAIL);
    if (target === 'FINANCE' && recipients.length === 0 && FINANCE_TEAM_EMAIL) recipients.push(FINANCE_TEAM_EMAIL);
    recipients = [...new Set(recipients)];

    if (recipients.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'No valid recipient email address provided.',
        hint: target === 'ADMIN' ? 'Set ADMIN_ALERT_EMAIL in Vercel Environment Variables or enter a custom recipient email.' : 'Enter at least one valid email address.'
      });
      return;
    }

    const subject = String(payload.subject || 'ColoPlus Tech NOC Dispatch').trim();
    const message = String(payload.message || '').trim();
    const isAlarm = eventType.includes('ALARM') || subject.toUpperCase().includes('ALARM') || subject.toUpperCase().includes('CRITICAL');
    const headerTitle = isAlarm
      ? '// 7-DAY FUEL DEPLETION ALARM'
      : (eventType === 'TASK_ASSIGNED' ? '// TEAM TASK ASSIGNMENT' : '// COLOPLUS NOC DISPATCH');
    const accent = isAlarm ? '#ef4444' : (eventType === 'TASK_ASSIGNED' ? '#f59e0b' : '#22c55e');

    const metaRows = [];
    if (payload.site_id) metaRows.push(['Site Context', payload.site_id]);
    if (payload.sender_name) metaRows.push(['Sent By', payload.sender_name]);

    const inner = `
      ${metaRows.length > 0 ? buildRowsTable(metaRows) : ''}
      <div style="white-space:pre-wrap; background:#111419; border:1px solid #2b3038; padding:16px; font-size:13px; line-height:1.65;">${escapeHtml(message)}</div>
    `;
    const html = wrapBrandedHtml(headerTitle, accent, inner);

    const result = await sendViaResend({ apiKey: RESEND_API_KEY, from: FROM_EMAIL, to: recipients, cc: ccList, replyTo: replyToList, subject, html });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};

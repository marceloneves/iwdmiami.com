/* IWD Miami lead form — single handler for all forms across the site.
 *
 * Hooks every <form data-lead-form> on the page. On submit, builds a GHL
 * payload using context from <body data-*> + per-form fields, posts to the
 * intake endpoint. Service-specific qualifying fields (system_type, fuel_type,
 * home_sqft, etc.) are folded into project_description so the lead card in
 * GHL keeps every detail submitted.
 *
 * The intake server (lead.iwdmiami.com) creates contact +
 * opportunity in pipeline "IWD Miami Lead Funner" stage "Novo Lead".
 */
(function () {
  'use strict';

  const ENDPOINT = 'https://lead.iwdmiami.com/lead';
  const MIN_FILL_TIME_MS = 2000; // bot-speed silent drop
  const PHONE_FALLBACK = '(508) 555-0100'; // shown in error state

  const STD_KEYS = new Set([
    'full_name', 'name', 'first_name', 'last_name', 'firstname', 'lastname',
    'firstName', 'lastName', 'email', 'phone',
    'zip', 'postal_code', 'postalCode', 'address1', 'country',
    'website', 'url_field', '_hp', 'service_slug', 'lead_source',
    'page_url', 'form_id', 'form_loaded_at',
    'consent_marketing',
    'project_description', 'project_timeline', 'project_budget',
    'property_type', 'preferred_contact_method', 'preferred_contact_time',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid',
  ]);

  // Form-side timeline label → GHL dropdown value (Project Timeline custom field)
  const TIMELINE_MAP = {
    'asap': 'ASAP',
    'asap — within 30 days': 'ASAP',
    'within 30 days': 'ASAP',
    'within a week': 'Within a week',
    'within a month': 'Within a month',
    '1-3 months': 'Within a month',
    '1–3 months': 'Within a month',
    '3-6 months': '3+ months',
    '3+ months': '3+ months',
    'just researching': 'Just researching',
  };

  // ── page-load context ──
  const body = document.body;
  const ctx = readContext();
  persistAttribution();

  // ── hook forms (initial + dynamic via MutationObserver) ──
  document.querySelectorAll('form[data-lead-form]').forEach(initForm);

  // Modal forms (cloned from <template>) need to be bound after injection
  if (typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches && n.matches('form[data-lead-form]')) initForm(n);
          if (n.querySelectorAll) n.querySelectorAll('form[data-lead-form]').forEach(initForm);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Public API for legacy modal openers if they need to force-rescan
  window.PB = window.PB || {};
  window.PB.bindLeadForm = (form) => initForm(form);

  function readContext() {
    const d = body.dataset || {};
    return {
      service_silo:    d.serviceSilo  || '',
      service_slug:    d.serviceSlug  || '',
      service_name:    d.serviceName  || '',
      page_type:       d.pageType     || '',
      page_city:       d.city         || '',
      page_state:      d.state        || 'FL',
      page_url:        location.origin + location.pathname,
      device:          guessDevice(),
      referrer_url:    document.referrer || '',
      landing_page_url: sessionStorage.getItem('pb_landing') || (location.origin + location.pathname),
      utm_source:      qsOrStored('utm_source'),
      utm_medium:      qsOrStored('utm_medium'),
      utm_campaign:    qsOrStored('utm_campaign'),
      utm_term:        qsOrStored('utm_term'),
      utm_content:     qsOrStored('utm_content'),
      gclid:           qsOrStored('gclid'),
      fbclid:          qsOrStored('fbclid'),
    };
  }

  function persistAttribution() {
    if (!sessionStorage.getItem('pb_landing')) {
      sessionStorage.setItem('pb_landing', location.origin + location.pathname);
    }
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach((k) => {
      const v = new URLSearchParams(location.search).get(k);
      if (v && !sessionStorage.getItem('pb_' + k)) {
        sessionStorage.setItem('pb_' + k, v);
      }
    });
  }

  function guessDevice() {
    const w = window.innerWidth || document.documentElement.clientWidth || 1024;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function qsOrStored(k) {
    return new URLSearchParams(location.search).get(k) || sessionStorage.getItem('pb_' + k) || '';
  }

  function initForm(form) {
    if (form.dataset.pbBound === '1') return;
    form.dataset.pbBound = '1';
    const loadedAt = Date.now();

    // Best-effort fill of optional hidden inputs the page may have declared
    setHidden(form, 'form_loaded_at', String(loadedAt));
    setHidden(form, 'utm_source',   ctx.utm_source);
    setHidden(form, 'utm_medium',   ctx.utm_medium);
    setHidden(form, 'utm_campaign', ctx.utm_campaign);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Bot-speed: silently drop submissions faster than humans can type
      if (Date.now() - loadedAt < MIN_FILL_TIME_MS) {
        showResult(form, 'success'); // honest-looking response
        return;
      }

      const raw = readForm(form);

      // Honeypot client-side short-circuit (server also enforces)
      if (raw.website || raw.url_field || raw._hp) {
        showResult(form, 'success');
        return;
      }

      // Required fields (mirrors server validation)
      const errs = validate(raw);
      if (errs.length) {
        showResult(form, 'error', errs.join(' · '));
        return;
      }

      const payload = buildPayload(raw, form);

      setSubmitState(form, 'loading');
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await safeJson(res);
        if (res.ok && data && data.ok) {
          handleSuccess(form, raw);
        } else {
          const msg = (data && data.error) || ('http_' + res.status);
          showResult(form, 'error', msg);
        }
      } catch (err) {
        showResult(form, 'error', 'network_error');
      } finally {
        setSubmitState(form, 'idle');
      }
    });
  }

  function readForm(form) {
    const out = {};
    new FormData(form).forEach((v, k) => {
      out[k] = typeof v === 'string' ? v.trim() : v;
    });
    return out;
  }

  function validate(raw) {
    const errs = [];
    const name = (raw.full_name || raw.name || '').trim();
    if (!name) errs.push('Name required');
    if (!raw.email && !raw.phone) errs.push('Phone or email required');
    if (raw.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email)) errs.push('Invalid email');
    return errs;
  }

  function buildPayload(raw, form) {
    const fullName = (raw.full_name || raw.name || '').trim().replace(/\s+/g, ' ');
    const parts = fullName.split(' ');
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    const projectDescParts = [];
    if (raw.project_description) projectDescParts.push(raw.project_description);

    // Anything not in STD_KEYS is treated as a service-specific qualifier and
    // appended to project_description as "Label: value".
    Object.keys(raw).forEach((k) => {
      if (STD_KEYS.has(k)) return;
      const v = raw[k];
      if (v === undefined || v === null || v === '') return;
      const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      projectDescParts.push(label + ': ' + v);
    });
    const project_description = projectDescParts.join('\n');

    const tlRaw = (raw.timeline || raw.project_timeline || '').toString().toLowerCase().trim();
    const project_timeline = TIMELINE_MAP[tlRaw] || raw.project_timeline || raw.timeline || '';

    return {
      // Standard fields (native GHL)
      firstName: firstName,
      lastName:  lastName,
      email:     raw.email || '',
      phone:     raw.phone || '',
      city:      ctx.page_city,
      state:     ctx.page_state,
      postalCode: raw.postalCode || raw.zip || raw.postal_code || '',
      country:   'US',

      // Page → form context
      service_silo: ctx.service_silo,
      service_slug: ctx.service_slug || raw.service_slug || '',
      service_name: ctx.service_name,
      page_url:     ctx.page_url,
      page_type:    ctx.page_type,
      form_id:      form.id || raw.form_id || '',
      form_type:    form.dataset.formType || 'hero',

      // Project qualification (composed)
      project_description: project_description,
      project_timeline:    project_timeline,
      project_budget:      raw.project_budget || raw.budget || '',
      property_type:       raw.property_type || '',
      preferred_contact_method: raw.preferred_contact_method || raw.contact_method || '',
      preferred_contact_time:   raw.preferred_contact_time   || raw.contact_time   || '',

      // Attribution
      utm_source:       ctx.utm_source,
      utm_medium:       ctx.utm_medium,
      utm_campaign:     ctx.utm_campaign,
      utm_term:         ctx.utm_term,
      utm_content:      ctx.utm_content,
      referrer_url:     ctx.referrer_url,
      landing_page_url: ctx.landing_page_url,
      gclid:            ctx.gclid,
      fbclid:           ctx.fbclid,
      device:           ctx.device,

      // Consent (boolean → server normalizes)
      consent_marketing: raw.consent_marketing === 'on' || raw.consent_marketing === 'yes' || raw.consent_marketing === '1',

      // Honeypot pass-through (server validates these are empty)
      website:   raw.website   || '',
      url_field: raw.url_field || '',
      _hp:       raw._hp       || '',
    };
  }

  function setHidden(form, name, value) {
    const el = form.querySelector('input[name="' + name + '"]');
    if (el && el.type === 'hidden' && !el.value) el.value = value;
  }

  function setSubmitState(form, state) {
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (state === 'loading') {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.innerHTML = 'Sending…';
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }

  function handleSuccess(form, raw) {
    try { sessionStorage.setItem('pb_leadSubmitted', '1'); } catch (_) {}
    if (window.dataLayer) {
      window.dataLayer.push({
        event: 'lead_submitted',
        form_id: form.id,
        form_type: form.dataset.formType || '',
        service_slug: ctx.service_slug || (raw.service_slug || ''),
      });
    }

    // Personalized /thank-you/ redirect (preserves legacy UX)
    const fullName = (raw.full_name || raw.name || '').trim();
    const firstName = fullName.split(/\s+/)[0] || '';
    const zip = raw.postalCode || raw.zip || raw.postal_code || '';
    const qs = new URLSearchParams();
    if (firstName) qs.set('name', firstName.slice(0, 40));
    if (ctx.service_slug) qs.set('service', ctx.service_slug);
    if (ctx.service_silo) qs.set('trade', ctx.service_silo);
    if (/^0[1-2][0-9]{3}$/.test(zip)) qs.set('zip', zip);
    if (form.dataset.formType) qs.set('source', form.dataset.formType);

    // Replace form contents with brief acknowledgement, close any open dialog, then redirect
    form.innerHTML = '<div class="form-success" role="status" aria-live="polite"><p class="form-success-icon" aria-hidden="true">✓</p><h3>Got it. Redirecting…</h3><p>Taking you to the next step.</p></div>';
    form.classList.add('form--submitted');
    try {
      ['quote-modal', 'exit-modal'].forEach((id) => {
        const d = document.getElementById(id);
        if (d && typeof d.close === 'function') { try { d.close(); } catch (_) {} }
      });
      document.body.classList.remove('modal-open');
    } catch (_) {}
    setTimeout(() => { location.assign('/thank-you/?' + qs.toString()); }, 250);
  }

  function showResult(form, type, detail) {
    let box = form.querySelector('.lead-form-result');
    if (!box) {
      box = document.createElement('div');
      box.className = 'lead-form-result';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      form.appendChild(box);
    }
    if (type === 'success') {
      box.className = 'lead-form-result success';
      box.innerHTML = '<strong>Got it.</strong> We reply within 5 minutes during business hours. Watch your phone — check spam if you gave email.';
    } else {
      box.className = 'lead-form-result error';
      const note = detail ? ' (' + escapeHtml(String(detail).slice(0, 80)) + ')' : '';
      box.innerHTML = '<strong>Something went wrong' + note + '.</strong> Call us at <a href="tel:' + PHONE_FALLBACK.replace(/\D/g, '') + '">' + PHONE_FALLBACK + '</a> or try again.';
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }
})();

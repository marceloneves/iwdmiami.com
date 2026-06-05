/* IWD Miami first-party analytics — served by /api/track.js
   Tracks pageview, scroll depth, outbound/CTA/phone/email clicks, time-on-page.
   Privacy: 1st-party cookie only, IP hashed server-side, honors DNT. */
(function () {
  'use strict';

  if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes') return;
  if (window._pbTracked) return;
  window._pbTracked = true;

  // ---- IDs ----
  function uuid() {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function getStored(storage, key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }
  function setStored(storage, key, value) {
    try { storage.setItem(key, value); } catch (e) {}
  }
  function getVisitorId() {
    var v = getStored(localStorage, '_pb_v');
    if (!v) { v = uuid(); setStored(localStorage, '_pb_v', v); }
    return v;
  }
  function getSessionId() {
    var s = getStored(sessionStorage, '_pb_s');
    if (!s) { s = uuid(); setStored(sessionStorage, '_pb_s', s); }
    return s;
  }

  var visitor = getVisitorId();
  var session = getSessionId();
  var startTime = Date.now();
  var maxScroll = 0;
  var sentScrolls = {};
  var pageviewSent = false;

  function send(endpoint, payload, useBeacon) {
    payload.v = visitor;
    payload.s = session;
    payload.url = location.href;
    var data = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      try {
        var blob = new Blob([data], { type: 'application/json' });
        navigator.sendBeacon('/api/track/' + endpoint, blob);
        return;
      } catch (e) {}
    }
    try {
      fetch('/api/track/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
        credentials: 'omit',
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function sendPageview() {
    if (pageviewSent) return;
    pageviewSent = true;
    send('pageview', {
      ref: document.referrer || '',
      lang: navigator.language || '',
      vw: window.innerWidth,
      vh: window.innerHeight
    }, false);
  }

  function getScrollPct() {
    var docH = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement.scrollHeight
    );
    var winH = window.innerHeight;
    if (docH <= winH) return 100;
    return Math.min(100, Math.round(((window.scrollY + winH) / docH) * 100));
  }

  function onScroll() {
    var pct = getScrollPct();
    if (pct > maxScroll) maxScroll = pct;
    [25, 50, 75, 90].forEach(function (m) {
      if (maxScroll >= m && !sentScrolls[m]) {
        sentScrolls[m] = 1;
        send('event', { t: 'scroll', val: String(m) }, false);
      }
    });
  }

  function sendDuration() {
    var ms = Date.now() - startTime;
    if (ms < 100) return;
    send('duration', { ms: ms, scroll: maxScroll }, true);
  }

  function classifyClick(target) {
    if (!target) return null;
    if (target.hasAttribute && target.hasAttribute('data-open-quote')) {
      return { t: 'cta_click', val: target.getAttribute('data-quote-source') || 'unknown' };
    }
    if (target.tagName === 'A') {
      var href = target.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;
      if (href.startsWith('mailto:')) {
        return { t: 'email_click', val: href.replace('mailto:', '').split('?')[0] };
      }
      if (href.startsWith('tel:') || href.startsWith('sms:')) {
        return { t: 'phone_click', val: href.replace(/^(tel|sms):/, '') };
      }
      if (href.startsWith('whatsapp:') || href.indexOf('wa.me/') !== -1 || href.indexOf('whatsapp.com/send') !== -1) {
        return { t: 'whatsapp_click', val: href.slice(0, 200) };
      }
      try {
        var u = new URL(href, location.href);
        if (u.host && u.host !== location.host) {
          return { t: 'outbound_click', val: u.host + u.pathname };
        }
      } catch (e) {}
    }
    if (target.tagName === 'BUTTON') {
      var label = (target.textContent || '').trim().slice(0, 80);
      if (target.type === 'submit' || target.closest('form')) {
        return null; // form submission tracked separately
      }
      return { t: 'button_click', val: label };
    }
    return null;
  }

  function onClick(ev) {
    var t = ev.target.closest && ev.target.closest('a, button');
    if (!t) return;
    var info = classifyClick(t);
    if (info) send('event', info, false);
  }

  function onFormSubmit(ev) {
    var f = ev.target;
    if (!f || f.tagName !== 'FORM') return;
    var action = f.getAttribute('action') || '';
    if (action.indexOf('/api/leads/') === 0) {
      var formId = f.id || 'unknown';
      var slug = action.replace('/api/leads/', '').replace(/\/$/, '');
      send('event', { t: 'form_submit', val: slug + '|' + formId }, false);
    }
  }

  function onFormFocus(ev) {
    var f = ev.target.closest && ev.target.closest('form');
    if (!f || f._pbStarted) return;
    var action = f.getAttribute('action') || '';
    if (action.indexOf('/api/leads/') !== 0) return;
    f._pbStarted = true;
    var slug = action.replace('/api/leads/', '').replace(/\/$/, '');
    send('event', { t: 'form_start', val: slug + '|' + (f.id || 'unknown') }, false);
  }

  // --- Init ---
  function init() {
    sendPageview();
    var scrollTimer = null;
    window.addEventListener('scroll', function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(onScroll, 250);
    }, { passive: true });
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onFormSubmit, true);
    document.addEventListener('focusin', onFormFocus, true);
    window.addEventListener('pagehide', sendDuration);
    window.addEventListener('beforeunload', sendDuration);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sendDuration();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose minimal API for manual events
  window.proBuildAnalytics = {
    event: function (type, value, meta) {
      send('event', { t: String(type).slice(0, 32), val: String(value || '').slice(0, 200), meta: meta || null }, false);
    }
  };
})();

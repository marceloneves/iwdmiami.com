/* IWD Miami blog hub — client-side filter + search + autocomplete.
 * Loads /blog/search-index.json once, then handles:
 *   - Toggleable category chips (click to select; click again to deselect)
 *   - Toggleable format chips (same behavior)
 *   - Search input with autocomplete dropdown (titles + entity matches)
 *   - "Clear filters" button when any filter is active
 *   - URL state via ?cat=&fmt=&q= so bookmarks/share links work
 *   - Live card hide/show with empty-state messaging
 *
 * Vanilla JS, defer-loaded. ~3KB minified target. No deps. */
(function () {
  'use strict';

  // Only run on /blog/ hub pages, not individual posts or taxonomy pages
  var hub = document.querySelector('.blog-hero #hero-h1');
  var grid = document.querySelector('.blog-grid');
  if (!hub || !grid) return;
  // Skip if we're on a taxonomy page (only one category visible)
  if (document.body.dataset.taxonomy) return;

  var INDEX_URL = '/blog/search-index.json';
  var state = { cat: null, fmt: null, q: '' };
  var index = [];
  var searchInput, autocompleteList, clearBtn, statusEl;

  // ---- Inject filter UI into hub (above category chips) ----
  function buildFilterUI() {
    var chipStrip = document.querySelector('.blog-chip-strip');
    if (!chipStrip) return;

    var ui = document.createElement('div');
    ui.className = 'blog-filter-ui';
    ui.innerHTML =
      '<div class="blog-search-wrap">' +
        '<label for="blog-search" class="visually-hidden">Search IWD Miami articles</label>' +
        '<input type="text" id="blog-search" class="blog-search-input" ' +
          'placeholder="Search by topic, code, brand, or entity..." ' +
          'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
          'aria-label="Search IWD Miami articles" ' +
          'aria-autocomplete="list" aria-controls="blog-autocomplete">' +
        '<button type="button" class="blog-search-clear" aria-label="Clear search" hidden>×</button>' +
        '<ul id="blog-autocomplete" class="blog-autocomplete" role="listbox" hidden></ul>' +
      '</div>' +
      '<div class="blog-filter-status" aria-live="polite" aria-atomic="true"></div>' +
      '<button type="button" class="blog-clear-filters" hidden>Clear all filters</button>';

    chipStrip.parentNode.insertBefore(ui, chipStrip);

    searchInput = ui.querySelector('#blog-search');
    autocompleteList = ui.querySelector('#blog-autocomplete');
    clearBtn = ui.querySelector('.blog-clear-filters');
    statusEl = ui.querySelector('.blog-filter-status');
    var searchClear = ui.querySelector('.blog-search-clear');

    // Search input handlers
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        state.q = searchInput.value.trim();
        searchClear.hidden = !state.q;
        applyFilters();
        renderAutocomplete();
      }, 80);
    });

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        // Prevent any accidental form submission / browser search action.
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        state.q = '';
        searchClear.hidden = true;
        applyFilters();
        autocompleteList.hidden = true;
      } else if (e.key === 'ArrowDown' && !autocompleteList.hidden) {
        e.preventDefault();
        var first = autocompleteList.querySelector('button[data-ac-term], a[data-ac-nav]');
        if (first) first.focus();
      }
    });

    // Re-open autocomplete on focus if query already typed
    searchInput.addEventListener('focus', function () {
      if (state.q && state.q.length >= 2) renderAutocomplete();
    });

    searchClear.addEventListener('click', function () {
      searchInput.value = '';
      state.q = '';
      searchClear.hidden = true;
      autocompleteList.hidden = true;
      applyFilters();
      searchInput.focus();
    });

    // Hide autocomplete on outside click
    document.addEventListener('click', function (e) {
      if (!ui.contains(e.target)) autocompleteList.hidden = true;
    });

    // Clear all filters button
    clearBtn.addEventListener('click', function () {
      state = { cat: null, fmt: null, q: '' };
      searchInput.value = '';
      searchClear.hidden = true;
      autocompleteList.hidden = true;
      applyFilters();
      pushUrlState();
    });
  }

  // ---- Wire up category + format chips for toggle behavior ----
  function wireChipToggles() {
    // Category chips (in .blog-chip-strip)
    var catChips = document.querySelectorAll('.blog-chip-strip .blog-chip');
    catChips.forEach(function (chip) {
      // Skip the "All" chip — it just resets
      if (chip.classList.contains('blog-chip-all')) {
        chip.addEventListener('click', function (e) {
          e.preventDefault();
          state.cat = null;
          applyFilters();
          pushUrlState();
        });
        return;
      }
      // Match cat slug from class (blog-chip-<slug>)
      var slug = (chip.className.match(/blog-chip-([a-z0-9-]+)/) || [])[1];
      if (!slug || slug === 'all') return;

      // Hijack the link; toggle in place
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        if (state.cat === slug) {
          state.cat = null;
          chip.removeAttribute('aria-current');
        } else {
          // Clear other chips
          catChips.forEach(function (c) { c.removeAttribute('aria-current'); });
          state.cat = slug;
          chip.setAttribute('aria-current', 'page');
        }
        applyFilters();
        pushUrlState();
      });
    });

    // Format chips (in .blog-fmt-strip)
    var fmtChips = document.querySelectorAll('.blog-fmt-strip .blog-fmt-chip');
    fmtChips.forEach(function (chip) {
      var slug = (chip.className.match(/blog-fmt-chip-([a-z0-9-]+)/) || [])[1];
      if (!slug) return;
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        if (state.fmt === slug) {
          state.fmt = null;
          chip.removeAttribute('aria-current');
        } else {
          fmtChips.forEach(function (c) { c.removeAttribute('aria-current'); });
          state.fmt = slug;
          chip.setAttribute('aria-current', 'page');
        }
        applyFilters();
        pushUrlState();
      });
    });
  }

  // ---- Read URL state on load ----
  function readUrlState() {
    var params = new URLSearchParams(window.location.search);
    state.cat = params.get('cat') || null;
    state.fmt = params.get('fmt') || null;
    state.q = params.get('q') || '';
    if (state.q && searchInput) searchInput.value = state.q;
    // Apply aria-current to matching chips
    if (state.cat) {
      var c = document.querySelector('.blog-chip.blog-chip-' + state.cat);
      if (c) c.setAttribute('aria-current', 'page');
    }
    if (state.fmt) {
      var f = document.querySelector('.blog-fmt-chip.blog-fmt-chip-' + state.fmt);
      if (f) f.setAttribute('aria-current', 'page');
    }
  }

  function pushUrlState() {
    var params = new URLSearchParams();
    if (state.cat) params.set('cat', state.cat);
    if (state.fmt) params.set('fmt', state.fmt);
    if (state.q) params.set('q', state.q);
    var qs = params.toString();
    var url = '/blog/' + (qs ? '?' + qs : '');
    window.history.replaceState({}, '', url);
  }

  // ---- Filter logic ----
  function postMatchesState(cardEl, indexRecord) {
    if (state.cat && cardEl.dataset.cat !== state.cat && cardEl.dataset.silo !== state.cat) return false;
    if (state.fmt && cardEl.dataset.fmt !== state.fmt) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      // Match against indexed haystack if available, else title
      var hay = (indexRecord && indexRecord._search) || cardEl.dataset.title || '';
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function applyFilters() {
    var cards = document.querySelectorAll('.blog-filterable');
    var visible = 0;
    cards.forEach(function (card) {
      var slug = card.dataset.slug;
      var record = index.find(function (r) { return r.slug === slug; });
      var match = postMatchesState(card, record);
      card.style.display = match ? '' : 'none';
      if (match) visible++;
    });

    // Hide entire "Editor's Picks" + "Featured" sections when filters active
    var hasFilter = !!(state.cat || state.fmt || state.q);
    var hideSections = ['.blog-featured', '.blog-grid-picks'];
    hideSections.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      // If element has no visible descendants, hide its parent section
      var section = el.closest('section');
      if (!section) return;
      // For featured: hide when filters active and the featured doesn't match
      if (hasFilter) {
        var featuredVisible = el.matches('.blog-filterable') ?
          (el.style.display !== 'none') :
          el.querySelector('.blog-filterable:not([style*="none"])') !== null;
        section.style.display = featuredVisible ? '' : 'none';
      } else {
        section.style.display = '';
      }
    });

    // Status + clear button
    if (statusEl) {
      if (hasFilter) {
        var bits = [];
        if (state.cat) bits.push('topic: ' + state.cat);
        if (state.fmt) bits.push('format: ' + state.fmt);
        if (state.q) bits.push('search: "' + state.q + '"');
        statusEl.textContent = visible + ' article' + (visible === 1 ? '' : 's') +
          ' matching ' + bits.join(' + ');
      } else {
        statusEl.textContent = '';
      }
    }
    if (clearBtn) clearBtn.hidden = !hasFilter;

    // Empty state inside grid
    var grids = document.querySelectorAll('.blog-grid');
    grids.forEach(function (g) {
      var existingEmpty = g.querySelector('.blog-empty-state');
      var anyVisible = g.querySelector('.blog-filterable:not([style*="none"])');
      if (!anyVisible && !existingEmpty) {
        var empty = document.createElement('div');
        empty.className = 'blog-empty-state';
        empty.innerHTML = '<p>No IWD Miami articles match these filters yet.</p><p>Try a different topic or <button type="button" class="blog-empty-clear">clear all filters</button>.</p>';
        empty.querySelector('.blog-empty-clear').addEventListener('click', function () {
          state = { cat: null, fmt: null, q: '' };
          if (searchInput) searchInput.value = '';
          document.querySelectorAll('[aria-current="page"]').forEach(function (el) {
            if (el.classList.contains('blog-chip') || el.classList.contains('blog-fmt-chip')) {
              el.removeAttribute('aria-current');
            }
          });
          applyFilters();
          pushUrlState();
        });
        g.appendChild(empty);
      } else if (anyVisible && existingEmpty) {
        existingEmpty.remove();
      }
    });
  }

  // ---- Autocomplete (Algolia-style: rich grouped panel; never auto-navigates) ----
  // Renders three groups inline: Entities (filter chips) · Articles (card rows) · FAQ Questions.
  // Always opens on focus when query >= 2 chars, including when zero results (shows "No results" + tips).
  function renderAutocomplete() {
    if (!state.q || state.q.length < 2) {
      autocompleteList.hidden = true;
      autocompleteList.innerHTML = '';
      return;
    }
    var q = state.q.toLowerCase();
    var entityMatches = [];
    var articleMatches = [];
    var faqMatches = [];
    var entitySet = new Set();

    index.forEach(function (r) {
      // Entity dedup across posts
      (r.entities || []).forEach(function (e) {
        if (e.toLowerCase().indexOf(q) !== -1 && !entitySet.has(e.toLowerCase())) {
          entitySet.add(e.toLowerCase());
          entityMatches.push({ name: e, count: 0 });
        }
      });
      // Article: match title OR full search haystack
      var titleHit = r.title.toLowerCase().indexOf(q) !== -1;
      var bodyHit = (r._search || '').indexOf(q) !== -1;
      if (titleHit || bodyHit) {
        articleMatches.push({
          slug: r.slug, title: r.title, url: r.url, cat: r.category, fmt: r.format,
          excerpt: r.excerpt, cover: r.cover, read: r.read_minutes,
          titleHit: titleHit
        });
      }
      // FAQ Q matches
      (r.faq || []).forEach(function (faqQ) {
        if (faqQ.toLowerCase().indexOf(q) !== -1) {
          faqMatches.push({ q: faqQ, url: r.url + '#post-faq-h', cat: r.category, slug: r.slug });
        }
      });
    });

    // Compute entity occurrence counts (how many articles each entity appears in)
    entityMatches.forEach(function (em) {
      var c = 0;
      var lower = em.name.toLowerCase();
      index.forEach(function (r) {
        if ((r.entities || []).some(function (e) { return e.toLowerCase() === lower; })) c++;
      });
      em.count = c;
    });

    // Sort: title hits first in articles, alphabetical entities
    articleMatches.sort(function (a, b) { return (b.titleHit ? 1 : 0) - (a.titleHit ? 1 : 0); });
    entityMatches.sort(function (a, b) { return b.count - a.count; });

    // Cap each group
    entityMatches = entityMatches.slice(0, 6);
    articleMatches = articleMatches.slice(0, 5);
    faqMatches = faqMatches.slice(0, 4);

    var totalMatches = entityMatches.length + articleMatches.length + faqMatches.length;

    var html = '';

    if (totalMatches === 0) {
      // ---- No results state ----
      var suggestions = ['heat pump', 'mass save', 'panel upgrade', 'roof replacement', 'kitchen', 'frozen pipe'];
      html =
        '<li class="blog-ac-empty" role="status">' +
          '<p class="blog-ac-empty-title">No results for <strong>"' + escapeHtml(state.q) + '"</strong></p>' +
          '<p class="blog-ac-empty-sub">IWD Miami hasn\'t published an article matching that exact query yet.</p>' +
          '<p class="blog-ac-empty-sub">Try one of these:</p>' +
          '<div class="blog-ac-empty-suggestions">' +
            suggestions.map(function (s) {
              return '<button type="button" class="blog-ac-suggest" data-ac-term="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>';
            }).join('') +
          '</div>' +
        '</li>';
    } else {
      // ---- Entities group ----
      if (entityMatches.length) {
        html += '<li class="blog-ac-group" role="presentation"><span class="blog-ac-group-label">Entities</span></li>';
        html += entityMatches.map(function (em) {
          return '<li role="option">' +
            '<button type="button" class="blog-ac-item blog-ac-entity" data-ac-term="' + escapeHtml(em.name) + '">' +
              '<span class="blog-ac-icon">' + iconSvg('tag') + '</span>' +
              '<span class="blog-ac-label">' + highlightMatch(em.name, q) + '</span>' +
              '<span class="blog-ac-meta">' + em.count + ' article' + (em.count === 1 ? '' : 's') + '</span>' +
            '</button>' +
          '</li>';
        }).join('');
      }

      // ---- Articles group (rich cards with cover) ----
      if (articleMatches.length) {
        html += '<li class="blog-ac-group" role="presentation"><span class="blog-ac-group-label">Articles</span></li>';
        html += articleMatches.map(function (am) {
          var cover900 = (am.cover || '').replace('-1280.webp', '-900.webp');
          var cover600 = (am.cover || '').replace('-1280.webp', '-600.webp');
          return '<li role="option">' +
            '<a href="' + am.url + '" class="blog-ac-item blog-ac-article" data-ac-nav>' +
              '<figure class="blog-ac-cover">' +
                (am.cover ? '<img src="' + cover600 + '" srcset="' + cover600 + ' 600w, ' + cover900 + ' 900w" sizes="80px" alt="" width="80" height="60" loading="lazy" decoding="async">' : '<span class="blog-ac-cover-placeholder">' + iconSvg('article') + '</span>') +
              '</figure>' +
              '<div class="blog-ac-text">' +
                '<span class="blog-ac-cat-pill blog-cat blog-cat-' + (am.cat || '').toLowerCase().replace(/\s+/g, '-') + '">' + escapeHtml(am.cat || '') + '</span>' +
                '<span class="blog-ac-title">' + highlightMatch(am.title, q) + '</span>' +
                '<span class="blog-ac-excerpt">' + highlightMatch((am.excerpt || '').slice(0, 130), q) + (am.excerpt && am.excerpt.length > 130 ? '…' : '') + '</span>' +
              '</div>' +
              '<span class="blog-ac-arrow">→</span>' +
            '</a>' +
          '</li>';
        }).join('');
      }

      // ---- FAQ matches group ----
      if (faqMatches.length) {
        html += '<li class="blog-ac-group" role="presentation"><span class="blog-ac-group-label">From the FAQs</span></li>';
        html += faqMatches.map(function (fm) {
          return '<li role="option">' +
            '<a href="' + fm.url + '" class="blog-ac-item blog-ac-faq" data-ac-nav>' +
              '<span class="blog-ac-icon">' + iconSvg('question') + '</span>' +
              '<span class="blog-ac-text">' +
                '<span class="blog-ac-faq-q">' + highlightMatch(fm.q, q) + '</span>' +
                '<span class="blog-ac-meta">' + escapeHtml(fm.cat) + '</span>' +
              '</span>' +
            '</a>' +
          '</li>';
        }).join('');
      }

      // Footer with quick actions
      html += '<li class="blog-ac-footer" role="presentation">' +
        '<span class="blog-ac-footer-meta">' + totalMatches + ' result' + (totalMatches === 1 ? '' : 's') + '</span>' +
        '<button type="button" class="blog-ac-close-btn" data-ac-close>Close</button>' +
      '</li>';
    }

    autocompleteList.innerHTML = html;
    autocompleteList.hidden = false;

    // Wire entity & suggestion buttons (use as filter, do NOT navigate)
    autocompleteList.querySelectorAll('[data-ac-term]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var term = btn.dataset.acTerm;
        searchInput.value = term;
        state.q = term;
        autocompleteList.hidden = true;
        applyFilters();
        pushUrlState();
        searchInput.focus();
      });
    });

    // Article + FAQ links navigate ONLY on explicit click
    autocompleteList.querySelectorAll('[data-ac-nav]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        // Allow modifier-clicks to open in new tab
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        // Otherwise normal navigation — do nothing extra
      });
    });

    // Close button
    var closeBtn = autocompleteList.querySelector('[data-ac-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        autocompleteList.hidden = true;
        searchInput.focus();
      });
    }
  }

  // Inline SVG icons (no emoji dep, scalable, brand-colored)
  function iconSvg(kind) {
    var svgs = {
      tag: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
      article: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      question: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    return svgs[kind] || '';
  }

  function highlightMatch(text, q) {
    var idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.substring(0, idx)) +
      '<mark>' + escapeHtml(text.substring(idx, idx + q.length)) + '</mark>' +
      escapeHtml(text.substring(idx + q.length));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Bootstrap ----
  function init() {
    buildFilterUI();
    wireChipToggles();

    // Fetch search index (small, ~10-30 KB for ~25 posts)
    fetch(INDEX_URL, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        index = data;
        readUrlState();
        applyFilters();
      })
      .catch(function () {
        // Index failed to load; degrade to chip-only filtering (no search)
        if (searchInput) {
          searchInput.disabled = true;
          searchInput.placeholder = 'Search index unavailable';
        }
        readUrlState();
        applyFilters();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

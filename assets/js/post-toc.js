/* IWD Miami single-post enhancements (vanilla JS, deferred, < 2KB minified).
 * - Scrollspy: highlights TOC link of the section currently in view (IntersectionObserver)
 * - De Funiak Springs progress bar: width % of article scrolled
 * - Back-to-top button: appears after 600px scroll
 *
 * No dependencies. Runs only on pages that contain a .post-toc nav. */
(function () {
  'use strict';

  var article = document.querySelector('.post-article');
  var toc = document.querySelector('.post-toc');
  if (!article || !toc) return;

  // ---- De Funiak Springs progress bar ------------------------------------------
  var bar = document.getElementById('reading-progress-bar');
  function updateProgress() {
    if (!bar) return;
    var rect = article.getBoundingClientRect();
    var top = rect.top + window.scrollY;
    var height = article.offsetHeight;
    var winH = window.innerHeight;
    var scrolled = window.scrollY - top + winH;
    var pct = Math.max(0, Math.min(100, (scrolled / height) * 100));
    bar.style.width = pct + '%';
  }

  // ---- Back-to-top ---------------------------------------------------
  var btt = document.getElementById('back-to-top');
  function updateBtt() {
    if (!btt) return;
    if (window.scrollY > 600) btt.classList.add('is-visible');
    else btt.classList.remove('is-visible');
  }

  // ---- Scrollspy via IntersectionObserver ----------------------------
  var tocLinks = toc.querySelectorAll('[data-toc-link]');
  var sectionMap = {};
  var sections = [];
  tocLinks.forEach(function (link) {
    var id = link.getAttribute('href').replace('#', '');
    var el = document.getElementById(id);
    if (el) {
      sectionMap[id] = link;
      sections.push(el);
    }
  });

  function clearActive() {
    tocLinks.forEach(function (l) { l.classList.remove('is-active'); });
  }

  if ('IntersectionObserver' in window && sections.length) {
    var obs = new IntersectionObserver(function (entries) {
      // Pick the entry closest to the top of viewport that is intersecting
      var topMost = null;
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          if (!topMost || e.boundingClientRect.top < topMost.boundingClientRect.top) {
            topMost = e;
          }
        }
      });
      if (topMost) {
        clearActive();
        var link = sectionMap[topMost.target.id];
        if (link) link.classList.add('is-active');
      }
    }, {
      rootMargin: '-80px 0px -65% 0px',
      threshold: [0, 1]
    });
    sections.forEach(function (s) { obs.observe(s); });
  }

  // ---- Scroll listener (throttled via rAF) ---------------------------
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      updateProgress();
      updateBtt();
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateProgress, { passive: true });
  updateProgress();
  updateBtt();
})();

// Shared by the /read/<slug> articles: read-depth events for the Meta Pixel, the email signup
// forms, and a tag on events whose date has passed.
(function () {
  'use strict';
  var art = document.querySelector('[data-article]');
  if (!art) return;
  var slug = art.getAttribute('data-article');
  function fbq() { if (window.fbq) window.fbq.apply(null, arguments); }

  /* ---------- Read depth: ArticleRead25 / 50 / 75 / 100, once each per page view ---------- */
  // Depth is how far the bottom of the screen has travelled through the article itself (not the
  // footer or the closing signup). Nothing fires until the reader scrolls.
  var marks = [25, 50, 75, 100], queued = false;
  function check() {
    queued = false;
    var r = art.getBoundingClientRect();
    var pct = (window.innerHeight - r.top) / r.height * 100;
    while (marks.length && pct >= marks[0]) {
      var m = marks.shift();
      fbq('trackCustom', 'ArticleRead' + m, { article_slug: slug, percent: m });
    }
    if (!marks.length) window.removeEventListener('scroll', onScroll);
  }
  function onScroll() { if (!queued) { queued = true; window.requestAnimationFrame(check); } }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Signup (email via /api/subscribe) ---------- */
  var forms = document.querySelectorAll('form.sub');
  function done() {
    Array.prototype.forEach.call(forms, function (f) {
      f.hidden = true;
      f.parentNode.querySelector('.msg').textContent = 'You’re in. Look for Exit 163 in your inbox Friday at 7am.';
    });
  }
  Array.prototype.forEach.call(forms, function (f) {
    if (!window.fetch) return; // the plain form post still works
    var msg = f.parentNode.querySelector('.msg'), btn = f.querySelector('button');
    f.addEventListener('submit', function (e) {
      e.preventDefault(); btn.disabled = true; msg.textContent = '';
      var hp = f.website.value;
      fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: f.email.value, website: hp }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) { btn.disabled = false; msg.textContent = d.error || 'Something went wrong. Please try again.'; return; }
          done();
          if (!hp) fbq('track', 'Lead', { content_name: 'read_signup', content_category: 'email', article_slug: slug, placement: f.getAttribute('data-placement') });
        })
        .catch(function () { btn.disabled = false; msg.textContent = 'Something went wrong. Please try again.'; });
    });
  });

  /* ---------- Mark events that have already happened ---------- */
  var now = new Date(), today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
  Array.prototype.forEach.call(document.querySelectorAll('.ev[data-date]'), function (el) {
    if (el.getAttribute('data-date') >= today) return;
    el.classList.add('past');
    var t = document.createElement('span'); t.className = 'tag'; t.textContent = 'Already happened';
    el.querySelector('.when').appendChild(t);
  });
})();

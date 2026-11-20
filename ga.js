// Google Analytics 4 for exit163.com. Loaded in <head> next to /meta-pixel.js on every public page.
// Defines window.gtag globally so page scripts (e.g. index.html's sign_up event) can call it directly.
(function () {
  var GA_ID = 'G-M1P558N4QM';

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);

  window.gtag('js', new Date());
  window.gtag('config', GA_ID);

  var TEXT_LINE = '8447835988'; // (844) 783-5988
  var onWeekend = /^\/weekend(\.html)?\/?$/.test(location.pathname);

  // Delegated click tracking, so links added or rewritten later (index.html sets sms: hrefs
  // after page load; weekend.html is rebuilt every week) are still counted.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var text = (a.textContent || '').trim().slice(0, 100);

    // text_cta_click: any sms:/tel: link to the (844) 783-5988 line
    if (/^(sms|tel):/i.test(href)) {
      var digits = href.split('?')[0].replace(/\D/g, '');
      if (digits.indexOf(TEXT_LINE) !== -1) {
        window.gtag('event', 'text_cta_click', {
          link_url: href.split('?')[0],
          link_type: href.slice(0, 3).toLowerCase(),
          link_text: text,
          page_path: location.pathname
        });
      }
      return;
    }

    // outbound_event_click: outbound event/ticket links on /weekend
    // (skips our own social links, which aren't events)
    if (onWeekend && a.protocol && /^https?:$/.test(a.protocol) && a.hostname !== location.hostname &&
        !/(^|\.)(instagram|facebook|tiktok)\.com$/i.test(a.hostname)) {
      window.gtag('event', 'outbound_event_click', {
        link_url: a.href,
        link_domain: a.hostname,
        link_text: text
      });
    }
  }, true);
})();

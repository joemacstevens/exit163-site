// Meta Pixel for exit163.com. Set PIXEL_ID (Events Manager > Data sources) to turn it on;
// while it's empty nothing loads and fbq() calls are harmless no-ops.
(function () {
  var PIXEL_ID = '3599666326854838';
  if (!PIXEL_ID) { window.fbq = window.fbq || function () {}; return; }

  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');
})();

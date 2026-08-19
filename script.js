/* Scroll reveals + film grain.
 *
 * Runs immediately: the tag sits at the end of <body>, so the DOM is already
 * parsed, and waiting on DOMContentLoaded meant the listener could be attached
 * after the event had fired — which left every .reveal stuck at opacity 0 and
 * the whole page blank. Anything that can hide content is wrapped so a failure
 * shows the page instead of hiding it. */
(function () {
  var reveals = [].slice.call(document.querySelectorAll('.reveal'));
  var showAll = function () {
    reveals.forEach(function (el) { el.classList.add('active'); });
  };

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced || !('IntersectionObserver' in window)) {
    showAll();
  } else {
    try {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('active');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });
      reveals.forEach(function (el) { io.observe(el); });
      // Last resort: if nothing has been revealed shortly after load, the
      // observer is not doing its job — never leave the page invisible.
      setTimeout(function () {
        if (!document.querySelector('.reveal.active')) showAll();
      }, 1200);
    } catch (err) {
      showAll();
    }
  }

  // Film grain: one static noise field, redrawn only on resize.
  var canvas = document.getElementById('grain-canvas');
  if (canvas && canvas.getContext) {
    var draw = function () {
      try {
        var ctx = canvas.getContext('2d', { alpha: true });
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        var idata = ctx.createImageData(canvas.width, canvas.height);
        var buf = new Uint32Array(idata.data.buffer);
        for (var i = 0; i < buf.length; i++) {
          buf[i] = Math.random() < 0.05 ? 0xffffffff : 0x00000000;
        }
        ctx.putImageData(idata, 0, 0);
      } catch (err) { /* grain is decoration — never block the page for it */ }
    };
    draw();
    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(draw, 200);
    });
  }
})();

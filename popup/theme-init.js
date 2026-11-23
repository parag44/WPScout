// Runs in <head>, before the first paint, so a saved light/dark choice never flashes the
// other theme (Chrome's popup frame keeps the colour of that first frame at its edges).
// MV3's CSP blocks inline scripts, hence a separate file.
(function () {
  try {
    var t = localStorage.getItem('wpscout_theme');
    if (!t) {
      var legacy = localStorage.getItem('wp_detector_theme');
      t = legacy === 'theme-light' ? 'light' : legacy === 'theme-dark' ? 'dark' : null;
    }
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();

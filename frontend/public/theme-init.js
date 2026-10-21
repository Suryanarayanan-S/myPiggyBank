// Applies the saved light/dark choice before the first paint (no flash of the wrong colours).
// Kept as a file, not inline, because the production Content-Security-Policy blocks inline scripts.
(function () {
  var root = document.documentElement;
  var pref = 'system';
  try {
    pref = localStorage.getItem('pb-mode') || 'system';
  } catch {
    // storage unavailable (private window): follow the computer
  }
  var dark =
    pref === 'dark' ||
    (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.mode = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
})();

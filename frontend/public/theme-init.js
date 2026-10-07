// Applies the saved look before the first paint (no flash of the wrong theme).
// Kept as a file, not inline, because the production Content-Security-Policy blocks inline scripts.
(function () {
  var root = document.documentElement;
  var look = 'modern';
  try {
    if (localStorage.getItem('pb-look') === 'retro') look = 'retro';
  } catch {
    // storage unavailable (private window): use the modern look
  }
  var dark = look === 'modern' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.style = look;
  root.dataset.mode = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
})();

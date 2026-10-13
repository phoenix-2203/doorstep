// Light by default. The header switch changes it and this browser remembers the choice.
(function () {
  var KEY = 'doorstep:theme';
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked: stay light */ }
  root.dataset.theme = saved === 'dark' ? 'dark' : 'light';
  function label(btn) {
    var dark = root.dataset.theme === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
  }
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-btn');
    if (!btn) return;
    label(btn);
    btn.addEventListener('click', function () {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, root.dataset.theme); } catch (e) { /* fine */ }
      label(btn);
    });
  });
})();

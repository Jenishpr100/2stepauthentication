(function () {
  var t = 'dark';
  try { var s = localStorage.getItem('theme'); if (s === 'light' || s === 'dark') t = s; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();

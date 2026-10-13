(function () {
  let saved;
  try { saved = localStorage.getItem('yijian-theme'); } catch (_) {}
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark' ? saved : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();

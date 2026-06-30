const isQuickAddHud =
  window.location.hash.startsWith('#/quick-add') ||
  new URLSearchParams(window.location.search).has('quickAdd');

if (isQuickAddHud) {
  document.documentElement.classList.add('isQuickAddHud');
  document.body.classList.add('isQuickAddHud');
  void import('./quick-add-main');
} else {
  void import('./app-main');
}

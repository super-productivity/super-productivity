const isQuickAddHud = window.location.hash.startsWith('#/quick-add');

if (isQuickAddHud) {
  document.documentElement.classList.add('isQuickAddHud');
  document.body.classList.add('isQuickAddHud');
}

void import('./app-main');

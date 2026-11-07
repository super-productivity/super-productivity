const hint = document.getElementById('hint') as HTMLDivElement;

window.taskWidgetAPI.onUpdateDockHint(({ edge, progress, accent }) => {
  hint.dataset.edge = edge;
  hint.dataset.locked = String(progress === 1);
  hint.style.setProperty('--p', progress.toFixed(3));
  hint.style.setProperty('--accent', accent);
});

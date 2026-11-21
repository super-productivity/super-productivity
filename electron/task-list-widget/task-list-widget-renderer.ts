// A standalone renderer, without Node or the app's privileged preload bridge.
(() => {
  const filter = document.getElementById('filter') as HTMLSelectElement;
  const list = document.getElementById('tasks') as HTMLUListElement;
  const empty = document.getElementById('empty') as HTMLParagraphElement;
  const collapse = document.getElementById('collapse') as HTMLButtonElement;
  const open = document.getElementById('open') as HTMLButtonElement;
  const hide = document.getElementById('hide') as HTMLButtonElement;
  const count = document.getElementById('count') as HTMLSpanElement;
  collapse.addEventListener('click', () => window.taskListWidgetAPI.toggleCollapsed());
  open.addEventListener('click', () => window.taskListWidgetAPI.openApp());
  hide.addEventListener('click', () => window.taskListWidgetAPI.hide());
  filter.addEventListener('change', () => {
    window.taskListWidgetAPI.setFilter(filter.value === 'today' ? 'today' : 'all');
  });
  window.taskListWidgetAPI.onUpdate((state) => {
    document.body.classList.toggle('dark', state.isDark);
    document.body.classList.toggle('collapsed', state.isCollapsed);
    filter.options[0].textContent = state.labels.all;
    filter.options[1].textContent = state.labels.today;
    filter.value = state.filter;
    filter.setAttribute('aria-label', state.labels.all);
    count.textContent = String(state.tasks.length);
    empty.textContent = state.labels.empty;
    empty.hidden = state.tasks.length !== 0;
    collapse.textContent = state.isCollapsed ? '▾' : '▴';
    collapse.title = state.isCollapsed ? state.labels.expand : state.labels.collapse;
    collapse.setAttribute('aria-label', collapse.title);
    collapse.setAttribute('aria-expanded', String(!state.isCollapsed));
    open.title = state.labels.open;
    open.setAttribute('aria-label', open.title);
    hide.title = state.labels.hide;
    hide.setAttribute('aria-label', hide.title);
    const fragment = document.createDocumentFragment();
    for (const task of state.tasks) {
      const row = document.createElement('li');
      const title = document.createElement('p');
      title.textContent = task.title;
      row.append(title);
      const meta = document.createElement('small');
      const estimate =
        task.timeEstimate > 0
          ? `${Math.floor(Math.ceil(task.timeEstimate / 60000) / 60)}:${String(Math.ceil(task.timeEstimate / 60000) % 60).padStart(2, '0')}`
          : '';
      meta.textContent = [task.projectTitle, estimate].filter(Boolean).join(' · ');
      row.append(meta);
      if (task.subTasks.length) {
        const children = document.createElement('ul');
        for (const taskChild of task.subTasks) {
          const child = document.createElement('li');
          child.textContent = taskChild.title;
          children.append(child);
        }
        row.append(children);
      }
      fragment.append(row);
    }
    list.replaceChildren(fragment);
  });
})();

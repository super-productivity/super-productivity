'use strict';
const form = document.getElementById('capture-consent');
const status = document.getElementById('status');
const submit = form.querySelector('button[type="submit"]');
const cancel = document.getElementById('cancel');
const submitLabel = submit.textContent;
cancel.addEventListener('click', () => {
  const message = document.createElement('p');
  message.textContent = 'Connection cancelled. You can close this window.';
  message.setAttribute('role', 'status');
  message.tabIndex = -1;
  form.replaceWith(message);
  message.focus();
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = 'Connecting…';
  form.setAttribute('aria-busy', 'true');
  status.textContent = '';
  try {
    const response = await fetch('/oauth/authorize/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authId: form.dataset.authId,
        code: form.elements.code.value,
      }),
    });
    if (!response.ok) {
      status.textContent =
        response.status === 429
          ? 'Too many attempts. Please try again later.'
          : 'This code or connection has expired or is invalid. Start again from your assistant and create a new code in Super Productivity.';
      return;
    }
    const result = await response.json();
    form.elements.code.value = '';
    window.location.assign(result.redirect);
  } catch {
    status.textContent = 'Could not connect. Please check your connection and try again.';
  } finally {
    submit.disabled = false;
    cancel.disabled = false;
    submit.textContent = submitLabel;
    form.removeAttribute('aria-busy');
  }
});

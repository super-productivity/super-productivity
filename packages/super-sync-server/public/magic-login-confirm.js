// Magic link login confirmation script
// Reads magic link token from data attribute, verifies it via POST,
// stores the resulting JWT in sessionStorage, and redirects to main page.
//
// This two-step flow (GET renders page, POST verifies token) prevents
// email client link prefetchers from consuming the single-use magic link token.
(function () {
  var token = document.body.dataset.token;
  var loginBtn = document.getElementById('login-btn');
  var errorEl = document.getElementById('error');
  var successEl = document.getElementById('success');

  if (!token || !loginBtn) {
    return;
  }

  loginBtn.addEventListener('click', function () {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    errorEl.style.display = 'none';

    fetch('/api/login/magic-link/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data.token) {
          successEl.style.display = 'block';
          loginBtn.style.display = 'none';
          sessionStorage.setItem('loginToken', result.data.token);
          window.location.href = '/';
        } else {
          throw new Error(result.data.error || 'Login failed');
        }
      })
      .catch(function (err) {
        errorEl.textContent = err.message || 'An error occurred. Please try again.';
        errorEl.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log In';
      });
  });
})();

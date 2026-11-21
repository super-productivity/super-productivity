// Email verification confirmation script
// Reads verification token from data attribute, verifies it via POST,
// and redirects to the login page. The GET renders a confirmation page
// showing which pending credential the link authorizes (#9032); only
// the explicit button click consumes the token — email link prefetchers
// must not activate a staged passkey.
(function () {
  var token = document.body.dataset.token;
  var verifyBtn = document.getElementById('verify-btn');
  var errorEl = document.getElementById('error');
  var successEl = document.getElementById('success');

  if (!token || !verifyBtn) {
    return;
  }

  verifyBtn.addEventListener('click', function () {
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying...';
    errorEl.style.display = 'none';

    fetch('/api/verify-email', {
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
        if (result.ok) {
          successEl.style.display = 'block';
          verifyBtn.style.display = 'none';
          window.location.href = document.body.dataset.loginPage || '/';
        } else {
          throw new Error(result.data.error || 'Verification failed');
        }
      })
      .catch(function (err) {
        errorEl.textContent = err.message || 'An error occurred. Please try again.';
        errorEl.style.display = 'block';
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify Email';
      });
  });
})();

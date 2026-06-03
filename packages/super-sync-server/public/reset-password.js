// Reset password form handler
// Reads token from data attribute, submits password reset via POST.
(function () {
  var form = document.getElementById('resetForm');
  var errorEl = document.getElementById('error');
  var successEl = document.getElementById('success');
  var submitBtn = document.getElementById('submitBtn');
  var token = document.body.dataset.token;

  if (!form || !token) {
    return;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    var password = document.getElementById('password').value;
    var confirmPassword = document.getElementById('confirmPassword').value;

    if (password !== confirmPassword) {
      errorEl.textContent = 'Passwords do not match';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting...';

    fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, password: password }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          successEl.textContent = result.data.message || 'Password reset successfully!';
          successEl.style.display = 'block';
          form.style.display = 'none';
        } else {
          throw new Error(result.data.error || 'Failed to reset password');
        }
      })
      .catch(function (err) {
        errorEl.textContent = err.message || 'An error occurred. Please try again.';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Password';
      });
  });
})();

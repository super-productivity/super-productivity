// Passkey recovery handler
// Reads token from data attribute, guides user through passkey registration via WebAuthn.
(function () {
  var recoverBtn = document.getElementById('recoverBtn');
  var errorEl = document.getElementById('error');
  var successEl = document.getElementById('success');
  var infoEl = document.getElementById('info');
  var token = document.body.dataset.token;

  if (!recoverBtn || !token) {
    return;
  }

  recoverBtn.addEventListener('click', function () {
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    infoEl.textContent = '';
    recoverBtn.disabled = true;
    recoverBtn.textContent = 'Preparing...';

    // Step 1: Get registration options from server
    fetch('/api/recover/passkey/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    })
      .then(function (optionsRes) {
        if (!optionsRes.ok) {
          return optionsRes.json().then(function (data) {
            throw new Error(data.error || 'Failed to get registration options');
          });
        }
        return optionsRes.json();
      })
      .then(function (data) {
        // Step 2: Create passkey using browser API
        infoEl.textContent =
          'Please follow your browser/device prompt to create a new passkey...';
        recoverBtn.textContent = 'Waiting for passkey...';

        return SimpleWebAuthnBrowser.startRegistration({
          optionsJSON: data.options,
        });
      })
      .then(function (credential) {
        // Step 3: Send credential to server for verification
        recoverBtn.textContent = 'Verifying...';
        infoEl.textContent = '';

        return fetch('/api/recover/passkey/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, credential: credential }),
        }).then(function (completeRes) {
          return completeRes.json().then(function (completeData) {
            if (completeRes.ok) {
              successEl.textContent =
                completeData.message || 'Passkey registered successfully!';
              successEl.style.display = 'block';
              recoverBtn.style.display = 'none';
              infoEl.innerHTML =
                '<a href="/" style="color: #3b82f6;">Return to Login</a>';
            } else {
              throw new Error(completeData.error || 'Failed to complete recovery');
            }
          });
        });
      })
      .catch(function (err) {
        console.error('Passkey recovery error:', err);
        errorEl.textContent = err.message || 'An error occurred. Please try again.';
        errorEl.style.display = 'block';
        recoverBtn.disabled = false;
        recoverBtn.textContent = 'Register New Passkey';
      });
  });
})();

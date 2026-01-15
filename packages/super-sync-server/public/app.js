const API_BASE = '/api';

// State
const state = {
  token: null,
  email: localStorage.getItem('supersync_email') || '',
};

// DOM Elements
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authForms = document.getElementById('auth-forms');
const tokenDisplay = document.getElementById('token-display');
const tokenArea = document.getElementById('token-area');
const messageArea = document.getElementById('message-area');
const copyBtn = document.getElementById('copy-btn');
const refreshBtn = document.getElementById('refresh-btn');
const logoutBtn = document.getElementById('logout-btn');
const deleteAccountBtn = document.getElementById('delete-account-btn');
const resetAccountBtn = document.getElementById('reset-account-btn');
const accountSettingsBtn = document.getElementById('account-settings-btn');
const accountSettings = document.getElementById('account-settings');
const backToTokenBtn = document.getElementById('back-to-token-btn');
const tabLoginBtn = document.getElementById('tab-login');
const tabRegisterBtn = document.getElementById('tab-register');
const lostPasskeyForm = document.getElementById('lost-passkey-form');
const showLostPasskeyBtn = document.getElementById('show-lost-passkey');
const backToLoginFromPasskeyBtn = document.getElementById('back-to-login-from-passkey');
const loginPasskeyBtn = document.getElementById('login-passkey-btn');
const loginMagicLinkBtn = document.getElementById('login-magic-link-btn');
const registerPasskeyBtn = document.getElementById('register-passkey-btn');

// Email inputs (synced across forms)
const emailInputs = [
  document.getElementById('login-email'),
  document.getElementById('register-email'),
  document.getElementById('lost-passkey-email'),
];

// --- Event Listeners ---

// Tab switching
tabLoginBtn.addEventListener('click', () => switchTab('login'));
tabRegisterBtn.addEventListener('click', () => switchTab('register'));

// Token area - select all on click
tokenArea.addEventListener('click', () => tokenArea.select());

// Copy token button
copyBtn.addEventListener('click', copyToken);

// Refresh token button
refreshBtn.addEventListener('click', refreshToken);

// Logout button
logoutBtn.addEventListener('click', logout);

// Delete account button
deleteAccountBtn.addEventListener('click', deleteAccount);

// Reset account button
resetAccountBtn.addEventListener('click', resetAccount);

// Account settings navigation
accountSettingsBtn.addEventListener('click', showAccountSettings);
backToTokenBtn.addEventListener('click', showTokenDisplay);

// Show lost passkey form
showLostPasskeyBtn.addEventListener('click', () => {
  loginForm.classList.remove('active');
  lostPasskeyForm.classList.add('active');
  hideMessage();
});

// Back to login from lost passkey
backToLoginFromPasskeyBtn.addEventListener('click', () => {
  lostPasskeyForm.classList.remove('active');
  loginForm.classList.add('active');
  hideMessage();
});

// Passkey login button
loginPasskeyBtn.addEventListener('click', loginWithPasskey);

// Magic link login button
loginMagicLinkBtn.addEventListener('click', requestMagicLink);

// Passkey register button
registerPasskeyBtn.addEventListener('click', registerWithPasskey);

// Email input sync - when any email input changes, update all others
emailInputs.forEach((input) => {
  input.addEventListener('input', (e) => {
    const newEmail = e.target.value;
    state.email = newEmail;
    // Save to localStorage for persistence across page reloads
    localStorage.setItem('supersync_email', newEmail);
    // Sync to other inputs
    emailInputs.forEach((otherInput) => {
      if (otherInput !== e.target) {
        otherInput.value = newEmail;
      }
    });
  });
});

// Lost passkey form submit
lostPasskeyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('lost-passkey-email').value;

  setLoading(true);
  hideMessage();

  try {
    await fetch(`${API_BASE}/recover/passkey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    // Always show success (security: don't reveal if email exists)
    showMessage(
      'If an account exists with that email, you will receive a passkey recovery link.',
      'success',
    );

    // Return to login after a delay
    setTimeout(() => {
      lostPasskeyForm.classList.remove('active');
      loginForm.classList.add('active');
    }, 3000);
  } catch (err) {
    showMessage('An error occurred. Please try again.', 'error');
  } finally {
    setLoading(false);
  }
});

// --- Functions ---

function switchTab(tab) {
  // Update buttons
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.remove('active');
    if (btn.innerText.toLowerCase().includes(tab)) {
      btn.classList.add('active');
    }
  });

  // Update forms
  document.querySelectorAll('.auth-form').forEach((form) => {
    form.classList.remove('active');
  });
  document.getElementById(`${tab}-form`).classList.add('active');

  // Clear messages
  hideMessage();
}

function showToken(token) {
  state.token = token;
  tokenArea.value = token;
  authForms.classList.add('hidden');
  tokenDisplay.classList.remove('hidden');
  showMessage('Logged in successfully!', 'success');
}

function logout() {
  state.token = null;
  tokenArea.value = '';
  tokenDisplay.classList.add('hidden');
  accountSettings.classList.add('hidden');
  authForms.classList.remove('hidden');
  hideMessage();
}

function showAccountSettings() {
  tokenDisplay.classList.add('hidden');
  accountSettings.classList.remove('hidden');
  hideMessage();
}

function showTokenDisplay() {
  accountSettings.classList.add('hidden');
  tokenDisplay.classList.remove('hidden');
  hideMessage();
}

async function copyToken() {
  if (!state.token) return;

  let copied = false;

  // Try modern clipboard API first
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(state.token);
      copied = true;
    } catch (err) {
      // Fall through to fallback
    }
  }

  // Fallback for non-secure contexts (HTTP)
  if (!copied) {
    try {
      tokenArea.select();
      tokenArea.setSelectionRange(0, 99999); // For mobile
      copied = document.execCommand('copy');
    } catch (err) {
      // Fallback failed
    }
  }

  if (copied) {
    const originalText = copyBtn.innerText;
    copyBtn.innerText = 'Copied!';
    copyBtn.classList.add('success');

    setTimeout(() => {
      copyBtn.innerText = originalText;
      copyBtn.classList.remove('success');
    }, 2000);
  } else {
    showMessage('Please manually select and copy the token', 'error');
    tokenArea.select();
  }
}

async function refreshToken() {
  if (!state.token) return;

  // Show confirmation dialog
  const confirmed = confirm(
    'Are you sure you want to refresh your token?\n\n' +
      'This will invalidate your current token. You will need to update ' +
      'the token in Super Productivity and any other devices using this account.',
  );

  if (!confirmed) return;

  setLoading(true);
  hideMessage();

  try {
    const res = await fetch(`${API_BASE}/replace-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: '{}',
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to refresh token');
    }

    // Update with new token
    state.token = data.token;
    tokenArea.value = data.token;

    // Visual feedback
    const originalText = refreshBtn.innerText;
    refreshBtn.innerText = 'Refreshed!';
    refreshBtn.classList.add('success');
    showMessage('Token refreshed! Old token is now invalid.', 'success');

    setTimeout(() => {
      refreshBtn.innerText = originalText;
      refreshBtn.classList.remove('success');
    }, 2000);
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function deleteAccount() {
  if (!state.token) return;

  // Show confirmation dialog
  const confirmed = confirm(
    'Are you sure you want to DELETE your account?\n\n' +
      'This will PERMANENTLY delete your account and ALL synced data. ' +
      'This action cannot be undone.\n\n' +
      'Your local data in Super Productivity will NOT be affected.',
  );

  if (!confirmed) return;

  setLoading(true);
  hideMessage();

  try {
    const res = await fetch(`${API_BASE}/account`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: '{}',
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete account');
    }

    // Show success and return to login
    showMessage('Account deleted successfully.', 'success');

    // Clear state and return to auth forms
    state.token = null;
    tokenArea.value = '';
    tokenDisplay.classList.add('hidden');
    accountSettings.classList.add('hidden');
    authForms.classList.remove('hidden');
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function resetAccount() {
  if (!state.token) return;

  // Show confirmation dialog
  const confirmed = confirm(
    'Are you sure you want to RESET your account?\n\n' +
      'This will delete ALL synced data from the server, but your account will remain active.\n\n' +
      'Your local data in Super Productivity will NOT be affected.\n' +
      'You can sync again after resetting.',
  );

  if (!confirmed) return;

  setLoading(true);
  hideMessage();

  try {
    const res = await fetch(`${API_BASE}/sync/data`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: '{}',
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to reset account');
    }

    // Show success message
    showMessage(
      'Account reset successfully! All synced data has been cleared. You can now sync fresh data.',
      'success',
    );
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

function showMessage(msg, type) {
  messageArea.innerText = msg;
  messageArea.className = type === 'error' ? 'msg-error' : 'msg-success';
  messageArea.classList.remove('hidden');
}

function hideMessage() {
  messageArea.classList.add('hidden');
}

function setLoading(isLoading) {
  const btns = document.querySelectorAll('button');
  btns.forEach((btn) => (btn.disabled = isLoading));
  if (isLoading) {
    document.body.style.cursor = 'wait';
  } else {
    document.body.style.cursor = 'default';
  }
}

// --- Passkey Functions ---

async function loginWithPasskey() {
  const email = document.getElementById('login-email').value;

  if (!email) {
    showMessage('Please enter your email address', 'error');
    return;
  }

  setLoading(true);
  hideMessage();

  try {
    // Step 1: Get authentication options from server
    const optionsRes = await fetch(`${API_BASE}/login/passkey/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!optionsRes.ok) {
      const data = await optionsRes.json();
      throw new Error(data.error || 'Failed to get login options');
    }

    const options = await optionsRes.json();

    // Step 2: Authenticate with passkey using browser API
    showMessage('Please follow your browser/device prompt...', 'success');

    const credential = await SimpleWebAuthnBrowser.startAuthentication({
      optionsJSON: options,
    });

    // Step 3: Verify with server
    const verifyRes = await fetch(`${API_BASE}/login/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, credential }),
    });

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      throw new Error(verifyData.error || 'Authentication failed');
    }

    // Success - show token
    showToken(verifyData.token);
  } catch (err) {
    console.error('Passkey login error:', err);
    // Handle user cancellation gracefully
    if (err.name === 'NotAllowedError') {
      showMessage('Passkey authentication was cancelled', 'error');
    } else {
      showMessage(err.message || 'Passkey login failed', 'error');
    }
  } finally {
    setLoading(false);
  }
}

async function registerWithPasskey() {
  const email = document.getElementById('register-email').value;
  const termsAccepted = document.getElementById('register-terms').checked;

  if (!email) {
    showMessage('Please enter your email address', 'error');
    return;
  }

  if (!termsAccepted) {
    showMessage('You must accept the Terms of Service', 'error');
    return;
  }

  setLoading(true);
  hideMessage();

  try {
    // Step 1: Get registration options from server
    const optionsRes = await fetch(`${API_BASE}/register/passkey/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, termsAccepted }),
    });

    if (!optionsRes.ok) {
      const data = await optionsRes.json();
      throw new Error(data.error || 'Failed to get registration options');
    }

    const options = await optionsRes.json();

    // Step 2: Create passkey using browser API
    showMessage(
      'Please follow your browser/device prompt to create a passkey...',
      'success',
    );

    const credential = await SimpleWebAuthnBrowser.startRegistration({
      optionsJSON: options,
    });

    // Step 3: Verify registration with server
    const verifyRes = await fetch(`${API_BASE}/register/passkey/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, credential }),
    });

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      throw new Error(verifyData.error || 'Registration failed');
    }

    // Success - show message and prompt to verify email
    showMessage(
      verifyData.message ||
        'Registration successful! Please check your email to verify your account.',
      'success',
    );

    // Switch to login tab after delay
    setTimeout(() => {
      switchTab('login');
      document.getElementById('login-email').value = email;
      showMessage('Please verify your email, then login with your passkey.', 'success');
    }, 3000);
  } catch (err) {
    console.error('Passkey registration error:', err);
    // Handle user cancellation gracefully
    if (err.name === 'NotAllowedError') {
      showMessage('Passkey registration was cancelled', 'error');
    } else {
      showMessage(err.message || 'Passkey registration failed', 'error');
    }
  } finally {
    setLoading(false);
  }
}

// --- Page Load ---

// Check for token from magic link login (stored in sessionStorage by /magic-login page)
(function checkForMagicLinkToken() {
  const token = sessionStorage.getItem('loginToken');
  if (token) {
    sessionStorage.removeItem('loginToken');
    showToken(token);
  }
})();

// Initialize email inputs from saved state
(function initEmailInputs() {
  if (state.email) {
    emailInputs.forEach((input) => {
      input.value = state.email;
    });
  }
})();

// --- Magic Link Functions ---

async function requestMagicLink() {
  const email = document.getElementById('login-email').value;

  if (!email) {
    showMessage('Please enter your email address', 'error');
    return;
  }

  setLoading(true);
  hideMessage();

  try {
    const res = await fetch(`${API_BASE}/login/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to send login link');
    }

    // Always show success message (security: don't reveal if email exists)
    showMessage(
      data.message ||
        'If an account exists with that email, you will receive a login link.',
      'success',
    );
  } catch (err) {
    showMessage(err.message || 'An error occurred. Please try again.', 'error');
  } finally {
    setLoading(false);
  }
}

// Connect mode of the login page. The app opens /?r=<request id> to sign in a new
// device; after login this panel replaces the token display, so the long-lived
// token is never shown or copied here. Loaded before app.js, which calls
// showConnectPanel() at the end of every login.

/** The sign-in request a new device waits on, or undefined on a normal visit. */
const CONNECT_REQUEST_ID = (() => {
  const r = new URLSearchParams(window.location.search).get('r');
  return r && /^[A-Za-z0-9_-]{22}$/.test(r) ? r : undefined;
})();

const CONNECT_PLATFORM_NAMES = {
  android: 'Android',
  ios: 'iOS',
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  web: 'Web browser',
};

const connectEl = (id) => document.getElementById(id);

if (CONNECT_REQUEST_ID) {
  connectEl('connect-intro').classList.remove('hidden');
}

// Display only: the server checks the token, this just names the account.
function emailFromToken(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)).email || '';
  } catch (err) {
    console.warn('Could not read the account email from the login token', err);
    return '';
  }
}

async function connectRequest(token, action) {
  const res = await fetch(
    `/api/connect/requests/${CONNECT_REQUEST_ID}${action ? `/${action}` : ''}`,
    { method: action ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/**
 * Shows the Connect panel for the account that just logged in.
 * @param {string} token login token, kept in memory only
 * @param {{ showMessage: Function, logout: Function }} page app.js helpers
 */
async function showConnectPanel(token, page) {
  const signOut = () => {
    connectEl('connect-panel').classList.add('hidden');
    page.logout();
  };
  connectEl('auth-forms').classList.add('hidden');
  connectEl('connect-details').classList.add('hidden');
  connectEl('connect-panel').classList.remove('hidden');
  const email = emailFromToken(token);
  connectEl('connect-account').textContent = email ? `Signed in as ${email}` : '';
  // Assigned, not added: the panel opens again after "Not you?" and a new login.
  connectEl('connect-not-you-btn').onclick = signOut;
  connectEl('connect-approve-btn').onclick = () =>
    decideConnect(token, 'approve', { ...page, signOut });
  connectEl('connect-cancel-btn').onclick = () =>
    decideConnect(token, 'cancel', { ...page, signOut });
  await loadConnectDetails(token, { ...page, signOut });
}

async function loadConnectDetails(token, page) {
  try {
    const { status, data } = await connectRequest(token);
    if (handleConnectFailure(status, data, page)) return;
    connectEl('connect-device').textContent = data.deviceName;
    connectEl('connect-platform').textContent =
      CONNECT_PLATFORM_NAMES[data.platform] || data.platform;
    connectEl('connect-code').textContent = data.matchCode;
    connectEl('connect-details').classList.remove('hidden');
  } catch (err) {
    console.warn('Loading the sign-in request failed', err);
    page.showMessage(
      'Could not reach the server. Reload the page to try again.',
      'error',
    );
  }
}

async function decideConnect(token, action, page) {
  const buttons = [connectEl('connect-approve-btn'), connectEl('connect-cancel-btn')];
  buttons.forEach((btn) => (btn.disabled = true));
  try {
    const { status, data } = await connectRequest(token, action);
    if (handleConnectFailure(status, data, page)) return;
    connectEl('connect-details').classList.add('hidden');
    connectEl('connect-title').textContent =
      action === 'approve' ? 'Device connected' : 'Not connected';
    page.showMessage(
      action === 'approve'
        ? 'All done. You can close this tab; your app continues by itself.'
        : 'Cancelled. The device was not connected.',
      'success',
    );
  } catch (err) {
    console.warn(`Sign-in request ${action} failed`, err);
    page.showMessage('Could not reach the server. Please try again.', 'error');
  } finally {
    buttons.forEach((btn) => (btn.disabled = false));
  }
}

// True when the answer ended the Connect step; the page then says why.
function handleConnectFailure(status, data, page) {
  if (status === 200) return false;
  if (status === 401) {
    page.signOut();
    page.showMessage('Your login expired. Please log in again.', 'error');
    return true;
  }
  connectEl('connect-details').classList.add('hidden');
  page.showMessage(
    data.error || 'Something went wrong. Start again in the app.',
    'error',
  );
  return true;
}

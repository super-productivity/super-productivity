// WebDAV Sync Provider Plugin for Super Productivity
// Self-contained WebDAV implementation using fetch()

// ========================================
// WebDAV Constants
// ========================================
const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  MULTI_STATUS: 207,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  UNAUTHORIZED: 401,
};

const PROPFIND_XML = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:getetag/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;

// ========================================
// WebDAV HTTP Helpers
// ========================================
async function webdavRequest(cfg, method, path, opts = {}) {
  const url = buildFullPath(cfg.baseUrl, path);
  const headers = {
    Authorization: 'Basic ' + btoa(cfg.userName + ':' + cfg.password),
    ...(opts.headers || {}),
  };

  const response = await fetch(url, {
    method,
    headers,
    body: opts.body || null,
    cache: 'no-store',
  });

  const data = opts.responseType === 'none' ? '' : await response.text();
  return { status: response.status, data, headers: response.headers };
}

function buildFullPath(baseUrl, relativePath) {
  let base = baseUrl.replace(/\/$/, '');
  let path = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
  return base + path;
}

function cleanRev(rev) {
  if (!rev) return '';
  return rev.replace(/^"/, '').replace(/"$/, '').replace(/^W\//, '');
}

// ========================================
// WebDAV XML Parser
// ========================================
function parsePropsFromXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const responses = doc.querySelectorAll('response');
  const results = [];

  for (const resp of responses) {
    const href = resp.querySelector('href')?.textContent?.trim();
    if (!href) continue;

    const propstat = resp.querySelector('propstat');
    if (!propstat) continue;

    const status = propstat.querySelector('status')?.textContent;
    if (!status?.includes('200 OK')) continue;

    const prop = propstat.querySelector('prop');
    if (!prop) continue;

    const lastmod = prop.querySelector('getlastmodified')?.textContent || '';
    const etag = prop.querySelector('getetag')?.textContent || '';
    const resourceType = prop.querySelector('resourcetype');
    const isCollection = resourceType?.querySelector('collection') !== null;

    results.push({
      href: decodeURIComponent(href),
      lastmod,
      etag: cleanRev(etag),
      isCollection,
      filename: decodeURIComponent(href).split('/').pop() || '',
    });
  }

  return results;
}

// ========================================
// WebDAV API
// ========================================
async function getFileMeta(cfg, path) {
  const resp = await webdavRequest(cfg, 'PROPFIND', path, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '0',
    },
    body: PROPFIND_XML,
  });

  if (resp.status === HttpStatus.NOT_FOUND) {
    throw new Error(`File not found: ${path}`);
  }

  if (resp.status === HttpStatus.MULTI_STATUS) {
    const props = parsePropsFromXml(resp.data);
    if (props.length > 0) {
      return { rev: props[0].lastmod || props[0].etag };
    }
  }

  // Fallback to HEAD
  const headResp = await webdavRequest(cfg, 'HEAD', path, { responseType: 'none' });
  if (headResp.status === HttpStatus.NOT_FOUND) {
    throw new Error(`File not found: ${path}`);
  }
  const lastMod = headResp.headers.get('Last-Modified');
  const etag = headResp.headers.get('ETag');
  return { rev: lastMod || cleanRev(etag) || '' };
}

async function downloadFile(cfg, path) {
  const resp = await webdavRequest(cfg, 'GET', path);

  if (resp.status === HttpStatus.NOT_FOUND) {
    throw new Error(`File not found: ${path}`);
  }
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Download failed with status ${resp.status}`);
  }

  const lastMod = resp.headers.get('Last-Modified');
  const etag = resp.headers.get('ETag');
  return {
    rev: lastMod || cleanRev(etag) || '',
    dataStr: resp.data,
  };
}

async function uploadFile(cfg, path, dataStr, revToMatch, isForceOverwrite) {
  const headers = { 'Content-Type': 'application/octet-stream' };

  if (!isForceOverwrite && revToMatch) {
    // Use If-Unmodified-Since for optimistic locking (with 1s buffer for clock skew)
    const revDate = new Date(revToMatch);
    if (!isNaN(revDate.getTime())) {
      revDate.setSeconds(revDate.getSeconds() + 1);
      headers['If-Unmodified-Since'] = revDate.toUTCString();
    }
  }

  // Ensure parent directory exists
  const parentPath = path.substring(0, path.lastIndexOf('/') + 1);
  if (parentPath && parentPath !== '/') {
    await ensureDirectory(cfg, parentPath);
  }

  const resp = await webdavRequest(cfg, 'PUT', path, { headers, body: dataStr });

  if (resp.status === HttpStatus.PRECONDITION_FAILED) {
    throw new Error('Remote file changed unexpectedly (revision mismatch)');
  }
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Upload failed with status ${resp.status}`);
  }

  // Get the new revision after upload
  const meta = await getFileMeta(cfg, path);
  return { rev: meta.rev };
}

async function removeFile(cfg, path) {
  const resp = await webdavRequest(cfg, 'DELETE', path, { responseType: 'none' });
  if (
    resp.status !== HttpStatus.NO_CONTENT &&
    resp.status !== HttpStatus.OK &&
    resp.status !== HttpStatus.NOT_FOUND
  ) {
    throw new Error(`Remove failed with status ${resp.status}`);
  }
}

async function ensureDirectory(cfg, dirPath) {
  const resp = await webdavRequest(cfg, 'MKCOL', dirPath, { responseType: 'none' });
  // MKCOL returns 201 (created), 405 (already exists), or 409 (parent missing)
  if (resp.status === HttpStatus.CONFLICT) {
    // Parent directory missing — create it recursively
    const parent = dirPath.replace(/\/$/, '').substring(0, dirPath.lastIndexOf('/') + 1);
    if (parent && parent !== '/' && parent !== dirPath) {
      await ensureDirectory(cfg, parent);
      await webdavRequest(cfg, 'MKCOL', dirPath, { responseType: 'none' });
    }
  }
}

async function listFiles(cfg, dirPath) {
  const resp = await webdavRequest(cfg, 'PROPFIND', dirPath, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: '1',
    },
    body: PROPFIND_XML,
  });

  if (resp.status === HttpStatus.NOT_FOUND) return [];
  if (resp.status === HttpStatus.MULTI_STATUS) {
    const props = parsePropsFromXml(resp.data);
    return props.filter((p) => !p.isCollection).map((p) => p.filename);
  }
  return [];
}

async function testConnection(cfg) {
  try {
    const resp = await webdavRequest(cfg, 'PROPFIND', cfg.syncFolderPath || '/', {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
      },
      body: PROPFIND_XML,
    });
    return resp.status === HttpStatus.MULTI_STATUS || resp.status === HttpStatus.OK;
  } catch (e) {
    return false;
  }
}

// ========================================
// Config Management
// ========================================
let config = null;

async function loadConfig() {
  const data = await plugin.loadLocalData();
  config = data ? JSON.parse(data) : null;
  return config;
}

async function saveConfig(newConfig) {
  config = newConfig;
  await plugin.persistDataLocal(JSON.stringify(config));
}

function buildSyncPath(relativePath) {
  const folder = (config?.syncFolderPath || '/').replace(/\/$/, '');
  return folder + '/' + relativePath;
}

// ========================================
// Initialize
// ========================================
loadConfig().then(() => {
  plugin.log.info('WebDAV Sync Plugin loaded, config present:', !!config);
});

// ========================================
// Register Sync Provider
// ========================================
plugin.registerSyncProvider({
  id: 'webdav',
  label: 'WebDAV',
  icon: 'cloud',
  maxConcurrentRequests: 10,
  isUploadForcePossible: true,

  isReady: async () => {
    await loadConfig();
    return !!(config?.baseUrl && config?.userName && config?.password);
  },

  getFileRev: async (path, localRev) => {
    if (!config) throw new Error('WebDAV not configured');
    return getFileMeta(config, buildSyncPath(path));
  },

  downloadFile: async (path) => {
    if (!config) throw new Error('WebDAV not configured');
    return downloadFile(config, buildSyncPath(path));
  },

  uploadFile: async (path, dataStr, revToMatch, isForceOverwrite) => {
    if (!config) throw new Error('WebDAV not configured');
    return uploadFile(config, buildSyncPath(path), dataStr, revToMatch, isForceOverwrite);
  },

  removeFile: async (path) => {
    if (!config) throw new Error('WebDAV not configured');
    return removeFile(config, buildSyncPath(path));
  },

  listFiles: async (path) => {
    if (!config) throw new Error('WebDAV not configured');
    return listFiles(config, buildSyncPath(path));
  },
});

// ========================================
// Configuration Menu Entry
// ========================================
plugin.registerMenuEntry({
  label: 'Configure WebDAV Sync',
  icon: 'settings',
  onClick: async () => {
    await loadConfig();
    const currentCfg = config || {
      baseUrl: '',
      userName: '',
      password: '',
      syncFolderPath: '/',
    };

    await plugin.openDialog({
      htmlContent: `
        <h2>WebDAV Sync Configuration</h2>
        <div style="display:flex;flex-direction:column;gap:12px;min-width:360px;">
          <label>
            <div style="margin-bottom:4px;font-weight:500;">Server URL</div>
            <input id="webdav-baseUrl" type="url" value="${escapeHtml(currentCfg.baseUrl)}"
              placeholder="https://your-server/remote.php/dav/files/user/"
              style="width:100%;padding:8px;box-sizing:border-box;" />
          </label>
          <label>
            <div style="margin-bottom:4px;font-weight:500;">Username</div>
            <input id="webdav-userName" type="text" value="${escapeHtml(currentCfg.userName)}"
              style="width:100%;padding:8px;box-sizing:border-box;" />
          </label>
          <label>
            <div style="margin-bottom:4px;font-weight:500;">Password</div>
            <input id="webdav-password" type="password" value="${escapeHtml(currentCfg.password)}"
              style="width:100%;padding:8px;box-sizing:border-box;" />
          </label>
          <label>
            <div style="margin-bottom:4px;font-weight:500;">Sync Folder Path</div>
            <input id="webdav-syncFolderPath" type="text" value="${escapeHtml(currentCfg.syncFolderPath)}"
              placeholder="/"
              style="width:100%;padding:8px;box-sizing:border-box;" />
          </label>
          <div id="webdav-test-result" style="padding:8px;display:none;border-radius:4px;"></div>
        </div>
      `,
      buttons: [
        {
          label: 'Test Connection',
          icon: 'wifi_tethering',
          onClick: async () => {
            const testCfg = getDialogValues();
            const resultEl = document.getElementById('webdav-test-result');
            if (resultEl) {
              resultEl.style.display = 'block';
              resultEl.textContent = 'Testing...';
              resultEl.style.background = '#e3f2fd';
            }
            const ok = await testConnection(testCfg);
            if (resultEl) {
              resultEl.textContent = ok
                ? 'Connection successful!'
                : 'Connection failed. Check credentials and URL.';
              resultEl.style.background = ok ? '#e8f5e9' : '#ffebee';
            }
          },
        },
        {
          label: 'Save',
          icon: 'save',
          color: 'primary',
          raised: true,
          onClick: async () => {
            const newCfg = getDialogValues();
            await saveConfig(newCfg);
            plugin.showSnack({ msg: 'WebDAV configuration saved', type: 'SUCCESS' });
          },
        },
      ],
    });
  },
});

function getDialogValues() {
  return {
    baseUrl: document.getElementById('webdav-baseUrl')?.value || '',
    userName: document.getElementById('webdav-userName')?.value || '',
    password: document.getElementById('webdav-password')?.value || '',
    syncFolderPath: document.getElementById('webdav-syncFolderPath')?.value || '/',
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

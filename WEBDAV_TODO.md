# WebDAV Troubleshooting Plan: taiga.arbor-insight.com

We know `taiga.arbor-insight.com` busts through the firewall (Port 443 open), but it currently returns **405 Method Not Allowed**. This means it points to a service (likely DSM Login) that doesn't speak WebDAV.

## Goal

Find the correct **Path** or **Port** that talks to the WebDAV Service, not the DSM Login.

## Checklist

### 1. Synology Portal Check (You do this)

Since you have portal access, log in and check:

- [ ] Open **Control Panel** -> **Login Portal** -> **Applications**.
- [ ] Look for **WebDAV Server**.
- [ ] Does it have a specific **Alias**? (e.g., `alias: /webdav`)
  - _If yes:_ Your URL is `https://taiga.arbor-insight.com/webdav`
- [ ] Open **WebDAV Server** app -> Settings.
  - [ ] Is HTTPS Enabled? (Port 5006)

### 2. Reverse Proxy Check (You do this)

If `taiga.arbor-insight.com` is an Nginx Reverse Proxy (as `curl` header suggested):

- [ ] Open **Control Panel** -> **Login Portal** -> **Advanced** -> **Reverse Proxy**.
- [ ] Look for a rule mapping `taiga.arbor-insight.com`.
- [ ] **Crucial:** Where does it point?
  - `localhost:5000` / `5001` -> **WRONG** (This causes Error 405).
  - `localhost:5006` -> **CORRECT** (This is what we need).
- [ ] **Action:** Create a new Reverse Proxy rule (or update existing):
  - **Source:** `https://webdav.arbor-insight.com` (or similar new subdomain)
  - **Destination:** `https://localhost:5006`

### 3. URL Trial & Error

Try these URLs in Super Productivity (or browser):

1.  `https://taiga.arbor-insight.com/superproductivity/` (Default - Fails 405)
2.  `https://taiga.arbor-insight.com:5006/superproductivity/` (Direct Port - Likely Blocked)
3.  `https://taiga.arbor-insight.com/webdav/superproductivity/` (If alias exists)

**Root Cause:** You are hitting the DSM Login page (Port 5001) via Port 443. The DSM Login page rejects WebDAV commands. You need to hit the WebDAV Service (Port 5006).

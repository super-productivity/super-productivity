# 🌲 Arbor Insight: Next Steps & Integration Guide

Congratulations! You have successfully recovered your data, stabilized the application, and organized your tasks into a dopamine-friendly workflow.

## 🚀 Status Check

- **Data:** Recovered from crash (manual changes preserved).
- **Stability:** "Domina Mode" disabled to prevent crashes.
- **Structure:** Tasks moved to **CEO** (Blue) and **CTO** (Green) projects.
- **Workflow:** Redundant "Priority" tags removed. **ADHD Quadrants** board ready to use.

---

## 🛠️ Step 1: Import Your Stable Config

You must do this to apply the fixes and get the clean UI.

1.  Open **Super Productivity**.
2.  Go to **Settings** (Bottom Left) -> **Data Import/Export**.
3.  Click **Import Data**.
4.  Select: `~/repos/super-productivity/arbor-rescue.json`
    - _(Or `arbor-adhd-quadrant.json` if you want the 4-column board immediately)_.

---

## 🔌 Step 2: Waybar Integration (Linux)

"Built-in Support" refers to the System Tray integration. Super Productivity puts the current task title in the tray icon's tooltip/title property.

### 1. Enable in App

- Go to **Settings** -> **Miscellaneous**.
- Ensure **"Show current task in tray"** is **CHECKED**.

### 2. Configure Waybar (`~/.config/waybar/config`)

Add the `tray` module to your bar if it's missing:

```json
"modules-right": ["tray", "clock"],
"tray": {
    "icon-size": 21,
    "spacing": 10
}
```

### 3. Alternative: Custom Script (Advanced)

If you want the text directly on the bar (not just hovering over the icon), you can use a script to query the app's database.

- **Note:** Since DBus is disabled in this version, reading the `session.json` is the standard "hacker" way, but it is heavy.
- **Recommendation:** Stick to the Tray Icon for now. It uses 0 CPU and just works.

---

## 🔗 Step 3: Connect Integrations

These are **Project-Specific** settings.

### 🔵 CEO Project (Edwin/Trello)

1.  Click **"CEO"** in the sidebar.
2.  Click the **Gear Icon ⚙️** (next to the project title "CEO" at the top).
3.  Scroll to **Issue Providers**.
4.  Enable **Trello**.
5.  **API Key:** Paste the key you generated.
6.  **Token:** Paste the long token you generated.
7.  Click **Save**, then "Load Boards" to select Edwin's board.

### 🟢 CTO Project (GitHub)

1.  Click **"CTO"** in the sidebar.
2.  Click the **Gear Icon ⚙️**.
3.  Scroll to **Issue Providers**.
4.  Enable **GitHub**.
5.  **Token:** Generate a Personal Access Token (PAT) on GitHub with `repo` scope.
6.  **Repository:** Enter `username/repo-name`.

---

## 💾 Step 4: The Safety Net (WebDAV)

This backs up _everything_ to your NAS.

1.  Go to **Global Settings** (Bottom Left).
2.  Scroll to **Sync**.
3.  Select **WebDAV**.
4.  **URL:** `https://your-nas.local/webdav/superproductivity/`
5.  **User/Pass:** Your NAS login.
6.  Click **Save**.
7.  **Verify:** Look for the "Success" toast notification.

---

## 🧠 ADHD "Emergency" Protocol

If you ever get overwhelmed or the app crashes again:

1.  **Don't Panic.**
2.  The app auto-backs up to `~/.config/superProductivity/backups/` every day.
3.  Just run the **Rescue Script** again (or ask Claude to do it):
    ```bash
    cd ~/repos/super-productivity
    node rescue-arbor.js
    ```

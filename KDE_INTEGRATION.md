# 🐧 KDE Plasma Integration Guide

Since you are using **CachyOS with KDE Plasma** (not Hyprland/Waybar), the "Waybar" instructions don't apply directly. Here is how to achieve the same goals natively in KDE.

## 1. Current Task & Break Timer

Super Productivity displays the current task and timer in the **Window Title**.

- **How to see it:** Look at your **Task Manager** (the bar at the bottom).
- **What you see:** `[25:00] Your Current Task Name - Super Productivity`
- **Action:** No configuration needed! It works out of the box.

## 2. Tray Icon (Quick Status)

Super Productivity sits in your System Tray (usually bottom right, near the clock).

- **Enable Feature:**
  1.  Open Super Productivity.
  2.  Go to **Settings -> Miscellaneous**.
  3.  Ensure **"Show current task in tray"** is checked.
- **How to use it:**
  - **Hover:** Shows the current task name in the tooltip.
  - **Icon:** Shows a progress circle/pie chart for the timer.
  - **Red Dot:** Indicates notifications (like Trello sync errors or overdue tasks).

## 3. Advanced: Text on Panel (Custom Script)

If you _really_ want the task name written directly on your panel (not just in the Task Manager), you can use a **Command Output** widget.

1.  **Right-click** your Panel -> **Add Widgets**.
2.  Search for **"Command Output"** (or "Generic Monitor").
3.  Drag it to your panel.
4.  **Configure** the widget:
    - **Command:** `/home/mchang/repos/super-productivity/scripts/get-sp-status.py`
    - **Interval:** `30` seconds (reading backups is heavy, don't do 1s).
    - **Display:** It will show the JSON output. You might need to adjust the script to output just plain text if the widget doesn't support JSON parsing.

    _To modify the script for plain text:_
    Edit `scripts/get-sp-status.py` and change the print line at the bottom to:

    ```python
    # Replace the JSON print with:
    print(f"SP: {current_task_title}")
    ```

## 4. Trello Status

- **Primary:** Watch the **Tray Icon**. A red dot means "Issue" (sync error or connection lost).
- **Secondary:** Open the "CEO" project view. The Trello cards will have sync icons on them.

---

### 🚀 Summary for KDE User

You don't need complex configs!

1.  **Window Title:** Shows Timer + Task.
2.  **Tray Icon:** Shows Progress + Status.
3.  **Trello:** Alerts via Tray Notifications.

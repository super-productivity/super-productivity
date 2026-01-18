#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

# Configuration
CONFIG_DIR = Path.home() / ".config" / "superProductivity"
BACKUP_DIR = CONFIG_DIR / "backups"


def get_latest_backup():
    try:
        files = sorted(BACKUP_DIR.glob("*.json"), key=os.path.getmtime, reverse=True)
        return files[0] if files else None
    except Exception:
        return None


def main():
    mode = "text"
    if len(sys.argv) > 1 and sys.argv[1] == "--waybar":
        mode = "waybar"

    data_file = get_latest_backup()

    current_task_title = "Idle"
    current_task_id = None

    if data_file:
        try:
            with open(data_file, "r") as f:
                content = json.load(f)

            # Handle different backup structures (wrapper vs direct)
            data = content.get("data", content)

            # Extract Current Task
            current_task_id = data.get("task", {}).get("currentTaskId")
            task_entities = data.get("task", {}).get("entities", {})

            if current_task_id and current_task_id in task_entities:
                current_task_title = task_entities[current_task_id].get(
                    "title", "Unknown Task"
                )
        except Exception as e:
            current_task_title = f"Error: {str(e)}"

    # Output
    if mode == "waybar":
        output = {
            "text": f"SP: {current_task_title}",
            "tooltip": f"Current Task: {current_task_title}\n(Source: Last Backup)",
            "class": "active" if current_task_id else "idle",
        }
        print(json.dumps(output))
    else:
        # Plain text for KDE / Terminal
        print(f"SP: {current_task_title}")


if __name__ == "__main__":
    main()

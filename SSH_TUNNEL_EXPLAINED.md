# SSH Tunnel Architecture: "Busting Through the Firewall"

You are currently outside the office network (Firewall). You want to connect Super Productivity (on your Laptop) to the Synology NAS (WebDAV) which is trapped inside.

```ascii
                            🔒 FIREWALL / NAT 🔒
                                     ┃
[ 💻 Laptop ]                        ┃        [ 🏢 Office Network 10.50.x.x ]
(Super Productivity)                 ┃
      │                              ┃
      │ 1. Connect to SSH Gateway    ┃
      │    (Port 22)                 ┃
      ▼                              ┃
[ 🚇 SSH Client ] ═══════════════════╬══════▶ [ 🚪 SSH Gateway / Jump Host ]
(Local Port 5006)       (Encrypted Tunnel)    (Inside the Network)
      ▲                              ┃                 │
      │                              ┃                 │ 2. Forward Traffic
      │                              ┃                 │    (Internal)
      │ 3. App talks to              ┃                 ▼
      │    localhost:5006            ┃        [ 💾 Synology NAS ]
      └──────────────────────────────╫──────▶ (IP: 10.50.10.20)
                                     ┃        (Port: 5006 WebDAV)
                                     ┃
```

### 🧩 How it Works

1.  **The Tunnel:** You run `ssh -L 5006:10.50.10.20:5006 user@gateway`. This creates a secure pipe.
2.  **The Mapping:** Your SSH client starts listening on your laptop's **Port 5006**.
3.  **The Magic:** When Super Productivity sends a file to `https://localhost:5006`, the SSH client grabs it, encrypts it, shoots it through the firewall to the Gateway, and the Gateway passes it to the NAS.
4.  **The Result:** The App thinks the NAS is right there on your computer.

### ⚠️ Current Status

- We checked your machine: **Port 5006 is NOT listening locally.**
- **Conclusion:** The tunnel is **not active** yet, or mapped to a different port.

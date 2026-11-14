---
type: how-to
source: https://ubuntu.com/desktop/docs/en/latest/how-to/access-a-remote-desktop/
title: Access a remote desktop
domain: ubuntu
---

# Access a remote desktop

You can view or control the desktop environment on another computer where desktop sharing is enabled. The desktop sharing works over the Remote Desktop Protocol (RDP) or the Virtual Network Computing (VNC) protocol.

On Ubuntu, we recommend using the Remmina application to access a remote desktop. It supports both RDP and VNC.

We'll refer to the system that shares its desktop as the *server*. We'll call the system that accesses the shared desktop remotely the *client*.

What you'll need:

* A client computer running Ubuntu 24.04 LTS or later.
* A server where RDP or VNC desktop sharing is enabled.
* Access credentials to the server, including its host name, the port number, the user name and the password.

## Add a connection

Click Add a new connection profile (+). The Remote Desktop Preference window opens.

### Server credentials

Enter the server configuration:

Protocol
: Select RDP if you're connecting to Ubuntu 24.04 LTS or later, or to Microsoft Windows.

  Select VNC if you're connecting to an earlier Ubuntu release such as 22.04 LTS, or to macOS.

Server
: The host name or IP address of the server, and the port number assigned to RDP or VNC. For example, `ThinkPad-X1.local:3389` or `192.168.1.2:5901`.

Username
: The user name configured for desktop sharing. Note that this might be different from the actual user name on the server system.

Password
: The password configured for desktop sharing. Note that this might be different from the actual user password on the server system.

## Connect to the server

Double-click the configured connection. Remmina tries to connect to the server.

You might need to accept a certificate if this is your first time connecting to the server.

A window opens, displaying the screen on the remote server. Depending on the configuration, it might be the live user session or a login screen.

## Troubleshooting

If Remmina fails to connect to the server:

* Make sure that the server credentials are correct. Check the host name or IP address, the port number, the user name and the password. Try an IP address instead of a host name, or the other way around.

* If you have access to the server, make sure that it's running.

* If you're trying to use the Desktop Sharing configuration, check that the user is logged into the graphical session on the server.

* Make sure that the firewall on the server allows the RDP or VNC ports that you're connecting to.

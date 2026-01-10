# super-productivity-android

Android App for Super Productivity (https://super-productivity.com/).

I am not an Android developer, so help would be very welcome!!

## New Connectivity-Free Mode is Here!

_This feature was added on October 7, 2024. See [Pull Request #57](https://github.com/super-productivity/super-productivity-android/pull/57)._

You can now use the core features of the app without an internet connection, offering a smoother and more reliable experience. We've made several key updates to enhance usability:

- **Connectivity-Free Mode Support**: Enjoy uninterrupted access to the app's main features without needing a network connection. You can still sync with WebDAV, Dropbox, or choose to work entirely offline without any network access.
- **Online-Only Mode (Compatibility Mode)**: For users who prefer or need the traditional experience, the app still supports the original mode, which requires an internet connection for functionality.
- **CORS Issues Resolved**: Fixed cross-origin resource sharing (CORS) problems, especially for WebDAV sync, ensuring secure and smooth synchronisation with local or hosted resources.
- **Enhanced Security**: Strengthened data protection to keep your information secure, even when offline.
- **Seamless Upgrade**: Existing users can continue using the app in Online-Only Mode (Compatibility Mode) without any disruptions, while new users can immediately enjoy the benefits of Connectivity-Free Mode. Future updates will also include a smooth migration plan for everyone.

Update now to enjoy these exciting new features and improvements!

## Launch Modes

The app supports two launch modes:

1. **Connectivity-Free Mode** (Recommended) – Use the app without an internet connection.
2. **Online-Only Mode (Compatibility Mode)** – Requires an internet connection to connect to production, local development, or self-hosted servers.

### Configuring Launch Mode

To configure the launch mode, adjust the `LAUNCH_MODE` setting in the `app_config.properties` file:

- **0**: Default behaviour (read from SharedPreferences)
- **1**: Force Online-Only Mode (Compatibility Mode)
- **2**: Force Connectivity-Free Mode (Recommended)

**Recommendation**: Set `LAUNCH_MODE` to `2` for Connectivity-Free Mode.

### How to Adjust `LAUNCH_MODE`

1. Locate the `app_config.properties` file in the project's root directory.
2. Open the file in a text editor.
3. Find the `LAUNCH_MODE` setting and set it to your desired mode (`0`, `1`, or `2`).

```properties
LAUNCH_MODE=2
```

**Important**: The `app_config.properties` file is intended for local modifications only. **DO NOT COMMIT** this file unless you are sure of what you are doing.

### Detailed Configuration Guides

- **[Connectivity-Free Mode Documentation (Recommended)](./README_OFFLINE.md)**: Step-by-step guide to setting up and building the app in Connectivity-Free Mode.
- **[Online-Only Mode (Compatibility) Documentation](./README_ONLINE.md)**: Step-by-step guide to setting up and building the app in Online-Only Mode.

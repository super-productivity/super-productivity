# Connectivity-Free Mode Configuration

**Connectivity-Free Mode** allows you to use the Super Productivity Android app without an internet connection. This mode is recommended for users who prefer local usage.

## Setting Launch Mode to Connectivity-Free

To enable Connectivity-Free Mode, set the `LAUNCH_MODE` to `0` (Default for new installation) or `2` in the `app_config.properties` file.

For users performing a **new installation**, setting `LAUNCH_MODE` to `2` ensures that the app starts in Connectivity-Free Mode by default. This avoids any attempts to connect to online services, providing a seamless offline experience from the outset.

**Important**: If you set `LAUNCH_MODE` to `0`, the app will use the default behavior, which may attempt to read from SharedPreferences and connect to online services if available. To maintain a purely offline experience, always set `LAUNCH_MODE` to `2` for new installations.

## Building and Running super-productivity-android Locally

### 1. Clone the Repository

To set up the project, clone the `super-productivity` repository instead of directly cloning the `super-productivity-android` repository. This ensures that all submodules, including the Android project, are properly initialized.

```bash
git clone https://github.com/super-productivity/super-productivity.git
cd super-productivity
git submodule init
git submodule update
```

### 2. Compile the Node.js Project

Ensure you have Node.js and npm installed. Navigate to the root directory of the `super-productivity` project and install the necessary dependencies.

```bash
npm install
```

### 3. Compile the Android Project

From the root directory, compile the Android project using the following commands:

- **For Testing Builds:**

  ```bash
  npm run dist:android
  ```

- **For Production Builds:**

  ```bash
  npm run dist:android:prod
  ```

### 4. Installation

You can install the compiled Android application using either Android Studio or npm scripts.

- **Using Android Studio:**

  1. Open Android Studio.
  2. Select `Open an existing project`.
  3. Navigate to the `android` directory within the cloned repository.
  4. Follow the prompts to build and run the application on your device or emulator.

- **Using NPM Scripts:**

  - **For Testing Installation:**

    ```bash
    npm run install:android
    ```

  - **For Production Installation:**

    ```bash
    npm run install:android:prod
    ```

## Additional Notes

- **Local Modifications**: The `app_config.properties` file is intended for local modifications only. **DO NOT COMMIT** this file unless you are absolutely sure of the changes.
- **No Additional Configuration**: Connectivity-Free Mode does not require further configuration beyond setting the `LAUNCH_MODE` to `0` or `2`.

For more information, refer to the [main README](./README.md).

# How to refresh Snap Store credentials

The Snap Store credentials used by GitHub Actions to publish new releases expire periodically. When they expire, the CI publish step will fail. Follow these steps to generate fresh credentials and update the GitHub Actions secret.

1. Run `snapcraft export-login --snaps superproductivity -`
2. Copy the output value to `SNAPCRAFT_STORE_CREDENTIALS` in GitHub Actions settings (Settings > Secrets and variables > Actions).

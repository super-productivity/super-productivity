# How to release a new version of the Android app

1. `npm version patch` (or `minor`/`major` as appropriate)
2. `npm run dist:android:prod`
3. Go to Android Studio
4. Go to Build > Generate Signed Bundle / APK
5. Select keystore (`sup.jks`)
6. Choose `playRelease`
7. Select APK
8. Select `playRelease`
9. Locate files after build
10. Go to [Google Play Console](https://play.google.com/console/u/0/developers/?pli=1) and log in
11. Go to Release > Production and click "Create new release"
12. Upload APK from `$project/app/play/release/release/app-play-release.apk`
13. Add release notes and submit for review

---

<details>
<summary>Deprecated: OLD workflow (no longer used)</summary>

1. Go to Android Studio
2. Update `app/build.gradle` `versionCode` and `versionName`
   (To trigger F-Droid) Add `fastlane/metadata/android/<locale>/changelogs/<versionCode>.txt`
3. `git commit`
4. `git tag` (to trigger F-Droid), e.g.: `git tag -a "v21.0" -m "Release 21"`
5. Continue from step 4 of the current workflow above

</details>

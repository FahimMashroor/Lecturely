# Lecturely for Android

This folder turns Lecturely into an Android app file (`Lecturely.apk`).

- `web/` - the starting page of the app. It shows the same screen as the website.
- `app/` - the small Android part: it shows the screens, asks for the microphone,
  saves Word/text files, prints to PDF and keeps the screen on while recording.
- `build-apk.sh` - makes the APK. The comments at the top list what it needs.

## The signing key

Android only lets a new version replace an old one if both were signed with the
same key file (`lecturely.keystore`). Keep that file and its password somewhere
safe and never share them. If the key is lost, people must uninstall the app
before they can install a newer one.

## "This phone only" or with a server

Built without `LECTURELY_SERVER`, the app writes lectures on the phone itself
(after a one-time download of the transcription pack). Built with
`LECTURELY_SERVER=https://...`, it uses that server for the more accurate
online transcription and falls back to the phone when there is no internet.

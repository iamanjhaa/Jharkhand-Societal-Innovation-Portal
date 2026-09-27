# Sahayak Emergency Android companion

This is the explicit-consent Android companion boundary for the existing Express/MongoDB Sahayak backend.

It declares the Android microphone foreground-service permissions and starts the service only after the user grants microphone, location, and notification permissions. The service uses `foregroundServiceType="microphone"` and shows the persistent `Sahayak Emergency Mode Active` notification.

The repository does **not** include a wake-word model or provider credential. The service therefore intentionally does not capture audio and does not contain a fake `"Sahayak"` detector. A maintained offline detector (for example, a project-approved Porcupine/Vosk integration with its model and licensing configured) must be selected and tested on the OnePlus 11R before wiring `onStartCommand` to the existing `POST /api/emergency/request` API. Until then, this module is a safe lifecycle/permission boundary, not a claim of end-to-end voice operation.

Build from this directory with:

```text
gradlew.bat assembleDebug
```

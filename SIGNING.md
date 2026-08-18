# Android release signing

One-time keystore setup for `npm run android:apk` release builds.

## 1. Create a keystore

```bash
keytool -genkeypair \
  -keystore gambitlab-release.keystore \
  -alias gambitlab \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep this file **out of git** (`*.keystore` / `*.jks` are already ignored) and
back it up — losing it means you can never update the installed app.

## 2. Point Gradle at it

Create `android/keystore.properties` (also never committed):

```properties
storeFile=/absolute/path/to/gambitlab-release.keystore
storePassword=YOUR_STORE_PASSWORD
keyAlias=gambitlab
keyPassword=YOUR_KEY_PASSWORD
```

Then add to `android/app/build.gradle` inside the `android { }` block:

```groovy
def keystoreProps = new Properties()
def keystoreFile = rootProject.file("keystore.properties")
if (keystoreFile.exists()) {
    keystoreProps.load(new FileInputStream(keystoreFile))
}

signingConfigs {
    release {
        if (keystoreFile.exists()) {
            storeFile file(keystoreProps['storeFile'])
            storePassword keystoreProps['storePassword']
            keyAlias keystoreProps['keyAlias']
            keyPassword keystoreProps['keyPassword']
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        // ...existing config
    }
}
```

## 3. Build

```bash
npm run android:apk
# -> android/app/build/outputs/apk/release/app-release.apk
```

## Notes

- The shell app loads the production site (`server.url` in
  `capacitor.config.ts`), so app updates ship with every web deploy —
  you only rebuild the APK when Capacitor plugins or the native shell change.
- Set `GAMBITLAB_URL=https://your-domain` when building if the production
  domain differs from the default.

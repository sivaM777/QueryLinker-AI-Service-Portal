# Mobile App (Module)

This folder contains the mobile app module for the same product.

## Configure API URL

Set the API base URL (required for physical devices):

- Windows PowerShell:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.2:3000/api/v1"
```

If testing from a phone, ensure port 3000 is reachable on your PC (Windows firewall inbound rule).

## Run

Install deps inside this folder, then:

- `npm run start`

The backend stack should be running via Docker Compose.

## Build an installable Android APK (EAS)

This produces a real APK you can install on any Android device (internal distribution).

Prerequisites:

- An Expo account (free)
- EAS CLI installed on your machine

Commands:

- Install EAS CLI:

```powershell
npm i -g eas-cli
```

- Login:

```powershell
eas login
```

- Build APK (cloud build):

```powershell
eas build -p android --profile android-apk
```

Then download the APK from the EAS build URL and install it on your phone.

Android install notes:

- Enable "Install unknown apps" on the device (for the app you use to open the APK file)
- For the API URL, ensure the phone can reach your backend via your PC LAN IP (not localhost)

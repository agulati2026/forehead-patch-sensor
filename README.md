# Forehead Patch Sensor BLE Web App

## Description

Web app that connects to an Arduino-based microcontroller via **Bluetooth Low Energy (BLE)** and streams **real-time temperature** data in the browser.

## Features

- Bluetooth connection to Arduino device (Web Bluetooth)
- Real-time temperature streaming over **GATT notifications** (not polling)
- Stable connection handling with **auto-reconnect** and backoff (no `requestDevice` spam)
- Live UI: temperature, status indicator, optional chart, debug log
- **Auto-discovery** of NOTIFY/INDICATE characteristics when the firmware UUID differs

## Setup instructions (for teammates)

### 1. Clone the repo

```bash
git clone <REPO_URL>
```

Replace `<REPO_URL>` with your team’s GitHub HTTPS or SSH URL (for example `https://github.com/your-org/forehead_patch_sensorv3.git`).

### 2. Navigate into the project

```bash
cd forehead_patch_sensorv3
```

Use the **same folder name** as your repository on GitHub if it differs.

### 3. Install dependencies

This project is **static HTML + JavaScript** (no `package.json`, no `requirements.txt`). You do **not** run `npm install` or `pip install`.

You only need **one** of the following on your machine:

- **Node.js** (includes `npx`), **or**
- **Python 3** (for the built-in HTTP server)

### 4. Run the app

Web Bluetooth requires a **secure context**: **HTTPS** or **`http://localhost`**.

**Option A — Node (`serve`) — recommended**

```bash
npx --yes serve -l 3000 .
```

**Option B — Python**

```bash
python3 -m http.server 3000
```

Then open **Chrome** (or Edge) at: [http://localhost:3000](http://localhost:3000)

### 5. Connect to the device

1. Open the web app in **Google Chrome** (Web Bluetooth is required; Chrome is the supported browser for this project).
2. Click **Connect to Device**.
3. Select your Arduino BLE peripheral in the system picker.
4. Temperature should start streaming. If the default characteristic UUID does not exist on the board, leave the **Characteristic UUID** field blank (under “Service & characteristic UUIDs”) so the app **auto-picks** the first NOTIFY/INDICATE characteristic.

## Requirements

- **Google Chrome** (desktop; Web Bluetooth)
- **Bluetooth** enabled on the laptop
- Arduino BLE device powered on and advertising the expected GATT service

## Notes

- Web Bluetooth requires **HTTPS** or **localhost** — do not open the HTML file as `file://` and expect BLE to work.
- Works best on **macOS / Windows** with **Chrome**.
- **Safari** has limited Web Bluetooth support; use Chrome for development and demos.

---

## Project layout

| Path | Role |
|------|------|
| `index.html` | UI |
| `js/ble-temperature.js` | BLE client (connection, NOTIFY, reconnect) |
| `js/app.js` | UI wiring and chart |

## BLE UUIDs (firmware)

Default **service** UUID: `12345678-1234-1234-1234-1234567890ab`  
You can override service/characteristic UUIDs in the UI; leave characteristic empty for auto-discovery.

## Troubleshooting (connection drops)

- Confirm the firmware exposes **NOTIFY** (or INDICATE) on the temperature characteristic.
- Avoid blocking the Arduino `loop()` for long periods; check connection interval / supervision timeout in your BLE stack.
- Ensure no other phone app or tab is connected to the same peripheral.
- In Chrome, `chrome://bluetooth-internals` can help inspect the link.

## License

Use and modify freely for your project.

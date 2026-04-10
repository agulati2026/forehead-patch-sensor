# Forehead Patch Sensor BLE Web App

## Description

Web app that connects to an Arduino-based microcontroller via **Bluetooth Low Energy (BLE)** and streams **real-time temperature** data in the browser.

## Features

- Bluetooth connection to Arduino device (Web Bluetooth)
- Real-time temperature streaming over **GATT notifications** (not polling)
- Stable connection handling with **auto-reconnect** and backoff (no `requestDevice` spam)
- Live UI: temperature, status, interval sampling, stream on/off (BLE stays connected), °C/°F display
- **IndexedDB session library**: named sessions, timestamped readings (stored in °C)
- **Auto-discovery** of NOTIFY/INDICATE characteristics when the firmware UUID differs

## Setup instructions (for teammates)

### 1. Clone the repo

```bash
git clone https://github.com/agulati2026/forehead-patch-sensor.git
```

SSH (if you use keys): `git clone git@github.com:agulati2026/forehead-patch-sensor.git`

### 2. Navigate into the project

```bash
cd forehead-patch-sensor
```

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
4. Temperature should stream over NOTIFY. The UI **samples the latest buffered value** on your chosen interval (**0.5–86400 seconds**, any decimal) for display, chart, and saving — this does **not** reconnect BLE.
5. Create a **session** to save readings; with stream **ON** and no session, you’ll see a reminder that nothing is persisted.
6. Turn **Stream OFF** to pause display/saving while keeping the GATT link up.

## Requirements

- **Google Chrome** (desktop; Web Bluetooth)
- **Bluetooth** enabled on the laptop
- Arduino BLE device powered on and advertising the expected GATT service

## Notes

- Web Bluetooth requires **HTTPS** or **localhost** — do not open the HTML file as `file://` and expect BLE to work.
- Works best on **macOS / Windows** with **Chrome**.
- **Safari** has limited Web Bluetooth support; use Chrome for development and demos.

---

## Architecture (modules)

| Path | Role |
|------|------|
| `js/bleManager.js` | Web Bluetooth: connect, NOTIFY, reconnect (no polling) |
| `js/dataManager.js` | IndexedDB: sessions + readings (°C only on disk) |
| `js/uiManager.js` | DOM: controls, chart, session list & table |
| `js/app.js` | Orchestration: BLE buffer → interval tick → UI + save |
| `index.html` | Markup & styles |

**Data flow:** each notification updates an in-memory latest °C value. A `setInterval` (user interval) reads that buffer and, if stream is ON, updates the display/chart and optionally appends a row to the active session.

## Saved data shape

Sessions and readings are stored in IndexedDB (`forehead_ble_sessions_v1`). Logical export shape:

```json
{
  "sessionId": "uuid",
  "name": "Morning Monitoring",
  "createdAt": 1712345678900,
  "readings": [{ "tempC": 37.2, "timestamp": 1712345680000 }]
}
```

On disk, readings live in a separate object store keyed by auto-increment `id` with index `sessionId` for scalability.

## Where to change things later

- **BLE UUIDs / stability:** `js/bleManager.js` (`configure`, `TemperatureBleClient`)
- **Storage schema / quotas:** `js/dataManager.js` (`DB_NAME`, stores, `addReading`)
- **UI layout / new controls:** `index.html` + `js/uiManager.js`
- **Sampling rules (when to save, intervals):** `js/app.js` (`onIntervalTick`, `restartIntervalTimer`)

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

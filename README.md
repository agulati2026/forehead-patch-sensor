# BLE temperature web app

Plain **HTML + ES modules**: a reusable BLE module (`js/ble-temperature.js`) and a thin UI (`js/app.js`) that does not call the Web Bluetooth API directly.

## Why connections were dropping (typical causes)

This project avoids the usual Web Bluetooth foot-guns:

| Problem | What this code does |
|--------|----------------------|
| Calling `requestDevice()` on every reconnect | **Only** the first connection uses the picker; reconnect uses `device.gatt.connect()` on the same `BluetoothDevice`. |
| Overlapping `connect()` / race conditions | A **single serialized lock** (`_withLock`) so only one GATT operation chain runs at a time. |
| Reconnect storm | **Exponential backoff + jitter**; one scheduled timer at a time. |
| Polling instead of NOTIFY | Uses `startNotifications()` and `characteristicvaluechanged` only. |
| Duplicate listeners | Tears down the previous characteristic listener before attaching a new session. |

Arduino/firmware side still matters: connection interval, supervision timeout, MTU, and not resetting the radio every few seconds. Use the debug checklist below if disconnects persist.

## How to run

Web Bluetooth needs a **secure context**: **HTTPS** or **`http://localhost`**.

### Option A — static server (recommended)

From the project root:

```bash
cd /Users/armaangulati/forehead_path_sensorv3
npx --yes serve -l 3000 .
```

Open **Chrome** or **Edge**: [http://localhost:3000](http://localhost:3000)

### Option B — Python

```bash
cd /Users/armaangulati/forehead_path_sensorv3
python3 -m http.server 3000
```

Open [http://localhost:3000](http://localhost:3000)

### Browsers

- **Chrome / Edge (desktop)**: supported on macOS, Windows, ChromeOS, Android (with system BLE).
- **Safari (iOS/macOS)**: Web Bluetooth support is limited; prefer Chrome on desktop for this app.

## Project layout

| File | Role |
|------|------|
| `index.html` | UI layout and styles |
| `js/ble-temperature.js` | BLE only: device, GATT, NOTIFY, reconnect backoff |
| `js/app.js` | DOM, chart, status text, error banner |

## BLE UUIDs (must match firmware)

- **Service** (default): `12345678-1234-1234-1234-1234567890ab` — editable under “Service & characteristic UUIDs”.
- **Characteristic**: If the field is **left blank**, the app **scans the service** and uses the **first characteristic that supports NOTIFY or INDICATE**. Use this when your sketch uses a different UUID than the placeholder (this fixes “No Characteristics matching UUID …” when the service is correct but the char UUID differs).
- Optionally set a specific characteristic UUID (e.g. `abcd1234-5678-1234-5678-abcdef123456`) if you want an exact match.

Payload parsing tries, in order:

1. 4-byte **float32** (little-endian, then big-endian if LE looks invalid)
2. 2-byte **int16** (LE/BE) interpreted as **hundredths of a degree** (e.g. `2365` → 23.65 °C), if the result is in a plausible range
3. **UTF-8** string parsed with `parseFloat` (comma as decimal supported)

## Debug checklist (connection drops every few seconds)

1. **Confirm NOTIFY on the characteristic**  
   Firmware must enable indications/notifications on that handle and send updates at a sane rate (e.g. 1–10 Hz), not thousands/sec.

2. **Connection parameters**  
   If the sketch forces very aggressive or invalid connection intervals, some central stacks disconnect. Check Arduino BLE library docs for `setConnectionInterval` / peer parameters.

3. **Watchdog / `loop()` blocking**  
   Long blocking code in firmware can stall the BLE stack and cause supervision timeout disconnects.

4. **Power / USB**  
   Weak USB or brownouts can reset the board; watch serial logs for resets.

5. **One central at a time**  
   Close other apps or tabs that might connect to the same device (phone apps, other browsers).

6. **Chrome internals**  
   Open `chrome://bluetooth-internals` and inspect the device: link quality, disconnect reasons (when available).

7. **This app’s logs**  
   Console: device found → GATT connected → service/characteristic → notifications started → `notification received`.  
   If you see `gattserverdisconnected` immediately after connect, the issue is usually firmware, RF, or OS Bluetooth stack—not the picker.

8. **Do not spam reconnect**  
   If you test custom code, ensure you are not calling `requestDevice()` in a loop or on a timer.

## License

Use and modify freely for your project.

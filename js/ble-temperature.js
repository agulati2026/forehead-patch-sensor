/**
 * BLE temperature client — Web Bluetooth, NOTIFY-only, single device, stable reconnect.
 * Does NOT call requestDevice() except when no device is chosen yet.
 */

export const DEFAULT_SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
/** Tried first; if missing, first NOTIFY/INDICATE char in the service is used. */
export const DEFAULT_CHARACTERISTIC_UUID = 'abcd1234-5678-1234-5678-abcdef123456';

/** @typedef {'idle'|'connecting'|'connected'|'disconnected'|'reconnecting'} BleStatus */

/**
 * @param {string} s
 * @returns {string}
 */
function normalizeUuid(s) {
  return String(s).trim().toLowerCase();
}

/**
 * Prefer exact UUID; if missing or not NOTIFY-capable, pick first NOTIFY/INDICATE in service.
 * @param {BluetoothRemoteGATTService} service
 * @param {string} preferredUuid empty → skip exact match, scan only
 * @param {(payload: unknown) => void} [onDebug]
 */
async function resolveNotifyCharacteristic(service, preferredUuid, onDebug) {
  if (preferredUuid) {
    try {
      const ch = await service.getCharacteristic(preferredUuid);
      const ok = ch.properties.notify || ch.properties.indicate;
      if (ok) {
        console.log('[BLE] characteristic found (exact UUID)', preferredUuid);
        return ch;
      }
      console.warn(
        '[BLE] characteristic exists but is not NOTIFY/INDICATE; scanning for a usable one…',
        preferredUuid
      );
    } catch (e) {
      const name = e && typeof e === 'object' && 'name' in e ? e.name : '';
      if (name !== 'NotFoundError') throw e;
      console.warn('[BLE] exact characteristic UUID not on device; scanning service…', preferredUuid);
    }
  } else {
    console.log('[BLE] no preferred characteristic UUID — scanning service for NOTIFY/INDICATE');
  }

  const all = await service.getCharacteristics();
  const summary = all.map((c) => ({
    uuid: c.uuid,
    notify: c.properties.notify,
    indicate: c.properties.indicate,
    read: c.properties.read,
    write: c.properties.write,
  }));
  console.log('[BLE] characteristics in service:', summary);
  onDebug?.(summary);

  const preferredNorm = preferredUuid ? normalizeUuid(preferredUuid) : '';
  const candidates = all.filter((c) => c.properties.notify || c.properties.indicate);
  if (candidates.length === 0) {
    const found = summary.map((x) => x.uuid).join(', ') || '(none)';
    throw new Error(
      `No NOTIFY or INDICATE characteristic in this service. ` +
        `Check your Arduino sketch. Discovered: ${found}`
    );
  }

  let chosen = candidates[0];
  if (preferredNorm) {
    const match = candidates.find((c) => normalizeUuid(c.uuid) === preferredNorm);
    if (match) chosen = match;
  }

  console.log('[BLE] using characteristic (auto-selected)', chosen.uuid);
  return chosen;
}

export class TemperatureBleClient {
  /**
   * @param {object} [options]
   * @param {(celsius: number) => void} [options.onTemperature]
   * @param {(sample: { celsius: number | null; rawHex: string }) => void} [options.onSample]
   * @param {(status: BleStatus, detail?: string) => void} [options.onStatus]
   * @param {(err: Error) => void} [options.onError]
   * @param {(label: string, payload: unknown) => void} [options.onDebug]
   * @param {(uuid: string) => void} [options.onCharacteristicResolved]
   * @param {string} [options.serviceUuid]
   * @param {string | null} [options.characteristicUuid] null/omit = default; "" = auto only
   */
  constructor(options = {}) {
    this._onTemperature = options.onTemperature;
    this._onSample = options.onSample;
    this._onStatus = options.onStatus;
    this._onError = options.onError;
    this._onDebug = options.onDebug;
    this._onCharacteristicResolved = options.onCharacteristicResolved;

    /** @type {string} */
    this._serviceUuid = normalizeUuid(options.serviceUuid || DEFAULT_SERVICE_UUID);
    /** Preferred char UUID; empty = scan service for first NOTIFY/INDICATE (recommended if firmware UUID differs). */
    if (options.characteristicUuid !== undefined) {
      const v = options.characteristicUuid;
      this._preferredCharUuid = v == null || String(v).trim() === '' ? '' : normalizeUuid(v);
    } else {
      this._preferredCharUuid = '';
    }

    /** @type {BluetoothDevice | null} */
    this._device = null;
    /** @type {BluetoothRemoteGATTCharacteristic | null} */
    this._characteristic = null;

    this._operationLock = Promise.resolve();
    this._intentionalDisconnect = false;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._maxBackoffMs = 60000;
    this._baseBackoffMs = 1000;

    this._onValueChanged = this._onValueChanged.bind(this);
    this._onGattDisconnected = this._onGattDisconnected.bind(this);
  }

  /**
   * @param {{ serviceUuid?: string; characteristicUuid?: string | null }} cfg
   * characteristicUuid `null` or "" → auto-pick first NOTIFY/INDICATE in service (no exact try).
   */
  configure(cfg) {
    if (cfg.serviceUuid) this._serviceUuid = normalizeUuid(cfg.serviceUuid);
    if (cfg.characteristicUuid !== undefined) {
      const v = cfg.characteristicUuid;
      this._preferredCharUuid = v == null || String(v).trim() === '' ? '' : normalizeUuid(v);
    }
  }

  /** @returns {boolean} */
  get hasDevice() {
    return this._device !== null;
  }

  /** @returns {boolean} */
  get isGattConnected() {
    return !!(this._device && this._device.gatt && this._device.gatt.connected);
  }

  /**
   * First-time: opens picker via requestDevice(). Later: only gatt.connect().
   * Serialized so two clicks cannot start parallel connections.
   */
  async connect() {
    return this._withLock(async () => {
      this._intentionalDisconnect = false;
      this._emitStatus('connecting');

      try {
        if (!this._device) {
          if (!navigator.bluetooth) {
            throw new Error('Web Bluetooth is not available. Use Chrome/Edge over HTTPS or localhost.');
          }
          this._device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [this._serviceUuid] }],
            optionalServices: [this._serviceUuid],
          });
          console.log('[BLE] device found', this._device.name || '(no name)', this._device.id);
          this._device.addEventListener('gattserverdisconnected', this._onGattDisconnected);
        }

        await this._setupGattSession();
        this._reconnectAttempt = 0;
        this._emitStatus('connected');
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('[BLE] connect error', err);
        this._onError?.(err);
        this._emitStatus('disconnected', err.message);
        throw err;
      }
    });
  }

  /**
   * Disconnect and stop auto-reconnect. Device reference is cleared so next connect uses picker again.
   */
  async disconnect() {
    return this._withLock(async () => {
      this._intentionalDisconnect = true;
      this._clearReconnectTimer();
      this._teardownCharacteristic();

      if (this._device && this._device.gatt.connected) {
        try {
          this._device.gatt.disconnect();
        } catch (e) {
          console.warn('[BLE] disconnect()', e);
        }
      }

      this._device?.removeEventListener('gattserverdisconnected', this._onGattDisconnected);
      this._device = null;
      this._emitStatus('disconnected');
      console.log('[BLE] intentional disconnect complete');
    });
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer != null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /**
   * Serialize connect/disconnect/reconnect to prevent overlapping GATT operations.
   */
  _withLock(fn) {
    const next = this._operationLock.then(fn, fn);
    this._operationLock = next.catch(() => {});
    return next;
  }

  async _setupGattSession() {
    if (!this._device) return;

    const server = await this._device.gatt.connect();
    console.log('[BLE] GATT connected');

    const service = await server.getPrimaryService(this._serviceUuid);
    console.log('[BLE] service found', this._serviceUuid);

    const characteristic = await resolveNotifyCharacteristic(
      service,
      this._preferredCharUuid,
      (info) => this._onDebug?.('gatt-discovery', info)
    );
    console.log('[BLE] characteristic in use', characteristic.uuid);
    this._onCharacteristicResolved?.(characteristic.uuid);

    this._teardownCharacteristic();
    this._characteristic = characteristic;
    characteristic.addEventListener('characteristicvaluechanged', this._onValueChanged);
    await characteristic.startNotifications();
    console.log('[BLE] notifications started (NOTIFY)');
  }

  _teardownCharacteristic() {
    const ch = this._characteristic;
    if (!ch) return;
    ch.removeEventListener('characteristicvaluechanged', this._onValueChanged);
    this._characteristic = null;
    ch.stopNotifications().catch(() => {});
  }

  _onValueChanged(event) {
    const value = event.target.value;
    if (!value) return;

    const raw = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    const rawHex = bufferToHex(raw);
    const parsed = parseTemperatureValue(raw);
    console.log('[BLE] notification received', { rawBytes: rawHex, parsed });

    this._onDebug?.('notification', { rawBytes: rawHex, parsed });
    this._onSample?.({ celsius: parsed, rawHex });
    if (parsed != null && !Number.isNaN(parsed)) {
      this._onTemperature?.(parsed);
    }
  }

  _onGattDisconnected() {
    console.log('[BLE] gattserverdisconnected');
    this._teardownCharacteristic();
    this._emitStatus('disconnected');

    if (this._intentionalDisconnect || !this._device) return;

    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    this._emitStatus('reconnecting');

    const exp = Math.min(
      this._maxBackoffMs,
      this._baseBackoffMs * Math.pow(2, this._reconnectAttempt)
    );
    const jitter = Math.floor(Math.random() * 250);
    const delay = exp + jitter;

    console.log(
      `[BLE] reconnect scheduled in ${delay}ms (attempt ${this._reconnectAttempt + 1})`
    );

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._attemptReconnect();
    }, delay);
    this._reconnectAttempt += 1;
  }

  _attemptReconnect() {
    if (this._intentionalDisconnect || !this._device) return;

    this._withLock(async () => {
      if (this._intentionalDisconnect || !this._device) return;
      try {
        this._emitStatus('reconnecting');
        await this._setupGattSession();
        this._reconnectAttempt = 0;
        this._emitStatus('connected');
        console.log('[BLE] reconnected (no requestDevice)');
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('[BLE] reconnect failed', err);
        this._onError?.(err);
        if (!this._intentionalDisconnect && this._device) {
          this._scheduleReconnect();
        }
      }
    });
  }

  /** @param {BleStatus} status */
  _emitStatus(status, detail) {
    this._onStatus?.(status, detail);
  }
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {number | null}
 */
export function parseTemperatureValue(buffer) {
  const u8 = new Uint8Array(buffer);

  if (u8.length === 4) {
    const dv = new DataView(buffer);
    const le = dv.getFloat32(0, true);
    const be = dv.getFloat32(0, false);
    if (Number.isFinite(le) && Math.abs(le) < 1000) return le;
    if (Number.isFinite(be) && Math.abs(be) < 1000) return be;
  }

  if (u8.length === 2) {
    const dv = new DataView(buffer);
    const le = dv.getInt16(0, true);
    const be = dv.getInt16(0, false);
    for (const v of [le, be]) {
      const centi = v / 100;
      if (Number.isFinite(centi) && centi >= -80 && centi <= 200) return centi;
    }
    for (const v of [le, be]) {
      if (v >= -100 && v <= 200) return v;
    }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(u8).trim();
    if (text.length === 0) return null;
    const n = parseFloat(text.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/**
 * Orchestration: BLE buffer → interval sampling → UI + IndexedDB (Celsius only in storage).
 */

import {
  TemperatureBleClient,
  DEFAULT_SERVICE_UUID,
  DEFAULT_CHARACTERISTIC_UUID,
} from './bleManager.js';
import * as data from './dataManager.js';
import { createUiManager } from './uiManager.js';

const LS_SERVICE = 'ble_temp_service_uuid';
const LS_CHAR = 'ble_temp_char_uuid';
const LS_INTERVAL = 'ble_temp_interval_sec';

const ui = createUiManager();

/** Latest decoded °C from BLE NOTIFY (updated on every notification; not throttled). */
let latestC = null;
let lastRawHex = '';

let activeSessionId = null;
let activeSessionName = null;

/** @type {ReturnType<typeof setInterval> | null} */
let sampleTimer = null;

function loadSavedUuids() {
  const s = localStorage.getItem(LS_SERVICE);
  const c = localStorage.getItem(LS_CHAR);
  ui.els.uuidService.value = s || DEFAULT_SERVICE_UUID;
  ui.els.uuidChar.value = c !== null ? c : '';
}

function saveUuids() {
  localStorage.setItem(LS_SERVICE, ui.els.uuidService.value.trim() || DEFAULT_SERVICE_UUID);
  localStorage.setItem(LS_CHAR, ui.els.uuidChar.value.trim());
}

function loadSavedInterval() {
  const v = localStorage.getItem(LS_INTERVAL);
  if (v != null && v !== '') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) ui.setIntervalSecondsValue(n);
  }
  ui.syncIntervalInputFromEffective();
}

function saveInterval() {
  localStorage.setItem(LS_INTERVAL, String(ui.getIntervalSecondsEffective()));
}

function applyConfigToClient() {
  const serviceUuid = ui.els.uuidService.value.trim() || DEFAULT_SERVICE_UUID;
  const charRaw = ui.els.uuidChar.value.trim();
  ble.configure({
    serviceUuid,
    characteristicUuid: charRaw === '' ? '' : charRaw,
  });
}

async function refreshSessionList() {
  try {
    const sessions = await data.listSessions();
    ui.renderSessionList(sessions, activeSessionId, onSelectSession);
  } catch (e) {
    ui.showError(e instanceof Error ? e.message : String(e));
  }
}

async function refreshActiveReadingsTable() {
  if (!activeSessionId) {
    ui.renderSessionReadings([], '');
    return;
  }
  const readings = await data.getReadings(activeSessionId);
  const session = await data.getSession(activeSessionId);
  ui.renderSessionReadings(readings, session?.name || '');
}

async function onSelectSession(id) {
  activeSessionId = id;
  const session = await data.getSession(id);
  activeSessionName = session?.name || null;
  ui.setActiveSessionLabel(activeSessionName);
  ui.setInfoMessage('', false);
  await refreshActiveReadingsTable();
  await refreshSessionList();
}

async function onCreateSession(name) {
  try {
    const s = await data.createSession(name);
    ui.els.sessionNameInput.value = '';
    activeSessionId = s.id;
    activeSessionName = s.name;
    ui.setActiveSessionLabel(activeSessionName);
    ui.setInfoMessage('', false);
    await refreshActiveReadingsTable();
    await refreshSessionList();
    ui.clearError();
  } catch (e) {
    ui.showError(e instanceof Error ? e.message : String(e));
  }
}

function onIntervalTick() {
  if (!ui.isStreamOn()) {
    ui.setTempSubline('Stream paused — BLE stays connected; resume to sample display & saving.');
    return;
  }

  const c = latestC;

  if (c != null && Number.isFinite(c)) {
    ui.setTemperatureDisplay(c, ui.isFahrenheit());
    ui.setTempSubline(
      `Every ${ui.getIntervalSecondsEffective()}s · BLE buffer → display & save`
    );
    ui.pushChartPoint(c);

    if (activeSessionId) {
      ui.setInfoMessage('', false);
      data
        .addReading(activeSessionId, c, Date.now())
        .then(() => refreshActiveReadingsTable())
        .catch((e) => ui.showError(e instanceof Error ? e.message : String(e)));
    } else {
      ui.setInfoMessage('Turn on “Recording & saved sessions” below and pick a session to save data.', true);
    }
  } else if (lastRawHex) {
    ui.setTemperatureDisplay(null, ui.isFahrenheit());
    ui.setTempSubline(`Waiting for valid decode — raw: ${lastRawHex}`);
  } else {
    ui.setTempSubline('Waiting for BLE data…');
  }
}

function restartIntervalTimer() {
  if (sampleTimer != null) clearInterval(sampleTimer);
  sampleTimer = setInterval(onIntervalTick, ui.getIntervalMs());
}

const ble = new TemperatureBleClient({
  onSample: ({ celsius, rawHex }) => {
    lastRawHex = rawHex;
    if (celsius != null && Number.isFinite(celsius)) {
      latestC = celsius;
    } else {
      latestC = null;
    }
  },
  onStatus: (status) => {
    ui.setConnectionStatus(status);
    if (status === 'connected') ui.clearError();
    if (status === 'disconnected' || status === 'idle') {
      latestC = null;
      ui.hideCharacteristicLine();
    }
  },
  onError: (err) => {
    ui.showError(err.message || String(err));
  },
  onDebug: (label, payload) => {
    ui.appendRawLog(`${label}: ${JSON.stringify(payload)}`);
  },
  onCharacteristicResolved: (uuid) => {
    ui.setCharacteristicLine(uuid);
  },
});

ui.bind({
  onConnect: async () => {
    ui.clearError();
    saveUuids();
    applyConfigToClient();
    ui.appendRawLog('UI: Connect clicked');
    try {
      await ble.connect();
    } catch {
      /* onError */
    }
  },
  onDisconnect: async () => {
    ui.clearError();
    ui.appendRawLog('UI: Disconnect clicked');
    try {
      await ble.disconnect();
    } catch (e) {
      ui.showError(e instanceof Error ? e.message : String(e));
    }
  },
  onIntervalChange: () => {
    restartIntervalTimer();
    saveInterval();
    ui.appendRawLog(`Sample interval: ${ui.getIntervalSecondsEffective()} s`);
  },
  onStreamToggle: () => {
    if (ui.isStreamOn()) {
      ui.setTempSubline(`Every ${ui.getIntervalSecondsEffective()}s · BLE buffer → display & save`);
    } else {
      onIntervalTick();
    }
  },
  onUnitToggle: () => {
    const next = !ui.isFahrenheit();
    ui.setUnitToggleFahrenheit(next);
    if (latestC != null && Number.isFinite(latestC)) {
      ui.setTemperatureDisplay(latestC, next);
    }
    refreshActiveReadingsTable();
  },
  onCreateSession: (name) => onCreateSession(name),
  onUuidChange: saveUuids,
});

loadSavedUuids();
loadSavedInterval();
ui.setConnectionStatus('idle');
ui.setUnitToggleFahrenheit(false);
ui.setActiveSessionLabel(null);
restartIntervalTimer();

refreshSessionList().then(() => {
  ui.appendRawLog(
    `Ready. Service ${DEFAULT_SERVICE_UUID}; char blank = auto NOTIFY. Optional: ${DEFAULT_CHARACTERISTIC_UUID}`
  );
});

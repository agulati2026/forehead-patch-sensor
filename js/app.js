/**
 * UI layer — wires DOM to TemperatureBleClient (no BLE API calls here).
 */

import {
  TemperatureBleClient,
  DEFAULT_SERVICE_UUID,
  DEFAULT_CHARACTERISTIC_UUID,
} from './ble-temperature.js';

const LS_SERVICE = 'ble_temp_service_uuid';
const LS_CHAR = 'ble_temp_char_uuid';

const MAX_CHART_POINTS = 30;

const els = {
  connectBtn: document.getElementById('btn-connect'),
  disconnectBtn: document.getElementById('btn-disconnect'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  tempValue: document.getElementById('temp-value'),
  tempUnit: document.getElementById('temp-unit'),
  tempSub: document.getElementById('temp-sub'),
  errorBanner: document.getElementById('error-banner'),
  rawLog: document.getElementById('raw-log'),
  chart: document.getElementById('temp-chart'),
  uuidService: document.getElementById('uuid-service'),
  uuidChar: document.getElementById('uuid-char'),
  activeChar: document.getElementById('active-char'),
};

/** @type {number[]} */
const history = [];

function loadSavedUuids() {
  const s = localStorage.getItem(LS_SERVICE);
  const c = localStorage.getItem(LS_CHAR);
  els.uuidService.value = s || DEFAULT_SERVICE_UUID;
  els.uuidChar.value = c !== null ? c : '';
}

function saveUuids() {
  localStorage.setItem(LS_SERVICE, els.uuidService.value.trim() || DEFAULT_SERVICE_UUID);
  localStorage.setItem(LS_CHAR, els.uuidChar.value.trim());
}

function applyConfigToClient() {
  const serviceUuid = els.uuidService.value.trim() || DEFAULT_SERVICE_UUID;
  const charRaw = els.uuidChar.value.trim();
  client.configure({
    serviceUuid,
    characteristicUuid: charRaw === '' ? '' : charRaw,
  });
}

const client = new TemperatureBleClient({
  onSample: ({ celsius, rawHex }) => {
    if (celsius != null && Number.isFinite(celsius)) {
      els.tempValue.textContent = formatTemp(celsius);
      els.tempSub.textContent = 'Streaming · decoded value';
      els.tempUnit.style.opacity = '1';
      pushHistory(celsius);
      drawChart();
    } else {
      els.tempValue.textContent = '—';
      els.tempSub.textContent = `Could not decode — raw bytes: ${rawHex}`;
    }
  },
  onStatus: (status) => {
    setUiForStatus(status);
    if (status === 'connected') {
      clearError();
    }
  },
  onError: (err) => {
    showError(err.message || String(err));
  },
  onDebug: (label, payload) => {
    appendRawLog(`${label}: ${JSON.stringify(payload)}`);
  },
  onCharacteristicResolved: (uuid) => {
    els.activeChar.hidden = false;
    els.activeChar.textContent = `Notifications: ${uuid}`;
  },
});

function formatTemp(n) {
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

function setUiForStatus(status) {
  els.statusText.textContent = labelForStatus(status);
  els.statusDot.dataset.status = status;
  const connected = status === 'connected';
  els.connectBtn.disabled = connected || status === 'connecting' || status === 'reconnecting';
  els.disconnectBtn.disabled = !connected && status !== 'reconnecting';
  if (status === 'disconnected' || status === 'idle') {
    els.activeChar.hidden = true;
    els.activeChar.textContent = '';
  }
}

function labelForStatus(status) {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'disconnected':
      return 'Disconnected';
    default:
      return String(status);
  }
}

function showError(msg) {
  els.errorBanner.hidden = false;
  els.errorBanner.textContent = msg;
}

function clearError() {
  els.errorBanner.hidden = true;
  els.errorBanner.textContent = '';
}

function appendRawLog(line) {
  const ts = new Date().toISOString();
  const row = `[${ts}] ${line}\n`;
  els.rawLog.textContent = (els.rawLog.textContent + row).slice(-8000);
  els.rawLog.scrollTop = els.rawLog.scrollHeight;
}

function pushHistory(v) {
  history.push(v);
  while (history.length > MAX_CHART_POINTS) history.shift();
}

function drawChart() {
  const canvas = els.chart;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, w, h);

  if (history.length < 2) return;

  const min = Math.min(...history);
  const max = Math.max(...history);
  const pad = 4;
  const range = max - min || 1;

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((val, i) => {
    const x = pad + (i / (history.length - 1)) * (w - pad * 2);
    const t = (val - min) / range;
    const y = h - pad - t * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

els.connectBtn.addEventListener('click', async () => {
  clearError();
  saveUuids();
  applyConfigToClient();
  appendRawLog('UI: Connect clicked');
  try {
    await client.connect();
  } catch {
    /* onError already fired */
  }
});

els.disconnectBtn.addEventListener('click', async () => {
  clearError();
  appendRawLog('UI: Disconnect clicked');
  try {
    await client.disconnect();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});

els.uuidService.addEventListener('change', saveUuids);
els.uuidChar.addEventListener('change', saveUuids);

loadSavedUuids();
setUiForStatus('idle');

appendRawLog(
  `Defaults: service ${DEFAULT_SERVICE_UUID}; char blank = auto NOTIFY. Optional: ${DEFAULT_CHARACTERISTIC_UUID}`
);

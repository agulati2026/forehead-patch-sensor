/**
 * DOM rendering and control bindings (no BLE, no IndexedDB).
 */

const MAX_CHART_POINTS = 30;

function formatDateTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatTempC(n) {
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

function formatTempF(c) {
  if (!Number.isFinite(c)) return '—';
  const f = (c * 9) / 5 + 32;
  return f.toFixed(2);
}

/**
 * @param {HTMLElement} [root]
 */
export function createUiManager(root = document) {
  const els = {
    connectBtn: root.getElementById('btn-connect'),
    disconnectBtn: root.getElementById('btn-disconnect'),
    statusDot: root.getElementById('status-dot'),
    statusText: root.getElementById('status-text'),
    tempValue: root.getElementById('temp-value'),
    tempUnit: root.getElementById('temp-unit'),
    tempSub: root.getElementById('temp-sub'),
    errorBanner: root.getElementById('error-banner'),
    infoBanner: root.getElementById('info-banner'),
    rawLog: root.getElementById('raw-log'),
    chart: root.getElementById('temp-chart'),
    uuidService: root.getElementById('uuid-service'),
    uuidChar: root.getElementById('uuid-char'),
    activeChar: root.getElementById('active-char'),
    intervalSeconds: root.getElementById('interval-seconds'),
    streamToggle: root.getElementById('stream-toggle'),
    unitToggle: root.getElementById('unit-toggle'),
    sessionNameInput: root.getElementById('session-name-input'),
    btnNewSession: root.getElementById('btn-new-session'),
    sessionList: root.getElementById('session-list'),
    sessionViewerTitle: root.getElementById('session-viewer-title'),
    sessionTableBody: root.getElementById('session-table-body'),
    activeSessionLabel: root.getElementById('active-session-label'),
  };

  /** @type {number[]} chart samples in °C */
  const chartHistory = [];

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

  function setConnectionStatus(status) {
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

  function setCharacteristicLine(uuid) {
    els.activeChar.hidden = false;
    els.activeChar.textContent = `Notifications: ${uuid}`;
  }

  function hideCharacteristicLine() {
    els.activeChar.hidden = true;
    els.activeChar.textContent = '';
  }

  function setTemperatureDisplay(celsius, useFahrenheit) {
    if (celsius != null && Number.isFinite(celsius)) {
      if (useFahrenheit) {
        els.tempValue.textContent = formatTempF(celsius);
        els.tempUnit.textContent = '°F';
      } else {
        els.tempValue.textContent = formatTempC(celsius);
        els.tempUnit.textContent = '°C';
      }
      els.tempUnit.style.opacity = '1';
    } else {
      els.tempValue.textContent = '—';
      els.tempUnit.textContent = useFahrenheit ? '°F' : '°C';
    }
  }

  function setTempSubline(text) {
    els.tempSub.textContent = text;
  }

  function showError(msg) {
    els.errorBanner.hidden = false;
    els.errorBanner.textContent = msg;
  }

  function clearError() {
    els.errorBanner.hidden = true;
    els.errorBanner.textContent = '';
  }

  function setInfoMessage(text, visible) {
    if (!els.infoBanner) return;
    els.infoBanner.hidden = !visible;
    els.infoBanner.textContent = text || '';
  }

  function appendRawLog(line) {
    const ts = new Date().toISOString();
    const row = `[${ts}] ${line}\n`;
    els.rawLog.textContent = (els.rawLog.textContent + row).slice(-8000);
    els.rawLog.scrollTop = els.rawLog.scrollHeight;
  }

  function pushChartPoint(celsius) {
    if (!Number.isFinite(celsius)) return;
    chartHistory.push(celsius);
    while (chartHistory.length > MAX_CHART_POINTS) chartHistory.shift();
    drawChart();
  }

  function clearChart() {
    chartHistory.length = 0;
    drawChart();
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

    if (chartHistory.length < 2) return;

    const min = Math.min(...chartHistory);
    const max = Math.max(...chartHistory);
    const pad = 4;
    const range = max - min || 1;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    chartHistory.forEach((val, i) => {
      const x = pad + (i / (chartHistory.length - 1)) * (w - pad * 2);
      const t = (val - min) / range;
      const y = h - pad - t * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px system-ui';
    ctx.fillText('°C (internal)', pad, pad + 8);
  }

  /**
   * @param {import('./dataManager.js').SessionRecord[]} sessions
   * @param {string | null} activeId
   * @param {(id: string) => void} onSelect
   */
  function renderSessionList(sessions, activeId, onSelect) {
    els.sessionList.innerHTML = '';
    if (!sessions.length) {
      const li = document.createElement('li');
      li.className = 'session-empty';
      li.textContent = 'No sessions yet — create one to save readings.';
      els.sessionList.appendChild(li);
      return;
    }
    for (const s of sessions) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'session-item' + (s.id === activeId ? ' is-active' : '');
      btn.textContent = `${s.name} · ${formatDateTime(s.createdAt)}`;
      btn.addEventListener('click', () => onSelect(s.id));
      li.appendChild(btn);
      els.sessionList.appendChild(li);
    }
  }

  /**
   * @param {import('./dataManager.js').ReadingRecord[]} readings
   * @param {string} sessionName
   */
  function renderSessionReadings(readings, sessionName) {
    els.sessionViewerTitle.textContent = sessionName
      ? `Readings — ${sessionName}`
      : 'Readings';
    els.sessionTableBody.innerHTML = '';
    if (!readings.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'muted';
      td.textContent = 'No samples in this session yet.';
      tr.appendChild(td);
      els.sessionTableBody.appendChild(tr);
      return;
    }
    for (const r of readings) {
      const tr = document.createElement('tr');
      const t1 = document.createElement('td');
      t1.textContent = formatDateTime(r.timestamp);
      const t2 = document.createElement('td');
      t2.textContent = formatTempC(r.tempC);
      const t3 = document.createElement('td');
      t3.textContent = formatTempF(r.tempC);
      tr.appendChild(t1);
      tr.appendChild(t2);
      tr.appendChild(t3);
      els.sessionTableBody.appendChild(tr);
    }
  }

  function setActiveSessionLabel(nameOrNull) {
    els.activeSessionLabel.textContent = nameOrNull
      ? `Recording to: ${nameOrNull}`
      : 'No active session — readings are not saved';
  }

  const INTERVAL_MIN_S = 0.5;
  const INTERVAL_MAX_S = 86400;

  /** @returns {number} clamped seconds (for display sync) */
  function clampIntervalSeconds(raw) {
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(n)) return 5;
    return Math.min(INTERVAL_MAX_S, Math.max(INTERVAL_MIN_S, n));
  }

  function getIntervalMs() {
    const s = clampIntervalSeconds(els.intervalSeconds.value);
    return Math.round(s * 1000);
  }

  /** Writes clamped value back to the input (call after change / on load). */
  function syncIntervalInputFromEffective() {
    const s = clampIntervalSeconds(els.intervalSeconds.value);
    els.intervalSeconds.value = String(s);
  }

  function getIntervalSecondsEffective() {
    return clampIntervalSeconds(els.intervalSeconds.value);
  }

  function isStreamOn() {
    return els.streamToggle.checked;
  }

  function isFahrenheit() {
    return els.unitToggle.getAttribute('aria-pressed') === 'true';
  }

  function setUnitToggleFahrenheit(on) {
    els.unitToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    els.unitToggle.textContent = on ? '°F' : '°C';
  }

  /**
   * @param {object} h
   */
  function bind(h) {
    els.connectBtn.addEventListener('click', () => h.onConnect());
    els.disconnectBtn.addEventListener('click', () => h.onDisconnect());
    const onInterval = () => {
      syncIntervalInputFromEffective();
      h.onIntervalChange();
    };
    els.intervalSeconds.addEventListener('change', onInterval);
    els.intervalSeconds.addEventListener('blur', onInterval);
    els.intervalSeconds.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.intervalSeconds.blur();
      }
    });
    els.streamToggle.addEventListener('change', () => h.onStreamToggle());
    els.unitToggle.addEventListener('click', () => h.onUnitToggle());
    els.btnNewSession.addEventListener('click', () => h.onCreateSession(els.sessionNameInput.value));
    els.uuidService.addEventListener('change', h.onUuidChange || (() => {}));
    els.uuidChar.addEventListener('change', h.onUuidChange || (() => {}));
  }

  return {
    els,
    setConnectionStatus,
    setCharacteristicLine,
    hideCharacteristicLine,
    setTemperatureDisplay,
    setTempSubline,
    showError,
    clearError,
    setInfoMessage,
    appendRawLog,
    pushChartPoint,
    clearChart,
    renderSessionList,
    renderSessionReadings,
    setActiveSessionLabel,
    getIntervalMs,
    getIntervalSecondsEffective,
    syncIntervalInputFromEffective,
    setIntervalSecondsValue(s) {
      els.intervalSeconds.value = String(clampIntervalSeconds(s));
    },
    isStreamOn,
    isFahrenheit,
    setUnitToggleFahrenheit,
    bind,
  };
}

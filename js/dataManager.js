/**
 * Session + reading persistence (IndexedDB). Celsius-only in storage.
 *
 * @typedef {{ id: string; name: string; createdAt: number }} SessionRecord
 * @typedef {{ id?: number; sessionId: string; tempC: number; timestamp: number }} ReadingRecord
 */

const DB_NAME = 'forehead_ble_sessions_v1';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_READINGS = 'readings';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_READINGS)) {
        const rs = db.createObjectStore(STORE_READINGS, { keyPath: 'id', autoIncrement: true });
        rs.createIndex('bySession', 'sessionId', { unique: false });
      }
    };
  });
}

let dbPromise = null;

function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

export function cToF(c) {
  return (c * 9) / 5 + 32;
}

/** @returns {Promise<SessionRecord[]>} */
export async function listSessions() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const req = tx.objectStore(STORE_SESSIONS).getAll();
    req.onsuccess = () => {
      const rows = req.result || [];
      rows.sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} name
 * @returns {Promise<SessionRecord>}
 */
export async function createSession(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Session name is required');

  const record = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: Date.now(),
  };

  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    const req = tx.objectStore(STORE_SESSIONS).add(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} sessionId
 * @returns {Promise<SessionRecord|undefined>}
 */
export async function getSession(sessionId) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const req = tx.objectStore(STORE_SESSIONS).get(sessionId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} sessionId
 * @returns {Promise<ReadingRecord[]>}
 */
export async function getReadings(sessionId) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_READINGS, 'readonly');
    const idx = tx.objectStore(STORE_READINGS).index('bySession');
    const req = idx.getAll(sessionId);
    req.onsuccess = () => {
      const rows = req.result || [];
      rows.sort((a, b) => a.timestamp - b.timestamp);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} sessionId
 * @param {number} tempC
 * @param {number} timestamp
 */
export async function addReading(sessionId, tempC, timestamp) {
  if (!sessionId) throw new Error('No active session');
  if (!Number.isFinite(tempC)) throw new Error('Invalid temperature');

  const row = { sessionId, tempC, timestamp };

  try {
    const db = await getDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_READINGS, 'readwrite');
      const req = tx.objectStore(STORE_READINGS).add(row);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    const name = e && typeof e === 'object' && 'name' in e ? e.name : '';
    if (name === 'QuotaExceededError') {
      throw new Error('Storage full — export or delete old sessions in browser settings.');
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Export shape for backup / docs (readings embedded).
 * @param {string} sessionId
 */
export async function exportSessionDocument(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const readings = await getReadings(sessionId);
  return {
    sessionId: session.id,
    name: session.name,
    createdAt: session.createdAt,
    readings: readings.map((r) => ({ tempC: r.tempC, timestamp: r.timestamp })),
  };
}

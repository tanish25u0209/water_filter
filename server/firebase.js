/**
 * firebase.js
 *
 * Wraps firebase-admin so the rest of the app never has to think about
 * service-account loading or exact database paths.
 *
 * IMPORTANT: the schema is intentionally unchanged from the existing
 * MQTT bridge / Lovable dashboard, so nothing downstream breaks:
 *   device1/latest   -> overwritten with .set() on every update
 *   device1/history  -> appended with .push() so nothing is ever lost
 */

const fs = require('fs');
const admin = require('firebase-admin');
const logger = require('./logger');

let db = null;
let deviceRef = null;

/**
 * Loads the service account JSON from either:
 *   - FIREBASE_SERVICE_ACCOUNT_BASE64 (base64-encoded JSON - recommended for Render)
 *   - FIREBASE_SERVICE_ACCOUNT (raw JSON string, or a local file path)
 */
function loadServiceAccount() {
  const { FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT } = process.env;

  if (FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }

  if (FIREBASE_SERVICE_ACCOUNT) {
    const trimmed = FIREBASE_SERVICE_ACCOUNT.trim();

    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }

    if (fs.existsSync(trimmed)) {
      return JSON.parse(fs.readFileSync(trimmed, 'utf8'));
    }
  }

  throw new Error(
    'Missing Firebase credentials: set FIREBASE_SERVICE_ACCOUNT_BASE64 (recommended) or FIREBASE_SERVICE_ACCOUNT.'
  );
}

/** Initializes the Firebase Admin SDK exactly once, even if called multiple times. */
function initFirebase() {
  if (db) return db;

  const { FIREBASE_DATABASE_URL } = process.env;
  if (!FIREBASE_DATABASE_URL) {
    throw new Error('Missing required environment variable: FIREBASE_DATABASE_URL');
  }

  const serviceAccount = loadServiceAccount();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: FIREBASE_DATABASE_URL,
    });
  }

  db = admin.database();
  deviceRef = db.ref('device1');
  logger.info('Firebase initialized', { databaseURL: FIREBASE_DATABASE_URL });
  return db;
}

function ensureReady() {
  if (!deviceRef) initFirebase();
}

/** Overwrites device1/latest with the given record. */
async function writeLatest(record) {
  ensureReady();
  return deviceRef.child('latest').set(record);
}

/** Appends a new node under device1/history - history is never overwritten. */
async function pushHistory(record) {
  ensureReady();
  return deviceRef.child('history').push(record);
}

/** Reads device1/latest directly (used as a fallback right after a server restart, before any update has happened). */
async function readLatest() {
  ensureReady();
  const snapshot = await deviceRef.child('latest').once('value');
  return snapshot.val();
}

/** Reads the most recent `limit` history records (default 100), oldest first. */
async function readHistory(limit = 100) {
  ensureReady();
  const snapshot = await deviceRef.child('history').orderByKey().limitToLast(limit).once('value');
  const value = snapshot.val() || {};

  return Object.entries(value).map(([id, record]) => ({ id, ...record }));
}

module.exports = {
  initFirebase,
  writeLatest,
  pushHistory,
  readLatest,
  readHistory,
};

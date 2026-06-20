/**
 * mqtt.js
 *
 * Connects to the HiveMQ broker over TLS and subscribes to the device's
 * sensor topic. Every valid sensor reading is stored in sensorManager;
 * if Auto Mode is on, it also triggers an immediate combined write to
 * Firebase using the freshest live MQTT values plus whatever manual values
 * are currently on file.
 *
 * Design goals (straight from the spec):
 *   - reconnect automatically forever - mqtt.js's built-in reconnectPeriod
 *     does this for us, no extra retry logic needed
 *   - never crash on a bad payload - malformed JSON or missing fields are
 *     logged and silently dropped, the process keeps running
 */

const mqtt = require('mqtt');
const logger = require('./logger');
const sensorManager = require('./services/sensorManager');
const firebase = require('./firebase');

let client = null;

/** Returns the parsed JSON object, or null if the payload should be ignored. */
function parsePayload(buffer) {
  let payload;

  try {
    payload = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    logger.warn(`Ignoring MQTT message - invalid JSON: ${error.message}`);
    return null;
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    logger.warn('Ignoring MQTT message - payload is not a JSON object');
    return null;
  }

  return payload;
}

/**
 * Only fires when Auto Mode is enabled. Builds the combined record from
 * whatever is currently in memory (live MQTT values + last known manual
 * values) and pushes it straight to Firebase, without waiting for the
 * dashboard to call POST /api/update.
 */
async function handleAutoWrite() {
  if (!sensorManager.isAutoMode()) return;

  try {
    const record = sensorManager.buildCombinedRecord();
    await firebase.writeLatest(record);
    await firebase.pushHistory(record);
    logger.info('Auto Mode: Firebase updated from new MQTT sensor values', record);
  } catch (error) {
    logger.error('Auto Mode: failed to write to Firebase', error.message);
  }
}

function connectMqtt() {
  const {
    MQTT_BROKER_URL,
    MQTT_USERNAME,
    MQTT_PASSWORD,
    MQTT_TOPIC = 'water/device1/data',
    MQTT_CLIENT_ID,
  } = process.env;

  if (!MQTT_BROKER_URL || !MQTT_USERNAME || !MQTT_PASSWORD) {
    logger.error(
      'Missing MQTT_BROKER_URL, MQTT_USERNAME, or MQTT_PASSWORD - MQTT bridge will not start. The HTTP API still works for manual-only usage.'
    );
    return null;
  }

  client = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: MQTT_CLIENT_ID || `vsg-backend-${Date.now()}`,
    clean: true,
    reconnectPeriod: 2000, // keep retrying every 2s forever - this is what gives us automatic reconnect
    connectTimeout: 30_000,
    keepalive: 30,
    rejectUnauthorized: true,
  });

  client.on('connect', () => {
    logger.info(`MQTT connected. Subscribing to ${MQTT_TOPIC}`);
    client.subscribe(MQTT_TOPIC, { qos: 1 }, (error) => {
      if (error) logger.error(`MQTT subscribe failed for ${MQTT_TOPIC}`, error.message);
      else logger.info(`Subscribed to ${MQTT_TOPIC}`);
    });
  });

  client.on('reconnect', () => logger.warn('MQTT reconnecting...'));
  client.on('close', () => logger.warn('MQTT connection closed'));
  client.on('offline', () => logger.warn('MQTT client offline'));
  client.on('error', (error) => logger.error('MQTT client error', error.message));

  client.on('message', (topic, message) => {
    if (topic !== MQTT_TOPIC) return;

    const payload = parsePayload(message);
    if (!payload) return; // already logged inside parsePayload

    const liveUpdates = {};
    const supportedFields = ['temperature', 'input_tds', 'output_tds', 'flow'];
    let sawSupportedField = false;

    supportedFields.forEach((field) => {
      if (payload[field] === undefined) return;
      sawSupportedField = true;

      if (typeof payload[field] !== 'number' || !Number.isFinite(payload[field])) {
        logger.warn(`Ignoring MQTT field - non-numeric "${field}"`);
        return;
      }

      if (field !== 'temperature' && payload[field] === 0) {
        logger.warn(`Ignoring MQTT field - zero "${field}" value`);
        return;
      }

      liveUpdates[field] = payload[field];
    });

    if (!sawSupportedField) {
      logger.warn('Ignoring MQTT message - no supported sensor fields found');
      return;
    }

    sensorManager.setLiveValues(liveUpdates);
    logger.info('MQTT live values updated', liveUpdates);

    void handleAutoWrite();
  });

  return client;
}

function isConnected() {
  return Boolean(client && client.connected);
}

module.exports = { connectMqtt, isConnected };

require('dotenv').config();

const fs = require('fs');
const mqtt = require('mqtt');
const admin = require('firebase-admin');

const {
  MQTT_BROKER_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TOPIC = 'water/device1/data',
  FIREBASE_SERVICE_ACCOUNT,
  FIREBASE_SERVICE_ACCOUNT_BASE64,
  FIREBASE_DATABASE_URL,
  MQTT_CLIENT_ID,
  MQTT_PROTOCOL_VERSION = '4',
  MQTT_KEEPALIVE = '60',
  MQTT_REJECT_UNAUTHORIZED = 'true',
} = process.env;

if (!MQTT_BROKER_URL) {
  throw new Error('Missing required environment variable: MQTT_BROKER_URL');
}

if (!MQTT_USERNAME) {
  throw new Error('Missing required environment variable: MQTT_USERNAME');
}

if (!MQTT_PASSWORD) {
  throw new Error('Missing required environment variable: MQTT_PASSWORD');
}

if (!FIREBASE_SERVICE_ACCOUNT && !FIREBASE_SERVICE_ACCOUNT_BASE64) {
  throw new Error(
    'Missing required environment variable: FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_BASE64'
  );
}

if (!FIREBASE_DATABASE_URL) {
  throw new Error('Missing required environment variable: FIREBASE_DATABASE_URL');
}

function loadServiceAccount(rawValue) {
  const trimmed = rawValue.trim();

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }

  if (fs.existsSync(trimmed)) {
    return JSON.parse(fs.readFileSync(trimmed, 'utf8'));
  }

  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT must be a JSON string or a valid file path to a service account JSON file.'
  );
}

function loadServiceAccountFromEnvironment() {
  if (FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decodedValue = Buffer.from(FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');

    return JSON.parse(decodedValue);
  }

  return loadServiceAccount(FIREBASE_SERVICE_ACCOUNT);
}

function normalizeNumber(value, fieldName) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(`Invalid numeric value for ${fieldName}`);
  }

  return numberValue;
}

function parseSensorPayload(messageBuffer) {
  // Reject malformed or incomplete telemetry before it reaches Firebase.
  let payload;

  try {
    payload = JSON.parse(messageBuffer.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error.message}`);
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload must be a JSON object');
  }

  const requiredFields = ['input_tds', 'output_tds', 'flow', 'temperature', 'efficiency'];
  const parsed = {};

  for (const field of requiredFields) {
    if (!(field in payload)) {
      throw new Error(`Missing required field: ${field}`);
    }

    parsed[field] = normalizeNumber(payload[field], field);
  }

  return parsed;
}

function createLogger() {
  return {
    info: (...args) => console.log(new Date().toISOString(), '[INFO]', ...args),
    warn: (...args) => console.warn(new Date().toISOString(), '[WARN]', ...args),
    error: (...args) => console.error(new Date().toISOString(), '[ERROR]', ...args),
  };
}

const logger = createLogger();

function initializeFirebase() {
  const serviceAccount = loadServiceAccountFromEnvironment();

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: FIREBASE_DATABASE_URL,
    });
  }

  return admin.database();
}

const database = initializeFirebase();
const deviceRef = database.ref('device1');

function buildMqttClient() {
  // mqtt reconnectPeriod keeps the client trying to recover without extra logic.
  const client = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: MQTT_CLIENT_ID || `water-filter-bridge-${Date.now()}`,
    protocolVersion: Number(MQTT_PROTOCOL_VERSION),
    reconnectPeriod: 5000,
    connectTimeout: 30_000,
    clean: true,
    rejectUnauthorized: MQTT_REJECT_UNAUTHORIZED !== 'false',
    keepalive: Number(MQTT_KEEPALIVE),
  });

  client.on('connect', () => {
    logger.info(`Connected to MQTT broker. Subscribing to ${MQTT_TOPIC}`);

    client.subscribe(MQTT_TOPIC, { qos: 1 }, (error) => {
      if (error) {
        logger.error(`MQTT subscription failed for topic ${MQTT_TOPIC}`, error);
        return;
      }

      logger.info(`Subscribed to topic ${MQTT_TOPIC}`);
    });
  });

  client.on('reconnect', () => {
    logger.warn('Attempting MQTT reconnection...');
  });

  client.on('close', () => {
    logger.warn('MQTT connection closed');
  });

  client.on('offline', () => {
    logger.warn('MQTT client went offline');
  });

  client.on('error', (error) => {
    logger.error('MQTT client error', error);
  });

  client.on('message', async (topic, message) => {
    if (topic !== MQTT_TOPIC) {
      return;
    }

    try {
      const sensorData = parseSensorPayload(message);

      // Write latest snapshot (overwrites previous)
      const latestRecord = {
        ...sensorData,
        timestamp: admin.database.ServerValue.TIMESTAMP,
      };

      await deviceRef.child('latest').set(latestRecord);

      // Append to history (keeps all readings)
      const historyRecord = {
        ...sensorData,
        timestamp: Date.now(),
      };

      await deviceRef.child('history').push(historyRecord);

      logger.info('Firebase updated for device1 (latest and history)', sensorData);
    } catch (error) {
      logger.error(`Failed to process MQTT message from ${topic}: ${error.message}`);
    }
  });

  return client;
}

logger.info('Bridge configuration loaded', {
  mqttBroker: MQTT_BROKER_URL,
  mqttTopic: MQTT_TOPIC,
  mqttClientId: MQTT_CLIENT_ID || 'auto-generated',
  mqttProtocolVersion: Number(MQTT_PROTOCOL_VERSION),
  mqttKeepalive: Number(MQTT_KEEPALIVE),
  mqttRejectUnauthorized: MQTT_REJECT_UNAUTHORIZED !== 'false',
  firebaseDatabaseUrl: FIREBASE_DATABASE_URL,
});

const client = buildMqttClient();

async function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down bridge...`);

  try {
    await new Promise((resolve) => client.end(false, {}, resolve));
  } catch (error) {
    logger.error('Error while closing MQTT client', error);
  }

  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  process.exit(1);
});

logger.info('MQTT to Firebase bridge started');

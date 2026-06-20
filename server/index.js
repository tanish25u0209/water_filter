/**
 * index.js
 *
 * Entry point for the Virtual Sensor Generator backend. Wires together:
 *   - Express HTTP server (the manual data API + health check, used by the dashboard)
 *   - Firebase Realtime Database (firebase.js)
 *   - HiveMQ MQTT bridge (mqtt.js)
 *
 * The server is designed to never exit on its own. MQTT errors, Firebase
 * write failures, and malformed payloads are all caught and logged instead
 * of crashing the process, since this needs to run continuously on Render.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const logger = require('./logger');
const firebase = require('./firebase');
const mqttBridge = require('./mqtt');
const sensorManager = require('./services/sensorManager');

const updateRoute = require('./routes/update');
const latestRoute = require('./routes/latest');
const historyRoute = require('./routes/history');
const autoRoute = require('./routes/auto');

const PORT = process.env.PORT || 4000;

const app = express();

// Allow the dashboard (any origin by default - lock this down with CORS_ORIGIN
// in production if you want to restrict it to your hosted dashboard's URL).
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// --- Routes ---
app.use('/api', updateRoute); // POST /api/update
app.use('/api', latestRoute); // GET  /api/latest
app.use('/api', historyRoute); // GET  /api/history
app.use('/api', autoRoute); // POST /api/auto/on, POST /api/auto/off

app.get('/', (req, res) => {
  res.status(200).send('Virtual Sensor Generator backend is running');
});

// The dashboard polls this to display real connection status (MQTT bridge,
// Auto Mode, last known temperature) without needing direct MQTT/Firebase access.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'running',
    mqtt_connected: mqttBridge.isConnected(),
    auto_mode: sensorManager.isAutoMode(),
    last_temperature: sensorManager.getTemperature(),
    timestamp: new Date().toISOString(),
  });
});

// Initialize Firebase before accepting traffic so the very first
// POST /api/update doesn't race against Admin SDK setup. If this fails
// (e.g. bad credentials), we log it but keep the server running so the
// person can fix env vars on Render without a full redeploy.
try {
  firebase.initFirebase();
} catch (error) {
  logger.error('Firebase failed to initialize - check FIREBASE_DATABASE_URL / FIREBASE_SERVICE_ACCOUNT_BASE64', error.message);
}

// Start the MQTT bridge. If credentials are missing this just logs a
// warning and returns null - the HTTP API still works for manual-only usage.
mqttBridge.connectMqtt();

const server = app.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});

// --- Resilience: never let one bad async error take the whole bridge down ---
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
});

// --- Graceful shutdown on Render redeploys / restarts ---
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;

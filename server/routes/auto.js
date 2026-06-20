/**
 * routes/auto.js
 *
 * POST /api/auto/on   -> enable Auto Mode
 * POST /api/auto/off  -> disable Auto Mode
 *
 * When Auto Mode is on, every new MQTT temperature reading automatically
 * triggers a combined write to Firebase (see mqtt.js -> handleAutoWrite).
 * When it's off, Firebase is only updated by an explicit POST /api/update.
 */

const express = require('express');
const logger = require('../logger');
const sensorManager = require('../services/sensorManager');

const router = express.Router();

router.post('/auto/on', (req, res) => {
  sensorManager.setAutoMode(true);
  logger.info('Auto Mode enabled');
  res.status(200).json({ autoMode: true });
});

router.post('/auto/off', (req, res) => {
  sensorManager.setAutoMode(false);
  logger.info('Auto Mode disabled');
  res.status(200).json({ autoMode: false });
});

module.exports = router;

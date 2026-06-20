/**
 * routes/update.js
 *
 * POST /api/update
 *
 * Accepts manual Input TDS / Output TDS / Flow from the dashboard,
 * combines them with the latest MQTT temperature, calculates efficiency,
 * and writes the resulting object to Firebase (device1/latest + device1/history).
 *
 * Body:
 *   { "input_tds": 450, "output_tds": 38, "flow": 2.8 }
 *
 * Optional extra field (not in the original spec, kept backward compatible):
 *   "temperature": 28.5  -> overrides the last MQTT reading for this one write only
 */

const express = require('express');
const logger = require('../logger');
const sensorManager = require('../services/sensorManager');
const firebase = require('../firebase');

const router = express.Router();

function toFiniteNumber(value, fieldName, errors) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${fieldName} must be a valid number`);
    return undefined;
  }
  return n;
}

router.post('/update', async (req, res) => {
  const body = req.body || {};
  const { input_tds, output_tds, flow, temperature } = body;

  if (input_tds === undefined || output_tds === undefined || flow === undefined) {
    return res.status(400).json({
      error: 'input_tds, output_tds, and flow are all required in the request body',
    });
  }

  const errors = [];
  const parsedInputTds = toFiniteNumber(input_tds, 'input_tds', errors);
  const parsedOutputTds = toFiniteNumber(output_tds, 'output_tds', errors);
  const parsedFlow = toFiniteNumber(flow, 'flow', errors);
  const parsedTemperature =
    temperature !== undefined ? toFiniteNumber(temperature, 'temperature', errors) : undefined;

  if (errors.length) {
    return res.status(400).json({ error: errors.join(', ') });
  }

  try {
    const record = sensorManager.buildCombinedRecord({
      input_tds: parsedInputTds,
      output_tds: parsedOutputTds,
      flow: parsedFlow,
      temperature: parsedTemperature,
    });

    await firebase.writeLatest(record);
    await firebase.pushHistory(record);

    logger.info('Manual update written to Firebase', record);
    res.status(200).json(record);
  } catch (error) {
    logger.error('Failed to process POST /api/update', error.message);
    res.status(502).json({ error: 'Failed to write to Firebase', details: error.message });
  }
});

module.exports = router;

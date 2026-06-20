/**
 * routes/latest.js
 *
 * GET /api/latest
 *
 * Returns the latest combined sensor object. Prefers the fast in-memory
 * copy (always in sync with whatever was last written); falls back to
 * reading Firebase directly if the server just restarted and hasn't
 * processed any update yet.
 */

const express = require('express');
const logger = require('../logger');
const sensorManager = require('../services/sensorManager');
const firebase = require('../firebase');

const router = express.Router();

router.get('/latest', async (req, res) => {
  const live = sensorManager.getLiveValues();
  const manual = sensorManager.getManualValues();
  const inMemory = sensorManager.getLatestRecord();

  const wrapResponse = (latest) => {
    const hasLiveValues = Object.values(live).some((value) => typeof value === 'number');
    if (!latest && !hasLiveValues) return null;

    return {
      ...(latest || {}),
      live,
      manual,
    };
  };

  if (inMemory) {
    return res.status(200).json(wrapResponse(inMemory));
  }

  try {
    const fromFirebase = await firebase.readLatest();
    res.status(200).json(wrapResponse(fromFirebase));
  } catch (error) {
    logger.error('Failed to read GET /api/latest from Firebase', error.message);
    res.status(502).json({ error: 'Failed to read latest data', details: error.message });
  }
});

module.exports = router;

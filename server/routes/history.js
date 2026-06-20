/**
 * routes/history.js
 *
 * GET /api/history
 *
 * Returns the latest 100 history records from device1/history.
 * History is append-only (push()), so this never returns stale-overwritten data.
 */

const express = require('express');
const logger = require('../logger');
const firebase = require('../firebase');

const router = express.Router();

router.get('/history', async (req, res) => {
  try {
    const records = await firebase.readHistory(100);
    res.status(200).json(records);
  } catch (error) {
    logger.error('Failed to read GET /api/history from Firebase', error.message);
    res.status(502).json({ error: 'Failed to read history', details: error.message });
  }
});

module.exports = router;

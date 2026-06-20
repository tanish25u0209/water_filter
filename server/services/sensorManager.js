/**
 * services/sensorManager.js
 *
 * The single in-memory "brain" of the bridge. It tracks everything the
 * backend currently knows:
 *   - the most recent temperature reading received from MQTT
 *   - the most recent manual Input TDS / Output TDS / Flow values posted
 *     by the dashboard (POST /api/update)
 *   - whether "Auto Mode" is currently turned on
 *   - the last combined record that was actually built (used by GET /api/latest
 *     as a fast, always-in-sync cache)
 *
 * This module never talks to MQTT or Firebase directly. It only stores
 * numbers and performs the efficiency calculation, so it can be required
 * from anywhere (the MQTT handler, HTTP routes, tests) without circular
 * imports between mqtt.js and the route files.
 */

// Module-level state. A single Node process = a single device1 bridge,
// so a plain object is enough (no need for a class/singleton wrapper).
const state = {
  live: {
    temperature: null, // last value seen on the MQTT topic
    input_tds: null,
    output_tds: null,
    flow: null,
  },
  manual: {
    input_tds: null, // last dashboard value posted to /api/update
    output_tds: null,
    flow: null,
  },
  autoMode: false, // toggled via POST /api/auto/on and /api/auto/off
  latestRecord: null, // last combined object that was built (and written to Firebase)
};

/** Called by mqtt.js whenever a valid temperature reading arrives. */
function setTemperature(value) {
  state.live.temperature = value;
}

function getTemperature() {
  return state.live.temperature;
}

function setLiveValues({ temperature, input_tds, output_tds, flow } = {}) {
  if (temperature !== undefined) state.live.temperature = temperature;
  if (input_tds !== undefined) state.live.input_tds = input_tds;
  if (output_tds !== undefined) state.live.output_tds = output_tds;
  if (flow !== undefined) state.live.flow = flow;
}

function getLiveValues() {
  return { ...state.live };
}

/** Called by POST /api/update to remember the dashboard's manual inputs. */
function setManualValues({ input_tds, output_tds, flow } = {}) {
  if (input_tds !== undefined) state.manual.input_tds = input_tds;
  if (output_tds !== undefined) state.manual.output_tds = output_tds;
  if (flow !== undefined) state.manual.flow = flow;
}

function getManualValues() {
  return { ...state.manual };
}

/** Auto Mode on/off, controlled by POST /api/auto/on and /api/auto/off. */
function setAutoMode(enabled) {
  state.autoMode = Boolean(enabled);
}

function isAutoMode() {
  return state.autoMode;
}

/**
 * efficiency = ((input_tds - output_tds) / input_tds) * 100
 * Clamped to 0-100 so a noisy/zero input_tds reading never produces a
 * negative value or a value above 100%.
 */
function calculateEfficiency(input_tds, output_tds) {
  if (!input_tds || input_tds <= 0) return 0;
  const raw = ((input_tds - output_tds) / input_tds) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * Builds the combined object that gets written to Firebase, e.g.:
 * { input_tds, output_tds, flow, temperature, efficiency, timestamp }
 *
 * Any field passed in here also updates the in-memory state first, so the
 * next call (whether triggered by another manual update or by a new MQTT
 * temperature reading) always uses the freshest known values.
 *
 * `temperature` is an optional override - if omitted, the last MQTT
 * reading on file is used, exactly as the spec requires.
 */
function buildCombinedRecord({ input_tds, output_tds, flow, temperature } = {}) {
  if (input_tds !== undefined) state.manual.input_tds = input_tds;
  if (output_tds !== undefined) state.manual.output_tds = output_tds;
  if (flow !== undefined) state.manual.flow = flow;

  // Manual dashboard values should win over stale live MQTT values when Auto Mode
  // reuses the current snapshot between explicit POST /api/update calls.
  const finalInputTds = input_tds ?? state.manual.input_tds ?? state.live.input_tds ?? 0;
  const finalOutputTds = output_tds ?? state.manual.output_tds ?? state.live.output_tds ?? 0;
  const finalFlow = flow ?? state.manual.flow ?? state.live.flow ?? 0;
  const finalTemperature = temperature !== undefined ? temperature : state.live.temperature ?? null;

  const record = {
    input_tds: finalInputTds,
    output_tds: finalOutputTds,
    flow: finalFlow,
    temperature: finalTemperature,
    efficiency: calculateEfficiency(finalInputTds, finalOutputTds),
    timestamp: Date.now(),
  };

  state.latestRecord = record;
  return record;
}

function getLatestRecord() {
  return state.latestRecord;
}

module.exports = {
  setTemperature,
  getTemperature,
  setLiveValues,
  getLiveValues,
  setManualValues,
  getManualValues,
  setAutoMode,
  isAutoMode,
  buildCombinedRecord,
  getLatestRecord,
};

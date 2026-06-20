/**
 * mqtt-publish-test.js
 *
 * Quick manual test: publishes a sensor payload to the configured MQTT
 * topic so you can confirm the bridge -> Firebase path works end-to-end
 * without waiting for a real ESP32.
 *
 * Usage:
 *   npm run publish:test
 *   TEST_TEMPERATURE=31.2 npm run publish:test
 */

require('dotenv').config();

const mqtt = require('mqtt');

const brokerUrl = process.env.MQTT_BROKER_URL;
const username = process.env.MQTT_USERNAME;
const password = process.env.MQTT_PASSWORD;
const topic = process.env.MQTT_TOPIC || 'water/device1/data';
const clientId = `mqtt-publish-test-${Date.now()}`;

if (!brokerUrl) throw new Error('Missing MQTT_BROKER_URL');
if (!username) throw new Error('Missing MQTT_USERNAME');
if (!password) throw new Error('Missing MQTT_PASSWORD');

const payload = {};

if (process.env.TEST_TEMPERATURE !== undefined) payload.temperature = Number(process.env.TEST_TEMPERATURE);
if (process.env.TEST_INPUT_TDS !== undefined) payload.input_tds = Number(process.env.TEST_INPUT_TDS);
if (process.env.TEST_OUTPUT_TDS !== undefined) payload.output_tds = Number(process.env.TEST_OUTPUT_TDS);
if (process.env.TEST_FLOW !== undefined) payload.flow = Number(process.env.TEST_FLOW);

if (!Object.keys(payload).length) {
  payload.temperature = 28.5;
}

console.log('Publishing test payload:', JSON.stringify({ topic, payload }));

const client = mqtt.connect(brokerUrl, {
  username,
  password,
  clientId,
  reconnectPeriod: 0,
  connectTimeout: 15000,
  clean: true,
  rejectUnauthorized: true,
  keepalive: 60,
});

client.on('connect', () => {
  client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
    if (error) {
      console.error('Publish failed:', error.message);
      process.exitCode = 1;
    } else {
      console.log('Publish successful');
    }
    client.end(true);
  });
});

client.on('error', (error) => {
  console.error('MQTT error:', error.message);
  process.exitCode = 1;
  client.end(true);
});

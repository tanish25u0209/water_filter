require('dotenv').config();

const mqtt = require('mqtt');

const brokerUrl = process.env.MQTT_BROKER_URL;
const username = process.env.MQTT_USERNAME;
const password = process.env.MQTT_PASSWORD;
const clientId = process.env.MQTT_CLIENT_ID || `mqtt-test-${Date.now()}`;
const protocolVersion = Number(process.env.MQTT_PROTOCOL_VERSION || '4');
const rejectUnauthorized = (process.env.MQTT_REJECT_UNAUTHORIZED || 'true') !== 'false';

if (!brokerUrl) throw new Error('Missing MQTT_BROKER_URL');
if (!username) throw new Error('Missing MQTT_USERNAME');
if (!password) throw new Error('Missing MQTT_PASSWORD');

console.log('Connecting with:');
console.log(JSON.stringify({ brokerUrl, username, clientId, protocolVersion, rejectUnauthorized }, null, 2));

const client = mqtt.connect(brokerUrl, {
  username,
  password,
  clientId,
  protocolVersion,
  reconnectPeriod: 0,
  connectTimeout: 15000,
  clean: true,
  rejectUnauthorized,
  keepalive: 60,
});

client.on('connect', () => {
  console.log('MQTT connected successfully');
  client.end(true);
});

client.on('error', (error) => {
  console.error('MQTT error:', error.message);
  client.end(true);
  process.exitCode = 1;
});

client.on('close', () => {
  console.log('MQTT connection closed');
});

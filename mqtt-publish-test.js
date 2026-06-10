require('dotenv').config();

const mqtt = require('mqtt');

const brokerUrl = process.env.MQTT_BROKER_URL;
const username = process.env.MQTT_USERNAME;
const password = process.env.MQTT_PASSWORD;
const topic = process.env.MQTT_TOPIC || 'water/device1/data';
const clientId = process.env.MQTT_PUBLISH_CLIENT_ID || `mqtt-publish-test-${Date.now()}`;
const protocolVersion = Number(process.env.MQTT_PROTOCOL_VERSION || '4');
const rejectUnauthorized = (process.env.MQTT_REJECT_UNAUTHORIZED || 'true') !== 'false';

if (!brokerUrl) throw new Error('Missing MQTT_BROKER_URL');
if (!username) throw new Error('Missing MQTT_USERNAME');
if (!password) throw new Error('Missing MQTT_PASSWORD');

const payload = {
  input_tds: Number(process.env.TEST_INPUT_TDS || 320),
  output_tds: Number(process.env.TEST_OUTPUT_TDS || 45),
  flow: Number(process.env.TEST_FLOW || 2.8),
  temperature: Number(process.env.TEST_TEMPERATURE || 27.6),
  efficiency: Number(process.env.TEST_EFFICIENCY || 85.9),
};

console.log('Publishing test payload:');
console.log(JSON.stringify({ brokerUrl, topic, clientId, protocolVersion, rejectUnauthorized, payload }, null, 2));

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

client.on('close', () => {
  console.log('MQTT connection closed');
});

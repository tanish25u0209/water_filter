# IoT Smart Water Filter Bridge

This Node.js service receives MQTT telemetry from an ESP32 through HiveMQ Cloud and writes the latest health metrics into Firebase Realtime Database for the Lovable dashboard.

## What it does

- Connects to HiveMQ Cloud over MQTT TLS on port `8883`
- Authenticates with MQTT username and password
- Subscribes to `water/device1/data`
- Parses JSON telemetry safely
- Writes the latest snapshot to Firebase under `device1/`
- Automatically reconnects on MQTT disconnects

## Payload shape

```json
{
  "input_tds": 320,
  "output_tds": 45,
  "flow": 2.8,
  "temperature": 27.6,
  "efficiency": 85.9
}
```

## Firebase structure

The bridge writes data here:

```text
device1/
  input_tds
  output_tds
  flow
  temperature
  efficiency
  timestamp
```

## Prerequisites

- Node.js 18 or later
- HiveMQ Cloud cluster and MQTT credentials
- Firebase Realtime Database enabled
- Firebase service account JSON with database access

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
Copy-Item .env.example .env
```

3. Fill in the values in `.env`.

4. Start the bridge:

```bash
npm start
```

To send a test payload into the topic and confirm the bridge path:

```bash
npm run publish:test
```

## Environment variables

- `MQTT_BROKER_URL`: HiveMQ Cloud broker URL, for example `mqtts://your-cluster.s1.eu.hivemq.cloud:8883`
- `MQTT_USERNAME`: MQTT username
- `MQTT_PASSWORD`: MQTT password
- `MQTT_TOPIC`: MQTT topic to subscribe to, defaults to `water/device1/data`
- `MQTT_CLIENT_ID`: optional client ID
- `FIREBASE_SERVICE_ACCOUNT`: Firebase service account JSON string or local file path
- `FIREBASE_DATABASE_URL`: Firebase Realtime Database URL

## Notes about the Firebase service account

You can provide the service account in either of these ways:

- Paste the full JSON into `FIREBASE_SERVICE_ACCOUNT`
- Set `FIREBASE_SERVICE_ACCOUNT` to a local file path that points to the JSON file

If you use the JSON string approach, keep the private key escaped with `\n` line breaks.

## Render deployment instructions

This app should be deployed as a Render **Background Worker** because it is a long-running MQTT bridge and does not serve HTTP traffic.

### Option 1: Blueprint deploy

1. Push this repository to GitHub.
2. Connect the repository to Render.
3. Choose **New +** then **Blueprint**.
4. Select the repository root.
5. Render will read [render.yaml](render.yaml) and create the worker service.
6. Add the secret environment variables in Render:

- `MQTT_BROKER_URL`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `MQTT_TOPIC`
- `MQTT_CLIENT_ID`
- `FIREBASE_SERVICE_ACCOUNT`
- `FIREBASE_DATABASE_URL`

### Option 2: Manual worker

1. Push this repository to GitHub.
2. Create a new **Background Worker** on Render.
3. Connect the GitHub repository.
4. Set the build command to `npm install`.
5. Set the start command to `npm start`.
6. Add the same environment variables listed above.
7. Deploy the service.

Important: this bridge is a long-running process, so use a service type that stays online continuously.

## GitHub deployment instructions

### Option 1: GitHub Actions

Use GitHub Actions to validate the app on each push.

Example workflow:

```yaml
name: Node CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: node -e "require('./index.js')"
        env:
          MQTT_BROKER_URL: ${{ secrets.MQTT_BROKER_URL }}
          MQTT_USERNAME: ${{ secrets.MQTT_USERNAME }}
          MQTT_PASSWORD: ${{ secrets.MQTT_PASSWORD }}
          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          FIREBASE_DATABASE_URL: ${{ secrets.FIREBASE_DATABASE_URL }}
```

### Option 2: GitHub to Render auto-deploy

1. Push changes to GitHub.
2. Connect the repository to Render.
3. Enable automatic deploys from `main`.
4. Update secrets or environment variables in Render when credentials change.

## Operational behavior

- MQTT reconnects automatically using the mqtt client reconnect logic.
- Invalid JSON messages are logged and skipped.
- Missing fields or non-numeric values are rejected before any Firebase write.
- Each valid message overwrites the latest `device1/` snapshot in Firebase so the dashboard always reads the newest state.

## Test publisher

The repository includes [mqtt-publish-test.js](mqtt-publish-test.js) for quick end-to-end checks.

It publishes a sample payload to `water/device1/data` using the same environment variables as the bridge.

Optional overrides:

- `TEST_INPUT_TDS`
- `TEST_OUTPUT_TDS`
- `TEST_FLOW`
- `TEST_TEMPERATURE`
- `TEST_EFFICIENCY`

## Verify Firebase

After the bridge is running and a test payload is published:

1. Open the Firebase console.
2. Go to Realtime Database.
3. Check the `device1` node.
4. Confirm the latest values and `timestamp` are updating.

If the values do not change, publish another test message with `npm run publish:test` and watch the bridge terminal for a `Firebase updated for device1` log line.

## Troubleshooting

- If the bridge cannot connect to HiveMQ Cloud, verify the broker URL uses `mqtts://` and port `8883`.
- If Firebase writes fail, verify the service account has access to the Realtime Database instance.
- If the private key breaks after copy-paste, ensure newlines are escaped as `\n`.

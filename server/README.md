# Virtual Sensor Generator — Backend

Node.js + Express bridge between:

- an ESP32 publishing live sensor readings over **HiveMQ MQTT**
- manual **Input TDS / Output TDS / Flow** values typed into the dashboard
- **Firebase Realtime Database**, which the Lovable dashboard reads from

```
ESP32 → HiveMQ MQTT → Node backend → Firebase Realtime Database → Lovable Dashboard
                            ↑
                  Virtual Sensor Generator (manual dashboard)
```

## Folder structure

```
server/
  index.js                # entry point - wires Express, MQTT, and Firebase together
  mqtt.js                 # HiveMQ connection, subscribe, parse, auto-write
  firebase.js              # firebase-admin wrapper (device1/latest + device1/history)
  logger.js                # shared timestamped console logger
  routes/
    update.js              # POST /api/update
    latest.js              # GET  /api/latest
    history.js              # GET  /api/history
    auto.js                 # POST /api/auto/on, POST /api/auto/off
  services/
    sensorManager.js        # in-memory state + efficiency calculation
  mqtt-publish-test.js      # publishes a test temperature reading
  package.json
  .env.example
  render.yaml
```

## Environment variables

See `.env.example`. Copy it to `.env` for local development:

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `MQTT_BROKER_URL` | yes | e.g. `mqtts://your-cluster.s1.eu.hivemq.cloud:8883` |
| `MQTT_USERNAME` | yes | HiveMQ credential |
| `MQTT_PASSWORD` | yes | HiveMQ credential |
| `MQTT_TOPIC` | no | defaults to `water/device1/data` |
| `FIREBASE_DATABASE_URL` | yes | e.g. `https://your-project-default-rtdb.firebaseio.com` |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | yes | base64-encoded service account JSON |
| `PORT` | no | defaults to `4000` |
| `CORS_ORIGIN` | no | defaults to `*`; set to your dashboard's URL to lock it down |

If MQTT credentials are missing, the server logs a warning and still starts — the manual HTTP API keeps working, it just won't receive live ESP32 values.

## Run locally

```bash
cd server
npm install
npm start
```

Test the MQTT path without a real ESP32:

```bash
npm run publish:test
```

Optional test fields:

```bash
TEST_TEMPERATURE=28.5 TEST_INPUT_TDS=450 TEST_OUTPUT_TDS=38 TEST_FLOW=2.8 npm run publish:test
```

## API

### `POST /api/update`
```json
{ "input_tds": 450, "output_tds": 38, "flow": 2.8 }
```
Combines this with the latest MQTT live values, calculates efficiency, writes to `device1/latest` (overwrite) and `device1/history` (append), and returns the resulting object:
```json
{ "input_tds": 450, "output_tds": 38, "flow": 2.8, "temperature": 28.5, "efficiency": 91.56, "timestamp": 1749532000000 }
```
An optional `temperature` field in the body overrides the MQTT reading for that one write only — handy for the dashboard's manual-temperature toggle.

### `GET /api/latest`
Returns the latest combined object (from memory, or Firebase if the server just restarted), plus nested `live` and `manual` snapshots so the dashboard can show the current MQTT readings separately from stored/manual values.

### `GET /api/history`
Returns the latest 100 records from `device1/history`.

### `POST /api/auto/on` / `POST /api/auto/off`
Turns Auto Mode on/off. While on, every new MQTT temperature reading immediately triggers a Firebase write using whatever manual values are currently on file — no need to call `/api/update` again.

### `GET /health`
```json
{ "status": "running", "mqtt_connected": true, "auto_mode": false, "last_temperature": 28.5, "timestamp": "..." }
```
Used by Render's health checks and by the dashboard to show live connection status.

## Firebase schema (unchanged)

```
device1/
  latest/      <- overwritten by .set() on every update
    input_tds
    output_tds
    flow
    temperature
    efficiency
    timestamp
  history/     <- appended by .push() — never overwritten
    -NxYz.../
      input_tds
      ...
```

## Deploying on Render

1. Push this `server/` folder to a GitHub repo (as the repo root, or update `render.yaml`'s paths if nested).
2. In Render: **New +** → **Blueprint** → select the repo → Render reads `render.yaml` and creates a **Web Service**.
3. Fill in the secret env vars Render prompts for (`MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, `FIREBASE_DATABASE_URL`).
4. Once deployed, copy the service URL (e.g. `https://virtual-sensor-generator-backend.onrender.com`) — you'll paste this into the dashboard's `BACKEND_URL` config.

This is deployed as a **Web Service** (not a background worker) because it now serves the HTTP API the dashboard calls.

## Error handling

- MQTT reconnects automatically forever (`reconnectPeriod: 2000`).
- Malformed/invalid MQTT JSON is logged and ignored — never crashes the process.
- Missing/non-numeric request fields return `400` instead of writing bad data to Firebase.
- Firebase write/read failures are caught and returned as `502` with details, instead of crashing.
- `unhandledRejection` / `uncaughtException` are logged, not fatal.

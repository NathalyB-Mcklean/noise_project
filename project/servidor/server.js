// =============================================
// SERVIDOR CENTRAL — AcústicaPTY
// Node.js + Express + MQTT + Socket.io + Firebase + Swagger
// =============================================
// Instalar dependencias:
//   npm install
// Correr:
//   node server.js
// =============================================

require("dotenv").config();
const express    = require("express");
const http       = require("http");
const socketIo   = require("socket.io");
const mqtt       = require("mqtt");
const nodemailer = require("nodemailer");
const swaggerUi  = require("swagger-ui-express");
const cors       = require("cors");
const admin      = require("firebase-admin");

// --- CONFIGURACIÓN (usa variables de entorno en .env) ---
const MQTT_HOST    = process.env.MQTT_HOST    || "TU_HOST.s1.eu.hivemq.cloud";
const MQTT_USER    = process.env.MQTT_USER    || "TU_USUARIO";
const MQTT_PASS    = process.env.MQTT_PASS    || "TU_CONTRASEÑA";
const ALERT_EMAIL  = process.env.ALERT_EMAIL  || "tu_correo@gmail.com";
const EMAIL_PASS   = process.env.EMAIL_PASS   || "tu_app_password";
const ALERT_TO     = process.env.ALERT_TO     || "autoridades@alcaldiadepanama.gob.pa";
const PORT         = process.env.PORT         || 3000;
const DB_LIMITE    = 65; // Umbral OMS

// --- INICIALIZAR EXPRESS + HTTP + SOCKET.IO ---
const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // Sirve el dashboard

// --- BASE DE DATOS EN MEMORIA (Firebase opcional) ---
// Si no tienes Firebase, el servidor guarda todo en memoria
let readings = [];          // historial completo
let latestByZone = {};      // última lectura por zona

// --- FIREBASE (opcional — comentar si no lo usas) ---
// Para activar Firebase:
// 1. Descarga serviceAccountKey.json de Firebase Console
// 2. Descomenta estas líneas
/*
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://TU_PROYECTO.firebaseio.com"
});
const db = admin.database();
*/

// --- CLIENTE MQTT ---
const mqttUrl = `mqtts://${MQTT_HOST}:8883`;
const mqttClient = mqtt.connect(mqttUrl, {
  username: MQTT_USER,
  password: MQTT_PASS,
  rejectUnauthorized: false,
  reconnectPeriod: 8000,
  connectTimeout: 30000,
  keepalive: 60,
  clean: true,
  protocolVersion: 4,
  wsOptions: {}
});

mqttClient.on("connect", () => {
  console.log("✓ Broker MQTT conectado");
  mqttClient.subscribe("panama/ruido/#", { qos: 1 }, (err) => {
    if (err) console.error("Error al suscribirse:", err);
    else console.log("✓ Suscrito a panama/ruido/#");
  });
});

mqttClient.on("message", async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const reading = {
      id:        Date.now().toString(),
      topic,
      zona:      data.zona || topic.split("/")[2],
      db:        parseFloat(data.db),
      lat:       data.lat,
      lon:       data.lon,
      timestamp: data.timestamp || new Date().toISOString(),
      alerta:    parseFloat(data.db) > DB_LIMITE
    };

    // Guardar en historial
    readings.push(reading);
    if (readings.length > 10000) readings.shift(); // máximo 10k lecturas en memoria
    latestByZone[reading.zona] = reading;

    // Guardar en Firebase (si está activo)
    /*
    await db.ref(`lecturas/${reading.zona}/${reading.id}`).set(reading);
    await db.ref(`ultimas/${reading.zona}`).set(reading);
    */

    // Emitir por WebSocket al dashboard
    io.emit("nueva-lectura", reading);
    console.log(`[MQTT] ${topic} → ${reading.db} dB`);

    // Alerta si supera umbral
    if (reading.alerta) {
      console.log(`⚠️  ALERTA: ${reading.zona} → ${reading.db} dB`);
      io.emit("alerta", reading);
      enviarAlertaEmail(reading);
    }

  } catch (e) {
    console.error("Error procesando mensaje MQTT:", e.message);
  }
});

mqttClient.on("error", (err) => console.error("Error MQTT completo:", err));

// --- EMAIL CON NODEMAILER ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: ALERT_EMAIL, pass: EMAIL_PASS }
});

let ultimaAlertaEnviada = {};
async function enviarAlertaEmail(reading) {
  const ahora = Date.now();
  // Evitar spam: máximo 1 email por zona cada 5 minutos
  if (ultimaAlertaEnviada[reading.zona] &&
      ahora - ultimaAlertaEnviada[reading.zona] < 5 * 60 * 1000) return;
  ultimaAlertaEnviada[reading.zona] = ahora;

  try {
    await transporter.sendMail({
      from: `"AcústicaPTY Sistema" <${ALERT_EMAIL}>`,
      to:   ALERT_TO,
      subject: `⚠️ Alerta Acústica — ${reading.zona} superó ${DB_LIMITE} dB`,
      html: `
        <h2>Alerta de Contaminación Acústica</h2>
        <p><strong>Zona:</strong> ${reading.zona}</p>
        <p><strong>Nivel:</strong> <span style="color:red;font-size:24px">${reading.db} dB</span></p>
        <p><strong>Umbral OMS:</strong> ${DB_LIMITE} dB</p>
        <p><strong>Hora:</strong> ${new Date(reading.timestamp).toLocaleString("es-PA")}</p>
        <p><strong>Coordenadas:</strong> ${reading.lat}, ${reading.lon}</p>
        <p><strong>Tópico MQTT:</strong> <code>${reading.topic}</code></p>
        <hr>
        <small>Sistema AcústicaPTY — Red distribuida de monitoreo acústico</small>
      `
    });
    console.log(`✉️  Email de alerta enviado para ${reading.zona}`);
  } catch (e) {
    console.error("Error enviando email:", e.message);
  }
}

// =============================================
// API REST
// =============================================

// GET /api/status
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    broker: mqttClient.connected,
    zonas_activas: Object.keys(latestByZone).length,
    total_lecturas: readings.length,
    uptime_segundos: Math.round(process.uptime())
  });
});

// GET /api/zonas — últimas lecturas por zona
app.get("/api/zonas", (req, res) => {
  res.json(Object.values(latestByZone));
});

// GET /api/lecturas — historial con filtros
// Parámetros: zona, desde, hasta, min_db, max_db, limit
app.get("/api/lecturas", (req, res) => {
  let result = [...readings];

  if (req.query.zona)
    result = result.filter(r => r.zona.toLowerCase() === req.query.zona.toLowerCase());
  if (req.query.desde)
    result = result.filter(r => new Date(r.timestamp) >= new Date(req.query.desde));
  if (req.query.hasta)
    result = result.filter(r => new Date(r.timestamp) <= new Date(req.query.hasta));
  if (req.query.min_db)
    result = result.filter(r => r.db >= parseFloat(req.query.min_db));
  if (req.query.max_db)
    result = result.filter(r => r.db <= parseFloat(req.query.max_db));

  const limit = parseInt(req.query.limit) || 100;
  result = result.slice(-limit);

  res.json({ total: result.length, data: result });
});

// GET /api/alertas — solo lecturas con alerta
app.get("/api/alertas", (req, res) => {
  const alertas = readings.filter(r => r.alerta);
  res.json({ total: alertas.length, data: alertas.slice(-50) });
});

// GET /api/zonas/:zona/promedio — promedio de dB por zona
app.get("/api/zonas/:zona/promedio", (req, res) => {
  const zonReadings = readings.filter(
    r => r.zona.toLowerCase() === req.params.zona.toLowerCase()
  );
  if (zonReadings.length === 0)
    return res.status(404).json({ error: "Zona no encontrada o sin datos" });
  const avg = zonReadings.reduce((s, r) => s + r.db, 0) / zonReadings.length;
  res.json({
    zona: req.params.zona,
    promedio_db: Math.round(avg * 10) / 10,
    lecturas: zonReadings.length,
    limite_decreto_306: 55,
    supera_limite: avg > 55
  });
});

// =============================================
// SWAGGER UI — Documentación de la API
// =============================================
const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "AcústicaPTY API",
    version: "1.0.0",
    description: "API REST para la red distribuida de monitoreo acústico de Ciudad de Panamá"
  },
  paths: {
    "/api/status": {
      get: {
        summary: "Estado del sistema",
        responses: { "200": { description: "Estado del broker y estadísticas" } }
      }
    },
    "/api/zonas": {
      get: {
        summary: "Últimas lecturas por zona",
        responses: { "200": { description: "Array con la lectura más reciente de cada zona" } }
      }
    },
    "/api/lecturas": {
      get: {
        summary: "Historial de lecturas con filtros",
        parameters: [
          { name: "zona",    in: "query", schema: { type: "string" } },
          { name: "desde",   in: "query", schema: { type: "string", format: "date-time" } },
          { name: "hasta",   in: "query", schema: { type: "string", format: "date-time" } },
          { name: "min_db",  in: "query", schema: { type: "number" } },
          { name: "max_db",  in: "query", schema: { type: "number" } },
          { name: "limit",   in: "query", schema: { type: "integer", default: 100 } }
        ],
        responses: { "200": { description: "Lecturas filtradas" } }
      }
    },
    "/api/alertas": {
      get: {
        summary: "Lecturas que superaron el umbral de 65 dB",
        responses: { "200": { description: "Lista de alertas" } }
      }
    },
    "/api/zonas/{zona}/promedio": {
      get: {
        summary: "Promedio de dB para una zona",
        parameters: [{ name: "zona", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Promedio calculado" },
          "404": { description: "Zona sin datos" }
        }
      }
    }
  }
};

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- SOCKET.IO ---
io.on("connection", (socket) => {
  console.log(`Dashboard conectado: ${socket.id}`);
  // Enviar estado actual al cliente que se conecta
  socket.emit("estado-inicial", {
    zonas: Object.values(latestByZone),
    alertas_hoy: readings.filter(r => r.alerta).length
  });
  socket.on("disconnect", () => console.log(`Dashboard desconectado: ${socket.id}`));
});

// --- INICIAR SERVIDOR ---
server.listen(PORT, () => {
  console.log(`\n🎙️  AcústicaPTY Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📡  API REST: http://localhost:${PORT}/api/lecturas`);
  console.log(`📖  Swagger:  http://localhost:${PORT}/api/docs`);
  console.log(`🌐  Dashboard: http://localhost:${PORT}\n`);
});

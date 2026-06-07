// =============================================
// SERVIDOR CENTRAL — AcústicaPTY
// Node.js + Express + MQTT + Socket.io + Firebase + Swagger
// =============================================

require("dotenv").config();
const express    = require("express");
const http       = require("http");
const socketIo   = require("socket.io");
const mqtt       = require("mqtt");
const nodemailer = require("nodemailer");
const swaggerUi  = require("swagger-ui-express");
const cors       = require("cors");

// --- CONFIGURACIÓN ---
const MQTT_HOST    = process.env.MQTT_HOST    || "3c75291ac00841a5a6f52b8c24db510a.s1.eu.hivemq.cloud";
const MQTT_USER    = process.env.MQTT_USER    || "panama_ruido";
const MQTT_PASS    = process.env.MQTT_PASS    || "Ruido2026!";
const ALERT_EMAIL  = process.env.ALERT_EMAIL  || "tu_correo@gmail.com";
const EMAIL_PASS   = process.env.EMAIL_PASS   || "tu_app_password";
const ALERT_TO     = process.env.ALERT_TO     || "tu_correo@gmail.com";
const PORT         = process.env.PORT         || 3000;
const DB_LIMITE    = 65;

// --- SANITIZACIÓN XSS ---
// Escapa caracteres peligrosos para prevenir JS Injection
function sanitize(str) {
  if (typeof str !== "string") return String(str || "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .slice(0, 100);
}

// --- EXPRESS + HTTP + SOCKET.IO ---
const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "10kb" })); // limitar tamaño del body
app.use(express.static("public"));

// --- MEMORIA ---
let readings      = [];
let latestByZone  = {};

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
  protocolVersion: 4
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

    // VALIDACIÓN — rechazar mensajes malformados
    if (typeof data.db === "undefined" || isNaN(parseFloat(data.db))) {
      console.warn("Mensaje MQTT inválido ignorado:", topic);
      return;
    }

    const dbVal = parseFloat(data.db);

    // Validar rango físico realista de dB
    if (dbVal < 0 || dbVal > 150) {
      console.warn(`Valor dB fuera de rango (${dbVal}) — ignorado`);
      return;
    }

    const reading = {
      id:        Date.now().toString(),
      topic:     sanitize(topic),
      zona:      sanitize(data.zona || topic.split("/")[2]),
      db:        Math.round(dbVal * 10) / 10,
      lat:       parseFloat(data.lat) || 0,
      lon:       parseFloat(data.lon) || 0,
      timestamp: data.timestamp || new Date().toISOString(),
      alerta:    dbVal > DB_LIMITE
    };

    readings.push(reading);
    if (readings.length > 10000) readings.shift();
    latestByZone[reading.zona] = reading;

    io.emit("nueva-lectura", reading);
    console.log(`[MQTT] ${reading.zona} → ${reading.db} dB`);

    if (reading.alerta) {
      console.log(`⚠️  ALERTA: ${reading.zona} → ${reading.db} dB`);
      io.emit("alerta", reading);
      enviarAlertaEmail(reading);
    }

  } catch (e) {
    console.error("Error procesando mensaje MQTT:", e.message);
  }
});

mqttClient.on("error", (err) => console.error("Error MQTT:", err.message));

// --- EMAIL CON NODEMAILER ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: ALERT_EMAIL, pass: EMAIL_PASS }
});

let ultimaAlertaEnviada = {};
async function enviarAlertaEmail(reading) {
  const ahora = Date.now();
  if (ultimaAlertaEnviada[reading.zona] &&
      ahora - ultimaAlertaEnviada[reading.zona] < 5 * 60 * 1000) return;
  ultimaAlertaEnviada[reading.zona] = ahora;

  try {
    await transporter.sendMail({
      from:    `"AcústicaPTY Sistema" <${ALERT_EMAIL}>`,
      to:      ALERT_TO,
      subject: `⚠️ Alerta Acústica — ${reading.zona} superó ${DB_LIMITE} dB`,
      html: `
        <div style="font-family:sans-serif;max-width:500px">
          <h2 style="color:#c0392b">⚠️ Alerta de Contaminación Acústica</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:8px;border:1px solid #ddd"><strong>Zona</strong></td>
                <td style="padding:8px;border:1px solid #ddd">${reading.zona}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><strong>Nivel medido</strong></td>
                <td style="padding:8px;border:1px solid #ddd;color:#c0392b;font-size:20px">
                  <strong>${reading.db} dB</strong></td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><strong>Umbral OMS</strong></td>
                <td style="padding:8px;border:1px solid #ddd">${DB_LIMITE} dB</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><strong>Hora</strong></td>
                <td style="padding:8px;border:1px solid #ddd">
                  ${new Date(reading.timestamp).toLocaleString("es-PA")}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><strong>Coordenadas</strong></td>
                <td style="padding:8px;border:1px solid #ddd">${reading.lat}, ${reading.lon}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd"><strong>Tópico MQTT</strong></td>
                <td style="padding:8px;border:1px solid #ddd">
                  <code>${reading.topic}</code></td></tr>
          </table>
          <p style="color:#888;font-size:12px;margin-top:16px">
            Sistema AcústicaPTY — Red distribuida de monitoreo acústico urbano · Panamá
          </p>
        </div>
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

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    broker: mqttClient.connected,
    zonas_activas: Object.keys(latestByZone).length,
    total_lecturas: readings.length,
    uptime_segundos: Math.round(process.uptime())
  });
});

app.get("/api/zonas", (req, res) => {
  res.json(Object.values(latestByZone));
});

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
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  res.json({ total: result.length, data: result.slice(-limit) });
});

app.get("/api/alertas", (req, res) => {
  const alertas = readings.filter(r => r.alerta);
  res.json({ total: alertas.length, data: alertas.slice(-50) });
});

app.get("/api/zonas/:zona/promedio", (req, res) => {
  const zona = sanitize(req.params.zona);
  const zonReadings = readings.filter(
    r => r.zona.toLowerCase() === zona.toLowerCase()
  );
  if (!zonReadings.length)
    return res.status(404).json({ error: "Zona no encontrada o sin datos" });
  const avg = zonReadings.reduce((s, r) => s + r.db, 0) / zonReadings.length;
  res.json({
    zona,
    promedio_db: Math.round(avg * 10) / 10,
    lecturas: zonReadings.length,
    limite_decreto_306: 55,
    supera_limite: avg > 55
  });
});

// =============================================
// SWAGGER
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
      get: { summary: "Estado del sistema",
        responses: { "200": { description: "Estado del broker y estadísticas" } } }
    },
    "/api/zonas": {
      get: { summary: "Últimas lecturas por zona",
        responses: { "200": { description: "Array con la lectura más reciente de cada zona" } } }
    },
    "/api/lecturas": {
      get: {
        summary: "Historial de lecturas con filtros",
        parameters: [
          { name: "zona",   in: "query", schema: { type: "string" } },
          { name: "desde",  in: "query", schema: { type: "string", format: "date-time" } },
          { name: "hasta",  in: "query", schema: { type: "string", format: "date-time" } },
          { name: "min_db", in: "query", schema: { type: "number" } },
          { name: "max_db", in: "query", schema: { type: "number" } },
          { name: "limit",  in: "query", schema: { type: "integer", default: 100 } }
        ],
        responses: { "200": { description: "Lecturas filtradas" } }
      }
    },
    "/api/alertas": {
      get: { summary: "Lecturas que superaron 65 dB",
        responses: { "200": { description: "Lista de alertas" } } }
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


// Endpoint de configuración para el sensor PWA
// Las credenciales vienen del .env, nunca del código fuente
app.get("/api/config", (req, res) => {
  res.json({
    mqttHost: MQTT_HOST,
    mqttPort: parseInt(process.env.MQTT_PORT) || 8884,
    mqttUser: MQTT_USER,
    mqttPass: MQTT_PASS
  });
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- SOCKET.IO ---
io.on("connection", (socket) => {
  console.log(`Dashboard conectado: ${socket.id}`);
  socket.emit("estado-inicial", {
    zonas: Object.values(latestByZone),
    alertas_hoy: readings.filter(r => r.alerta).length
  });
  socket.on("disconnect", () => console.log(`Dashboard desconectado: ${socket.id}`));
});

// --- INICIAR ---
server.listen(PORT, () => {
  console.log(`\n🎙️  AcústicaPTY en http://localhost:${PORT}`);
  console.log(`📡  API: http://localhost:${PORT}/api/lecturas`);
  console.log(`📖  Swagger: http://localhost:${PORT}/api/docs\n`);
});
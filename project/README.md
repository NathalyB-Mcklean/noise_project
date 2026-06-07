# AcústicaPTY — Guía Paso a Paso

## Estructura del proyecto

```
acustica-pty/
├── sensor-pwa/          ← Nodo sensor (abrir en el celular)
│   ├── index.html
│   └── manifest.json
└── servidor/            ← Servidor central (correr en tu PC)
    ├── server.js
    ├── package.json
    ├── .env.example
    └── public/
        └── index.html   ← Dashboard con mapa
```

---

## PASO 1 — Crear cuenta HiveMQ Cloud (broker MQTT gratis)

1. Entra a: https://console.hivemq.cloud
2. Crea una cuenta gratis (Free Forever)
3. Crea un nuevo "Cluster" → tipo Free
4. En el cluster, ve a **Access Management** → crea un usuario
   - Username: acusticapty
   - Password: elige una segura
5. Apunta estos datos:
   - **Host**: algo como `abc123.s1.eu.hivemq.cloud`
   - **Username y Password** que creaste

---

## PASO 2 — Configurar el archivo .env

1. En la carpeta `servidor/`, copia `.env.example` como `.env`:
   ```
   cp .env.example .env
   ```
2. Edita `.env` y rellena los datos de HiveMQ:
   ```
   MQTT_HOST=abc123.s1.eu.hivemq.cloud
   MQTT_USER=acusticapty
   MQTT_PASS=TuContraseña
   ```
3. Para email (opcional para la demo):
   - Ve a myaccount.google.com → Seguridad → Contraseñas de aplicaciones
   - Crea una para "Correo / Windows"
   - Pega la contraseña de 16 caracteres en EMAIL_PASS

---

## PASO 3 — Instalar Node.js (si no lo tienes)

1. Descarga desde: https://nodejs.org (versión LTS)
2. Instala con todas las opciones por defecto
3. Verifica: abre terminal y escribe `node --version`

---

## PASO 4 — Instalar dependencias y correr el servidor

En la terminal, desde la carpeta `servidor/`:

```bash
# Instalar dependencias
npm install

# Correr el servidor
node server.js
```

Deberías ver:
```
✓ Broker MQTT conectado
✓ Suscrito a panama/ruido/#
🎙️  AcústicaPTY Servidor corriendo en http://localhost:3000
```

---

## PASO 5 — Configurar el sensor PWA

En el archivo `sensor-pwa/index.html`, busca esta sección al inicio del `<script>`:

```javascript
const MQTT_CONFIG = {
  host: "TU_HOST.s1.eu.hivemq.cloud",   // <-- pon tu host de HiveMQ
  username: "TU_USUARIO",                // <-- tu usuario HiveMQ
  password: "TU_CONTRASEÑA",             // <-- tu contraseña HiveMQ
};
```

Reemplaza con los datos de tu cuenta HiveMQ.

---

## PASO 6 — Servir el sensor en el celular

Para que el celular acceda al sensor necesitas servirlo con HTTPS.
La forma más fácil es con una herramienta gratuita:

**Opción A — ngrok (recomendado para demo):**
1. Descarga ngrok: https://ngrok.com/download
2. Corre: `ngrok http 3000`
3. Copia la URL que aparece (ej: `https://abc123.ngrok.io`)
4. Abre esa URL en el celular

**Opción B — Live Server en VS Code:**
1. Instala extensión "Live Server" en VS Code
2. Click derecho en `sensor-pwa/index.html` → "Open with Live Server"
3. El celular y PC deben estar en el mismo WiFi
4. Accede con la IP local: `http://192.168.X.X:5500`

---

## PASO 7 — Ver el dashboard

1. Con el servidor corriendo, abre: http://localhost:3000
2. Deberías ver el mapa de Ciudad de Panamá
3. Cuando el sensor envíe datos, aparecerán como puntos en el mapa en tiempo real

---

## PASO 8 — Explorar la API REST

Con el servidor corriendo, abre:
- **Documentación Swagger**: http://localhost:3000/api/docs
- **Últimas lecturas por zona**: http://localhost:3000/api/zonas
- **Historial completo**: http://localhost:3000/api/lecturas
- **Solo alertas**: http://localhost:3000/api/alertas
- **Estado del sistema**: http://localhost:3000/api/status

---

## Para la presentación — qué mostrar

1. **Abre el dashboard** en la pantalla grande (http://localhost:3000)
2. **Abre el sensor** en el celular con ngrok
3. **Activa el micrófono** en el celular → acepta el consentimiento
4. El **punto en el mapa** aparece en tiempo real
5. **Aplausos fuertes** cerca del micrófono → se dispara alerta roja
6. Muestra **Swagger UI** para la API REST
7. Muestra el **log MQTT** en la terminal

---

## Problemas frecuentes

| Error | Solución |
|-------|----------|
| `ECONNREFUSED` en MQTT | Verifica host/usuario/contraseña en .env |
| Micrófono no funciona | El celular debe usar HTTPS (ngrok) |
| GPS no disponible | Normal en escritorio, funciona en celular |
| `npm: command not found` | Instala Node.js desde nodejs.org |

---

## Tecnologías utilizadas (para el informe)

| Componente | Tecnología | Protocolo |
|------------|-----------|-----------|
| Nodo sensor | HTML/JS + Web Audio API | — |
| Comunicación IoT | MQTT (mqtt.js) | MQTT v3.1.1, QoS 1 |
| Broker | HiveMQ Cloud | MQTTS (TLS 8883) |
| Servidor | Node.js + Express | — |
| Tiempo real cliente | Socket.io | WebSocket (RFC 6455) |
| Mapa | Leaflet.js | — |
| API | Express + Swagger UI | REST / HTTP |
| Alertas | Nodemailer | SMTP |
| Almacenamiento | Firebase / Memoria RAM | — |

import paho.mqtt.client as mqtt
import time
import json
import random
import threading
import statistics
import datetime
import os
from dotenv import load_dotenv

# Carga las credenciales
load_dotenv(os.path.join(os.path.dirname(__file__), "project", "servidor", ".env"))

BROKER_HOST = os.getenv("MQTT_HOST", "")
BROKER_PORT = 8883
MQTT_USER   = os.getenv("MQTT_USER", "")
MQTT_PASS   = os.getenv("MQTT_PASS", "")
TOPIC_BASE  = "panama/ruido"

# Zonas de Panama
ZONAS = [
    {"zona": "Río Abajo",       "lat": 9.0349,  "lon": -79.4797},
    {"zona": "San Francisco",   "lat": 8.9936,  "lon": -79.5073},
    {"zona": "Bella Vista",     "lat": 8.9897,  "lon": -79.5233},
    {"zona": "Betania",         "lat": 9.0050,  "lon": -79.5353},
    {"zona": "Juan Díaz",       "lat": 9.0200,  "lon": -79.4600},
    {"zona": "El Dorado",       "lat": 9.0500,  "lon": -79.5100},
    {"zona": "Parque Lefevre",  "lat": 9.0280,  "lon": -79.4900},
    {"zona": "Pueblo Nuevo",    "lat": 9.0100,  "lon": -79.5000},
    {"zona": "Calidonia",       "lat": 8.9950,  "lon": -79.5180},
    {"zona": "El Chorrillo",    "lat": 8.9870,  "lon": -79.5290},
    {"zona": "Santa Ana",       "lat": 8.9930,  "lon": -79.5310},
    {"zona": "San Miguelito",   "lat": 9.0530,  "lon": -79.4750},
    {"zona": "Mañanitas",       "lat": 9.0800,  "lon": -79.4650},
    {"zona": "Tocumen",         "lat": 9.0750,  "lon": -79.3960},
    {"zona": "Las Mañanitas",   "lat": 9.0850,  "lon": -79.4000},
    {"zona": "Las Cumbres",     "lat": 9.1200,  "lon": -79.4800},
    {"zona": "Pedregal",        "lat": 9.0520,  "lon": -79.4430},
    {"zona": "Don Bosco",       "lat": 9.0280,  "lon": -79.4580},
    {"zona": "Chilibre",        "lat": 9.1900,  "lon": -79.6100},
    {"zona": "Ancón",           "lat": 8.9750,  "lon": -79.5550},
    {"zona": "Curundú",         "lat": 8.9980,  "lon": -79.5400},
    {"zona": "Río Congo",       "lat": 9.0650,  "lon": -79.5200},
    {"zona": "Las Acacias",     "lat": 9.0120,  "lon": -79.5150},
    {"zona": "Punta Pacífica",  "lat": 8.9820,  "lon": -79.5080},
    {"zona": "Costa del Este",  "lat": 9.0080,  "lon": -79.4650},
]

latencias_mqtt = []
lock = threading.Lock()

def crear_cliente(nombre):
    """Crea un cliente MQTT con TLS — igual que el servidor."""
    client = mqtt.Client(
        client_id=f"prueba_{nombre.replace(' ','_')}_{random.randint(1000,9999)}",
        protocol=mqtt.MQTTv311
    )
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.tls_set()  # TLS requerido por HiveMQ Cloud
    return client

def generar_db(zona_nombre):
    zonas_trafico = ["Juan Díaz", "San Miguelito", "Tocumen", "El Chorrillo"]
    zonas_mixtas  = ["San Francisco", "Bella Vista", "El Dorado", "Calidonia"]

    if zona_nombre in zonas_trafico:
        return round(random.uniform(62, 78), 1)   # Alerta / máximo
    elif zona_nombre in zonas_mixtas:
        return round(random.uniform(52, 67), 1)   # Moderado / promedio
    else:
        return round(random.uniform(38, 58), 1)   # Normal / mínimo

def publicar_nodo(zona_data, n_mensajes=3, intervalo=1):
    try:
        client = crear_cliente(zona_data["zona"])
        client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
        client.loop_start()
        time.sleep(0.5)  # esperar conexión TLS

        topic = f"{TOPIC_BASE}/{zona_data['zona'].lower().replace(' ', '_')}"

        for _ in range(n_mensajes):
            db = generar_db(zona_data["zona"])
            payload = {
                "zona":      zona_data["zona"],
                "db":        db,
                "lat":       zona_data["lat"],
                "lon":       zona_data["lon"],
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "alerta":    db > 65
            }

            t_inicio = time.time()
            result = client.publish(topic, json.dumps(payload), qos=1)
            result.wait_for_publish()
            latencia_ms = (time.time() - t_inicio) * 1000

            with lock:
                latencias_mqtt.append(latencia_ms)

            estado = "⚠️ ALERTA" if db > 65 else ("🟡 MOD" if db > 55 else "🟢 OK")
            print(f"  [{zona_data['zona']:20s}] {db:5.1f} dB  {latencia_ms:6.0f} ms  {estado}")
            time.sleep(intervalo)

        client.loop_stop()
        client.disconnect()

    except Exception as e:
        print(f"  ❌ Error en nodo {zona_data['zona']}: {e}")

def prueba_carga(n_nodos, label):
    """Lanza N nodos en paralelo y mide latencia agregada."""
    print(f"\n{'═'*60}")
    print(f"  PRUEBA: {label}")
    print(f"{'═'*60}")

    zonas_seleccionadas = ZONAS[:n_nodos]
    latencias_mqtt.clear()

    hilos = [threading.Thread(target=publicar_nodo, args=(z, 3, 1))
             for z in zonas_seleccionadas]

    t_inicio = time.time()
    for h in hilos: h.start()
    for h in hilos: h.join()
    duracion = time.time() - t_inicio

    if latencias_mqtt:
        prom = statistics.mean(latencias_mqtt)
        print(f"\n  Resultados:")
        print(f"     Mensajes enviados : {len(latencias_mqtt)}")
        print(f"     Latencia promedio : {prom:.1f} ms")
        print(f"     Latencia mínima   : {min(latencias_mqtt):.1f} ms")
        print(f"     Latencia máxima   : {max(latencias_mqtt):.1f} ms")
        print(f"     Latencia mediana  : {statistics.median(latencias_mqtt):.1f} ms")
        print(f"     Duración total    : {duracion:.1f} s")
        print(f"     Meta < 500 ms     : {'✅ CUMPLE' if prom < 500 else '❌ NO CUMPLE'}")
        return {
            "label": label, "nodos": n_nodos,
            "promedio_ms": round(prom, 1),
            "max_ms": round(max(latencias_mqtt), 1),
            "mensajes": len(latencias_mqtt),
            "cumple": prom < 500
        }
    return None

def prueba_alertas():
    """Publica valores >65 dB — deben aparecer en rojo en el dashboard."""
    print(f"\n{'═'*60}")
    print("  PRUEBA DE ALERTAS OMS — valores que superan 65 dB")
    print(f"{'═'*60}")
    print("  → Verificar en dashboard: nodo rojo + log de alerta\n")

    try:
        client = crear_cliente("alertas")
        client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
        client.loop_start()
        time.sleep(0.5)

        casos = [
            ("Juan Díaz",     72.5, 9.0200, -79.4600),
            ("San Miguelito", 68.3, 9.0530, -79.4750),
            ("Tocumen",       71.8, 9.0750, -79.3960),
        ]

        for zona, db, lat, lon in casos:
            topic = f"{TOPIC_BASE}/{zona.lower().replace(' ', '_')}"
            payload = {
                "zona": zona, "db": db,
                "lat": lat, "lon": lon,
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "alerta": True
            }
            result = client.publish(topic, json.dumps(payload), qos=1)
            result.wait_for_publish()
            print(f"  ⚠️  {zona}: {db} dB publicado")
            time.sleep(2)

        client.loop_stop()
        client.disconnect()

    except Exception as e:
        print(f"  ❌ Error en prueba de alertas: {e}")

def prueba_nodo_inactivo():
    print(f"\n{'═'*60}")
    print("  PRUEBA: Nodo inactivo (desaparece tras 5 min sin datos)")
    print(f"{'═'*60}")

    try:
        client = crear_cliente("inactivo")
        client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
        client.loop_start()
        time.sleep(0.5)

        topic = f"{TOPIC_BASE}/zona_test_inactivo"
        payload = {
            "zona": "Zona Test Inactivo", "db": 44.0,
            "lat": 9.05, "lon": -79.50,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "alerta": False
        }
        result = client.publish(topic, json.dumps(payload), qos=1)
        result.wait_for_publish()
        print("  Nodo publicado — debe aparecer en el mapa.")

        client.loop_stop()
        client.disconnect()

    except Exception as e:
        print(f"  ❌ Error: {e}")

# MAIN
if __name__ == "__main__":
    input("   Pruebas. Presiona ENTER para continuar.")

    resultados = []

    # Prueba mínimo: 10 nodos
    r = prueba_carga(10, "MÍNIMO — 10 nodos concurrentes")
    if r: resultados.append(r)
    time.sleep(5)

    # Prueba promedio: 25 nodos
    r = prueba_carga(25, "PROMEDIO — 25 nodos concurrentes")
    if r: resultados.append(r)
    time.sleep(5)

    # Prueba máximo: 50 nodos (usa los 25 disponibles repetidos si hacen falta)
    zonas_50 = (ZONAS * 2)[:50]

    # Añadir sufijo para que sean zonas únicas
    for i, z in enumerate(zonas_50[len(ZONAS):]):
        zonas_50[len(ZONAS) + i] = {**z, "zona": z["zona"] + " B"}
    ZONAS_BACKUP = ZONAS.copy()

    import types
    latencias_mqtt.clear()
    print(f"\n{'═'*60}")
    print("  PRUEBA: MÁXIMO — 50 nodos concurrentes")
    print(f"{'═'*60}")
    hilos = [threading.Thread(target=publicar_nodo, args=(z, 3, 1)) for z in zonas_50]
    t0 = time.time()
    for h in hilos: h.start()
    for h in hilos: h.join()
    dur = time.time() - t0
    if latencias_mqtt:
        prom = statistics.mean(latencias_mqtt)
        print(f"\n  Resultados:")
        print(f"     Mensajes enviados : {len(latencias_mqtt)}")
        print(f"     Latencia promedio : {prom:.1f} ms")
        print(f"     Latencia mínima   : {min(latencias_mqtt):.1f} ms")
        print(f"     Latencia máxima   : {max(latencias_mqtt):.1f} ms")
        print(f"     Duración total    : {dur:.1f} s")
        print(f"     Meta < 500 ms     : {'✅ CUMPLE' if prom < 500 else '❌ NO CUMPLE'}")
        resultados.append({
            "label": "MÁXIMO — 50 nodos", "nodos": 50,
            "promedio_ms": round(prom, 1), "max_ms": round(max(latencias_mqtt), 1),
            "mensajes": len(latencias_mqtt), "cumple": prom < 500
        })
    time.sleep(5)

    # Prueba alertas
    prueba_alertas()
    time.sleep(5)

    # Prueba nodo inactivo
    prueba_nodo_inactivo()

    # Resumen final
    print(f"\n{'═'*60}")
    print("  RESUMEN FINAL — Métricas del proyecto")
    print(f"{'═'*60}")
    print(f"  {'Escenario':<30} {'Latencia prom':>14} {'Máxima':>10} {'Meta':>8}")
    print(f"  {'-'*65}")
    for r in resultados:
        cumple = "✅" if r["cumple"] else "❌"
        print(f"  {r['label']:<30} {r['promedio_ms']:>11.1f} ms {r['max_ms']:>7.1f} ms  {cumple}")

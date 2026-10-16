# Costos y region (AC-09.4, AC-09.5)

Presupuesto: alerta de USD 10/mes (50, 90, 100 %) creada por `scripts/gcp-setup.ps1`. Una alerta avisa, no corta el gasto.

## Costo en reposo
Cloud Run con `min-instances=0` no cobra CPU ni memoria sin trafico: **USD 0** en reposo; tras un periodo sin uso GCP muestra 0 instancias activas. Firebase Hosting, Firestore (solo contadores) y Secret Manager (4 secretos, 1 version cada uno) caben en capas gratuitas o centavos. Artifact Registry cobra almacenamiento de imagenes (unos centavos al mes). **Estimado en reposo: menos de USD 1/mes.**

## Costo por 1.000 preguntas
Supuesto (mio, no medido): una pregunta = 1 conexion de ~20 s de Cloud Run con 1 vCPU y 512 MiB, ~10 lecturas/escrituras de Firestore.
- Cloud Run: 1.000 x 20 s = 20.000 vCPU-s y 10.000 GiB-s, dentro de la capa gratuita mensual (180.000 vCPU-s, 360.000 GiB-s; cifras de memoria de https://cloud.google.com/run/pricing, NO verificadas hoy). Costo marginal: ~USD 0.
- Firestore: ~10.000 operaciones, dentro de la cuota gratuita diaria (50.000 lecturas / 20.000 escrituras por dia; https://firebase.google.com/pricing, no verificado hoy): USD 0.
- Hosting: transferencia dentro de la capa gratuita (10 GB/mes segun la misma pagina, no verificado).
- Costo dominante: DeepSeek/Deepgram (fuera de GCP). Sus tarifas no se verificaron; medir con la telemetria antes de prometer una cifra.

**Estimado GCP por 1.000 preguntas: ~USD 0 mientras se este en capa gratuita; USD 0,5 a 2 si se excede (rango conservador, no calculado con precios verificados).**

## Region: decision
Mediciones reales (5 muestras c/u, curl desde la maquina del dueno, 2026-10-16, a `https://<region>-run.googleapis.com/`, solo lectura):

| Region | conexion TCP | tiempo total |
|---|---|---|
| us-east1 | 32-117 ms | 338-553 ms (mediana ~520 ms) |
| southamerica-east1 | 25-145 ms | 1109-1252 ms (mediana ~1125 ms) |

Limites: es el endpoint de la API de Cloud Run, no un servicio propio; la conexion TCP llega a un borde de Google cercano en ambos casos, y el total incluye el trabajo del endpoint. Se repetira con el servicio real (`/health`) tras el primer despliegue.

**Decision: `us-east1`**, la mas rapida en esta medicion y, segun mi conocimiento (no verificado hoy), con tarifas de Cloud Run de nivel 1, mas baratas que las de Sao Paulo (nivel 2). Reconsiderar si la medicion con `/health` real contradice esto.

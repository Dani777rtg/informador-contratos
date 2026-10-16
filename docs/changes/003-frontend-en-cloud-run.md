# Cambio 003: el frontend se sirve desde Cloud Run (sin Firebase Hosting)

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

## Motivo

Publicar en Firebase Hosting exige añadir Firebase al proyecto con un inicio de sesión que el dueño no quiere hacer ("¿no lo tenemos con Cloud Run?"). Todo queda en Cloud Run: el mismo servicio sirve la página estática y la API desde un solo origen (sin CORS entre dominios). Contra aceptado: la primera visita tras inactividad espera el arranque en frío antes de ver la página (min-instances=0 se mantiene por costo).

## Delta

| Parte | Agrega | Modifica | Quita |
|---|---|---|---|
| Spec | — | Plataforma y decisión "Frontend estático ... en Firebase Hosting" → "Frontend estático servido por el mismo servicio de Cloud Run (un solo origen)". AC-09.2: "servir el frontend estático y el backend desde el mismo servicio de Cloud Run con min-instances=0, ..." Diagrama de diseño sin Firebase. | Firebase Hosting de AC-09.2, Plataforma y Decisiones |
| Pruebas de aceptación | — | tests/acceptance/us-09.deploy.test.ts AC-09.2 "el frontend se publica con Firebase Hosting" → el frontend se construye en la imagen y el servidor lo sirve (Dockerfile construye web/dist; server sirve estáticos en `/`) | aserciones de firebase.json / `firebase deploy` |
| Código | server sirve web/dist con caché larga para /assets; Dockerfile construye el front con VITE_API_URL vacío (mismo origen); CSP de server/headers.ts compatible con el bundle (script 'self', worker blob: para el AudioWorklet) | scripts/deploy.ps1 sin Firebase; ALLOWED_ORIGINS = URL del servicio | firebase.json, .firebaserc |

## Impacto

- Tareas a rehacer: T013 (despliegue).
- Plazo: +30 min.
- Riesgos nuevos: primera carga más lenta tras inactividad (arranque en frío); se mitiga con imagen pequeña y startup CPU boost.
- Archivos a abrir para edición: docs/spec.md, tests/acceptance/us-09.deploy.test.ts.

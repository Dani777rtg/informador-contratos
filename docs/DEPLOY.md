# Despliegue

Proyecto GCP `informador-contratos-1016`, región `us-east1`. Cada comando de `scripts/deploy.ps1` lleva `--project` explícito; nunca se usa `gcloud config set project`.

## Pasos
1. `scripts/gcp-setup.ps1` (una vez): proyecto, facturación, presupuesto, secretos.
2. `pwsh scripts/deploy.ps1`: Cloud Build -> Cloud Run (min-instances 0, max 5, CPU boost, timeout 3600 s, público HTTPS, 5 secretos de Secret Manager, `NODE_ENV=production`, sin `MOCK_EXTERNALS`) con `--no-traffic`.
3. Revisión previa: probar la URL de la revisión nueva (`/health`) antes de aprobar.
4. Aprobación: el script pide escribir SI (o `-Approve`); solo el dueño aprueba producción. Sin aprobación la revisión queda sin tráfico.
5. El front se construye en el Dockerfile (`npm run build:web`) y lo sirve el mismo servicio: un solo origen, `VITE_API_URL` vacío. Tras el primer deploy el script fija `ALLOWED_ORIGINS` = URL del servicio. Staging es público (sin auth), igual que producción.

## Rollback
El script imprime la revisión anterior. Para volver a ella:

    gcloud run services update-traffic informador --project informador-contratos-1016 --region us-east1 --to-revisions=<anterior>=100


## Región
Decisión y mediciones (ms) en `docs/COSTOS.md`: us-east1 vs southamerica-east1.


## Staging (fase Verify)

Proyecto `informador-contratos-1016`, región `us-east1`. Producción (`informador`, canal live de Hosting) NO se ha desplegado: es la fase Ship, con aprobación del dueño.

### Hecho
- Cuenta de servicio de ejecución dedicada `informador-run@informador-contratos-1016.iam.gserviceaccount.com` con `roles/secretmanager.secretAccessor` sobre los 5 secretos y `roles/datastore.user` (nada más). `scripts/deploy.ps1` lo crea/aplica de forma idempotente.
- Cloud Build de la imagen: OK (47 s). Servicio `informador-staging`: min 0, max 2, cpu-boost, timeout 3600, público, 5 secretos, `NODE_ENV=production`, `DEEPSEEK_MODEL=deepseek-flash`, variables WhatsApp desde `.env`.
- URL de la API de staging: https://informador-staging-772597157596.us-east1.run.app
- Despliegue: `pwsh scripts/deploy.ps1 -Staging`.

### Humo contra staging (todo OK)
- `GET /health` 200 `{"ok":true}`; cabeceras CSP, HSTS, nosniff, referrer-policy, permissions-policy presentes.
- `POST /api/chat` "¿Qué contratos tiene el NIT 890399011?" 200 con tarjetas de contratos reales (0,6 s).
- `OPTIONS /api/chat`: origen permitido recibe `access-control-allow-origin`; `https://evil.example` no.
- `POST /session`: origen permitido 200 con token; origen no permitido 403.
- Escala a cero: `container/instance_count` activo e inactivo en 0 tras ~7 min sin tráfico.
- Rollback ensayado: `update-traffic --to-revisions=<anterior>=100` 6,6 s; restaurar `--to-latest` 8,4 s. Sin base propia que restaurar aparte de Firestore (solo caché WhatsApp/estado efímero); no se hizo restauración.

### Rollback de staging
    gcloud run services update-traffic informador-staging --project informador-contratos-1016 --region us-east1 --to-revisions=<revisión anterior>=100
Revisión conocida buena: `informador-staging-00002-4wg`.

## Producción (v0.1.0, 2026-10-16)
- URL: https://informador-253t4zbriq-ue.a.run.app (servicio `informador`, us-east1, proyecto informador-contratos-1016). Revisión servida: `informador-00002-vs4` (la 00001 fue el primer despliegue; el script corrigió ALLOWED_ORIGINS a la URL pública en la 00002).
- Config verificada: NODE_ENV=production, ALLOWED_ORIGINS = URL pública, sin MOCK_EXTERNALS, 5 secretos, SA informador-run, min 0 / max 5, cpu-boost, timeout 3600.
- Humo OK: GET / 200 con CSP y cabeceras; /health 200; /api/chat (NIT, Gobernación de Antioquia, "robo" -> rechazo) 200; /session 200 con Origin propio y 403 con ajeno; WS /voice abre con token.
- Tiempos: /health caliente ~0,2 s; chat 0,3-0,6 s; primera petición tras ~17 min sin tráfico 0,43 s (no se confirmó que la instancia hubiera llegado a 0).
- Canario 16 min: /health 200 cada minuto (0,21-0,46 s), 0 errores en logs.
- `informador-staging` eliminado.
- Rollback: `gcloud run services update-traffic informador --project informador-contratos-1016 --region us-east1 --to-revisions informador-00001-<sufijo>=100` (listar con `gcloud run revisions list`).

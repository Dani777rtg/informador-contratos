# Despliegue

Proyecto GCP `informador-contratos-1016`, región `us-east1`. Cada comando de `scripts/deploy.ps1` lleva `--project` explícito; nunca se usa `gcloud config set project`.

## Pasos
1. `scripts/gcp-setup.ps1` (una vez): proyecto, facturación, presupuesto, secretos.
2. `pwsh scripts/deploy.ps1`: Cloud Build -> Cloud Run (min-instances 0, max 5, CPU boost, timeout 3600 s, público HTTPS, 5 secretos de Secret Manager, `NODE_ENV=production`, sin `MOCK_EXTERNALS`) con `--no-traffic`.
3. Revisión previa: probar la URL de la revisión nueva (`/health`) antes de aprobar.
4. Aprobación: el script pide escribir SI (o `-Approve`); solo el dueño aprueba producción. Sin aprobación la revisión queda sin tráfico.
5. Frontend: `npm run build:web` con `VITE_API_URL` = URL de Cloud Run y `firebase deploy --only hosting`.

## Rollback
El script imprime la revisión anterior. Para volver a ella:

    gcloud run services update-traffic informador --project informador-contratos-1016 --region us-east1 --to-revisions=<anterior>=100

Hosting: `firebase hosting:rollback --project informador-contratos-1016`.

## Región
Decisión y mediciones (ms) en `docs/COSTOS.md`: us-east1 vs southamerica-east1.

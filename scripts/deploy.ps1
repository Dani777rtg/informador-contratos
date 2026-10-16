# Despliegue: Cloud Build -> Cloud Run (sin tráfico) -> aprobación -> tráfico -> Firebase Hosting.
# No modifica el proyecto activo global de gcloud: cada comando fija --project.
param([switch]$Approve)
$ErrorActionPreference = 'Stop'
$Project = 'informador-contratos-1016'
$Region = 'us-east1'
$Service = 'informador'
$Image = "$Region-docker.pkg.dev/$Project/app/${Service}:$(Get-Date -Format yyyyMMdd-HHmmss)"
$HostingUrl = "https://$Project.web.app"

gcloud builds submit --tag $Image --project $Project
if ($LASTEXITCODE) { throw 'build falló' }

$prev = gcloud run services describe $Service --project $Project --region $Region --format 'value(status.latestReadyRevision)' 2>$null
Write-Host "Revisión anterior (para rollback): $prev"

gcloud run deploy $Service --project $Project --region $Region --image $Image `
  --min-instances 0 --max-instances 5 --cpu-boost --timeout 3600 --allow-unauthenticated --no-traffic `
  --set-secrets 'DEEPSEEK_API_KEY=DEEPSEEK_API_KEY:latest,DEEPGRAM_API_KEY=DEEPGRAM_API_KEY:latest,DATOSGOV_APP_TOKEN=DATOSGOV_APP_TOKEN:latest,WHATSAPP_ACCESS_TOKEN=WHATSAPP_ACCESS_TOKEN:latest,HMAC_SECRET=HMAC_SECRET:latest' `
  --set-env-vars "NODE_ENV=production,ALLOWED_ORIGINS=$HostingUrl"
if ($LASTEXITCODE) { throw 'deploy falló' }

# Producción solo con aprobación explícita del dueño.
if (-not $Approve) {
  $a = Read-Host "Revisión nueva sin tráfico. Escribe SI para enviarle el 100% del tráfico (producción)"
  if ($a -ne 'SI') { Write-Host 'Cancelado: la revisión nueva no recibe tráfico.'; exit 1 }
}
gcloud run services update-traffic $Service --project $Project --region $Region --to-latest
if ($LASTEXITCODE) { throw 'update-traffic falló' }

$api = gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)'
$env:VITE_API_URL = $api
npm run build:web
if ($LASTEXITCODE) { throw 'build:web falló' }
if (Get-Command firebase -ErrorAction SilentlyContinue) { firebase deploy --only hosting --project $Project } else { npx firebase-tools deploy --only hosting --project $Project }

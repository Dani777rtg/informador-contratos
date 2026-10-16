# Despliegue: Cloud Build -> Cloud Run (un solo servicio sirve front y API).
#   pwsh scripts/deploy.ps1 -Staging     servicio informador-staging + sin aprobación; público (sin auth) como producción, es un prototipo
#   pwsh scripts/deploy.ps1              producción: revisión sin tráfico -> aprobación del dueño -> tráfico
# No modifica el proyecto activo global de gcloud: cada comando fija --project.
#   pwsh scripts/deploy.ps1 -MinInstances 1   demo: una instancia siempre encendida (sin arranque en frío, con costo diario: docs/COSTOS.md); luego volver a 0 con -MinInstances 0
#   (staging siempre usa 0)
param([switch]$Approve, [switch]$Staging, [ValidateSet(0, 1)][int]$MinInstances = 0)
$ErrorActionPreference = 'Continue' # el progreso va por stderr; los fallos se detectan con $LASTEXITCODE
$Project = 'informador-contratos-1016'
$Region = 'us-east1'
$Service = if ($Staging) { 'informador-staging' } else { 'informador' }
$Sa = "informador-run@$Project.iam.gserviceaccount.com"
$Secrets = 'DEEPSEEK_API_KEY','DEEPGRAM_API_KEY','DATOSGOV_APP_TOKEN','WHATSAPP_ACCESS_TOKEN','HMAC_SECRET'
$Image = "$Region-docker.pkg.dev/$Project/app/${Service}:$(Get-Date -Format yyyyMMdd-HHmmss)"

# Variables no secretas desde .env (sin imprimirlas) si el entorno no las trae.
if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*(WHATSAPP_API_VERSION|WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_BUSINESS_ACCOUNT_ID|DEEPSEEK_MODEL)=(.*)$' -and -not (Get-Item "env:$($Matches[1])" -ErrorAction SilentlyContinue)) {
      Set-Item "env:$($Matches[1])" $Matches[2].Trim().Trim('"', "'")
    }
  }
}

# Cuenta de servicio de ejecución con roles mínimos (idempotente).
if (-not (gcloud iam service-accounts list --project $Project --filter "email=$Sa" --format 'value(email)')) {
  gcloud iam service-accounts create informador-run --display-name 'Informador Cloud Run runtime' --project $Project
  if ($LASTEXITCODE) { throw 'crear cuenta de servicio falló' }
}
foreach ($s in $Secrets) {
  gcloud secrets add-iam-policy-binding $s --project $Project --member "serviceAccount:$Sa" --role roles/secretmanager.secretAccessor --condition=None --quiet | Out-Null
  if ($LASTEXITCODE) { throw "IAM $s falló" }
}
gcloud projects add-iam-policy-binding $Project --member "serviceAccount:$Sa" --role roles/datastore.user --condition=None --quiet | Out-Null
if ($LASTEXITCODE) { throw 'IAM datastore falló' }

gcloud builds submit --tag $Image --project $Project --region $Region
if ($LASTEXITCODE) { throw 'build falló' }

# Mismo origen: ALLOWED_ORIGINS = URL del propio servicio. Si ya existe se reutiliza; en el primer deploy se corrige abajo.
$Origins = gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)' 2>$null
if (-not $Origins) { $Origins = "https://$Service.invalid" }

$prev = gcloud run services describe $Service --project $Project --region $Region --format 'value(status.latestReadyRevision)' 2>$null
Write-Host "Revisión anterior (para rollback): $prev"

$SecretMap = ($Secrets | ForEach-Object { "$_=${_}:latest" }) -join ','
$Model = if ($env:DEEPSEEK_MODEL) { $env:DEEPSEEK_MODEL } else { 'deepseek-flash' }
$EnvVars = "^|^NODE_ENV=production|ALLOWED_ORIGINS=$Origins|GOOGLE_CLOUD_PROJECT=$Project|DEEPSEEK_MODEL=$Model|WHATSAPP_API_VERSION=$env:WHATSAPP_API_VERSION|WHATSAPP_PHONE_NUMBER_ID=$env:WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_BUSINESS_ACCOUNT_ID=$env:WHATSAPP_BUSINESS_ACCOUNT_ID"
# --no-traffic solo es válido si el servicio ya existe (el primer despliegue recibe tráfico por fuerza).
$NoTraffic = if (-not $Staging -and $prev) { @('--no-traffic') } else { @() }
if ($Staging) {
gcloud run deploy $Service --project $Project --region $Region --image $Image --service-account $Sa --min-instances 0 --max-instances 2 --cpu-boost --session-affinity --timeout 3600 --allow-unauthenticated --set-secrets $SecretMap --set-env-vars $EnvVars @NoTraffic
} else {
gcloud run deploy $Service --project $Project --region $Region --image $Image --service-account $Sa --min-instances $MinInstances --max-instances 5 --cpu-boost --session-affinity --timeout 3600 --allow-unauthenticated --set-secrets $SecretMap --set-env-vars $EnvVars @NoTraffic
}
if ($LASTEXITCODE) { throw 'deploy falló' }

if (-not $Staging) {
  # Producción solo con aprobación explícita del dueño.
  if ($prev) {
    if (-not $Approve) {
      $a = Read-Host "Revisión nueva sin tráfico. Escribe SI para enviarle el 100% del tráfico (producción)"
      if ($a -ne 'SI') { Write-Host 'Cancelado: la revisión nueva no recibe tráfico.'; exit 1 }
    }
    gcloud run services update-traffic $Service --project $Project --region $Region --to-latest
    if ($LASTEXITCODE) { throw 'update-traffic falló' }
  }
}

$api = gcloud run services describe $Service --project $Project --region $Region --format 'value(status.url)'
if ($api -ne $Origins) {
  gcloud run services update $Service --project $Project --region $Region --update-env-vars "^|^ALLOWED_ORIGINS=$api"
  if ($LASTEXITCODE) { throw 'update ALLOWED_ORIGINS falló' }
}
Write-Host "App (front + API): $api"
if (-not $Staging -and $MinInstances -gt 0) { Write-Host "AVISO: min-instances=$MinInstances cuesta mientras esté encendido. Al terminar el demo: pwsh scripts/deploy.ps1 -MinInstances 0 (ver docs/COSTOS.md)." }

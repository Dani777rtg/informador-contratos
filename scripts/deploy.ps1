# Despliegue: Cloud Build -> Cloud Run -> Firebase Hosting.
#   pwsh scripts/deploy.ps1 -Staging     servicio informador-staging + canal de vista previa "staging" (sin aprobación)
#   pwsh scripts/deploy.ps1              producción: revisión sin tráfico -> aprobación del dueño -> tráfico -> Hosting live
# No modifica el proyecto activo global de gcloud: cada comando fija --project.
param([switch]$Approve, [switch]$Staging)
$ErrorActionPreference = 'Continue' # el progreso va por stderr; los fallos se detectan con $LASTEXITCODE
$Project = 'informador-contratos-1016'
$Region = 'us-east1'
$Service = if ($Staging) { 'informador-staging' } else { 'informador' }
$Sa = "informador-run@$Project.iam.gserviceaccount.com"
$Secrets = 'DEEPSEEK_API_KEY','DEEPGRAM_API_KEY','DATOSGOV_APP_TOKEN','WHATSAPP_ACCESS_TOKEN','HMAC_SECRET'
$Image = "$Region-docker.pkg.dev/$Project/app/${Service}:$(Get-Date -Format yyyyMMdd-HHmmss)"
function firebase { npx --yes firebase-tools @args } # $Project se pasa en cada llamada

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

# Orígenes: producción = dominio live; staging arranca igual y se corrige con la URL del canal tras desplegarlo.
$Origins = "https://$Project.web.app"

$prev = gcloud run services describe $Service --project $Project --region $Region --format 'value(status.latestReadyRevision)' 2>$null
Write-Host "Revisión anterior (para rollback): $prev"

$SecretMap = ($Secrets | ForEach-Object { "$_=${_}:latest" }) -join ','
$Model = if ($env:DEEPSEEK_MODEL) { $env:DEEPSEEK_MODEL } else { 'deepseek-flash' }
$EnvVars = "^|^NODE_ENV=production|ALLOWED_ORIGINS=$Origins|GOOGLE_CLOUD_PROJECT=$Project|DEEPSEEK_MODEL=$Model|WHATSAPP_API_VERSION=$env:WHATSAPP_API_VERSION|WHATSAPP_PHONE_NUMBER_ID=$env:WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_BUSINESS_ACCOUNT_ID=$env:WHATSAPP_BUSINESS_ACCOUNT_ID"
# --no-traffic solo es válido si el servicio ya existe (el primer despliegue recibe tráfico por fuerza).
$NoTraffic = if (-not $Staging -and $prev) { @('--no-traffic') } else { @() }
if ($Staging) {
gcloud run deploy $Service --project $Project --region $Region --image $Image --service-account $Sa --min-instances 0 --max-instances 2 --cpu-boost --timeout 3600 --allow-unauthenticated --set-secrets $SecretMap --set-env-vars $EnvVars @NoTraffic
} else {
gcloud run deploy $Service --project $Project --region $Region --image $Image --service-account $Sa --min-instances 0 --max-instances 5 --cpu-boost --timeout 3600 --allow-unauthenticated --set-secrets $SecretMap --set-env-vars $EnvVars @NoTraffic
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
$env:VITE_API_URL = $api
npm run build:web
if ($LASTEXITCODE) { throw 'build:web falló' }
if ($Staging) {
  $out = firebase hosting:channel:deploy staging --project $Project --expires 30d --json | ConvertFrom-Json
  $web = $out.result.$Project.url
  if (-not $web) { throw 'hosting:channel:deploy no devolvió URL (¿firebase login?)' }
  Write-Host "Frontend staging: $web"
  gcloud run services update $Service --project $Project --region $Region --update-env-vars "^|^ALLOWED_ORIGINS=$web"
  if ($LASTEXITCODE) { throw 'update ALLOWED_ORIGINS falló' }
} else {
  firebase deploy --only hosting --project $Project
}
Write-Host "API: $api"

# Crea la infraestructura GCP NUEVA y dedicada (AC-09.1, AC-09.4).
# NO ejecutar sin aprobacion del dueno: crea proyecto, vincula facturacion y genera recursos.
# Nunca cambia el proyecto activo global de gcloud: todo lleva --project explicito.
param(
  [string]$Project = "informador-contratos-1016-$(-join ((48..57 + 97..122) | Get-Random -Count 5 | ForEach-Object { [char]$_ }))",
  [string]$Billing = "01EE60-CCE2B7-BE4593",
  [string]$Region = "us-east1",   # decision en docs/COSTOS.md (AC-09.5)
  [int]$BudgetUsd = 10,
  [string]$EnvFile = ".env",
  # Secretos que se cargan desde .env (los ausentes se omiten).
  [string[]]$SecretNames = @("DEEPSEEK_API_KEY", "DEEPGRAM_API_KEY", "DATOSGOV_APP_TOKEN", "WHATSAPP_ACCESS_TOKEN", "HMAC_SECRET")
)
$ErrorActionPreference = "Stop"
function Gc { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args -join ' ') fallo" } }

Write-Host "Proyecto: $Project  Region: $Region  Facturacion: $Billing"
Gc projects create $Project --name="Informador de Contratos"
Gc billing projects link $Project --billing-account=$Billing
Gc services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com `
  secretmanager.googleapis.com firestore.googleapis.com firebase.googleapis.com `
  billingbudgets.googleapis.com cloudresourcemanager.googleapis.com --project=$Project
Gc firestore databases create --location=$Region --type=firestore-native --project=$Project
Gc artifacts repositories create app --repository-format=docker --location=$Region --project=$Project

# Secretos: el valor se lee del .env y se pasa por stdin; nunca se imprime ni se guarda.
$vals = @{}
Get-Content $EnvFile | ForEach-Object { if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $vals[$Matches[1]] = $Matches[2].Trim('"', "'") } }
# HMAC_SECRET no vive en .env: se genera aleatorio si falta.
if (-not $vals["HMAC_SECRET"]) { $vals["HMAC_SECRET"] = [Convert]::ToBase64String((1..48 | ForEach-Object { [byte](Get-Random -Max 256) })) }
foreach ($n in $SecretNames) {
  if (-not $vals[$n]) { Write-Host "Sin valor para $n en ${EnvFile}: omitido"; continue }
  Gc secrets create $n --replication-policy=automatic --project=$Project
  # Archivo temporal sin salto de linea final (el pipe de PowerShell agregaria uno).
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $vals[$n])
    & gcloud secrets versions add $n --data-file=$tmp --project=$Project
    if ($LASTEXITCODE -ne 0) { throw "no se pudo cargar $n" }
  } finally { Remove-Item $tmp -Force }
}
$vals.Clear()

# Presupuesto con alertas al 50, 90 y 100 %.
Gc billing budgets create --billing-account=$Billing --display-name="informador-$Project" `
  --budget-amount="${BudgetUsd}USD" --filter-projects="projects/$Project" `
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0

Write-Host "Listo. Verificar: gcloud billing projects describe $Project ; gcloud billing budgets list --billing-account=$Billing"

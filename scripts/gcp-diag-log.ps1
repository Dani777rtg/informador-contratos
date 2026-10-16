# Registro de diagnóstico (TM-17): bucket con retención de 1 día, sink del log `diag` y exclusión en _Default.
# No se ejecuta solo: lo corre el dueño una vez. Idempotente salvo el aviso "ya existe".
$Project = 'informador-contratos-1016'
$Bucket = 'diag'
$Filter = 'jsonPayload.log="diag"'

gcloud logging buckets create $Bucket --project $Project --location global --retention-days 1 --description 'Diagnostico del dueno, 24 h'
gcloud logging sinks create diag "logging.googleapis.com/projects/$Project/locations/global/buckets/$Bucket" --project $Project --log-filter $Filter
# Sin esta exclusión el mismo texto quedaría 30 días en _Default.
gcloud logging sinks update _Default --project $Project --add-exclusion "name=excluir-diag,filter=$Filter"

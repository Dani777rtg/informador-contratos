# Cambios

## Sin publicar (cambio 006, T023)
- Herramientas exploratorias (gasto_total, gasto_por_categoria, top_entidades, top_contratistas, contratos_mayores, buscar_contratos, detalle_contrato) por municipio, departamento, entidad, tema y periodo, sin exigir NIT; coincidencia aproximada de lugares y entidades; ampliacion al departamento.
- Presupuesto de 6,5 s con 1 reintento y respaldo comprimido (
pm run snapshot genera server/fallback/snapshot.json.gz, solo lectura, sin documentos de personas naturales).
- Montos: texto $2.700 millones de pesos, tarjeta con valor exacto y COP. El log por turno suma intencion, ruta, herramientas, codigo de declinacion, tipo de error y motivo de cierre.
- Arranque en frío: la lista de municipios responde al instante con la del respaldo y la viva carga en segundo plano (`/health` y el arranque la precalientan); la imagen corre JavaScript compilado (`npm run build:server`).
- Texto con cifras ("$804.000 millones de pesos") y voz con palabras; los montos grandes llegan a la voz en palabras exactas (corrige "billones" por "mil millones").
- Voz: prompt más corto, calentamiento de datos.gov.co mientras el modelo decide, `DEEPSEEK_VOICE_MODEL`, `VOICE_TRACE=1` (ver docs/VOZ.md).
- "¿Y en Antioquia?" repite la herramienta del turno anterior; "Caldas"/"Nariño" a secas son el departamento; contratistas y entidades duplicados por nombre se suman; la categoría "Otro" ya no encabeza el gasto.

## 0.1.0 - 2026-10-16
- Primera versión: asistente de consulta de contratos públicos (SECOP II, datos.gov.co) por texto, voz y WhatsApp.
- Sustitutos locales (`MOCK_EXTERNALS=1`), evaluación (`npm run eval`), prueba de carga local y despliegue en Cloud Run.

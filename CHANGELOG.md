# Cambios

## Sin publicar (cambio 006, T023)
- Herramientas exploratorias (gasto_total, gasto_por_categoria, top_entidades, top_contratistas, contratos_mayores, buscar_contratos, detalle_contrato) por municipio, departamento, entidad, tema y periodo, sin exigir NIT; coincidencia aproximada de lugares y entidades; ampliacion al departamento.
- Presupuesto de 6,5 s con 1 reintento y respaldo comprimido (
pm run snapshot genera server/fallback/snapshot.json.gz, solo lectura, sin documentos de personas naturales).
- Montos: texto $2.700 millones de pesos, tarjeta con valor exacto y COP. El log por turno suma intencion, ruta, herramientas, codigo de declinacion, tipo de error y motivo de cierre.

## 0.1.0 - 2026-10-16
- Primera versión: asistente de consulta de contratos públicos (SECOP II, datos.gov.co) por texto, voz y WhatsApp.
- Sustitutos locales (`MOCK_EXTERNALS=1`), evaluación (`npm run eval`), prueba de carga local y despliegue en Cloud Run.

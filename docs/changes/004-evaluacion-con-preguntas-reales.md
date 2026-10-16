# Cambio 004: evaluación con preguntas ciudadanas reales antes de desplegar

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

## Motivo

En producción el chat mostró marcado interno de DeepSeek (DSML) y los atajos sin LLM devolvieron datos de otro territorio o entidad (Manizales sin resultados, "vías en Antioquia" con contratos de Santa Marta, "salud en Cartagena" con totales nacionales). Las 245 pruebas usaban sustitutos y no lo detectaron. Se añade una puerta de calidad con datos reales.

## Delta

| Parte | Agrega | Modifica | Quita |
|---|---|---|---|
| Spec | **AC-11.5** (US-11): "WHEN se va a desplegar a producción THE SYSTEM SHALL pasar una evaluación con ≥ 25 preguntas ciudadanas reales (`eval/real-questions.json`, `npm run eval:real`, contra datos.gov.co y DeepSeek reales) con ≥ 90 % de respuestas correctas: datos de la entidad, territorio y tema pedidos, sin marcado interno del modelo y con fuente; el resultado queda en `eval/real-results.json`". **T021** [US-11] Evaluación con preguntas reales y corrección de respuestas (serves AC-11.5). Fila en Pruebas: evaluación real como condición de despliegue. | US-11 pasa a `risk: high` (la evaluación llama a servicios externos pagados y es la puerta de veracidad O-1). | — |
| Pruebas de aceptación | tests/acceptance/us-11.real-eval.test.ts (QA): `eval/real-questions.json` con ≥ 25 preguntas, cada una con chequeo de entidad/territorio/tema; `eval/real-results.json` de la última corrida con ≥ 90 % ok, sin "DSML"/"｜" en ningún texto, con fuente en cada respuesta y fecha de corrida. | — | — |
| Código ya construido | — (lo hace el constructor en curso: rutas rápidas solo inequívocas, herramientas con filtros de territorio y ranking de contratistas, `eval:real`) | server/index.ts, server/agent/*, server/data/socrata.ts, server/tools/* | — |

## Impacto

- Tareas a rehacer: ninguna de las 20; se agrega T021 (ya en curso).
- Fase: vuelve de `ship` a `verify` hasta que AC-11.5 pase; luego se repite la entrega.
- Plazo: +1,5–2 h (dentro del límite de las 20:18).
- Riesgos nuevos: costo de la evaluación real (decenas de llamadas, centavos de dólar); variabilidad del LLM entre corridas (se reporta la corrida usada).
- Archivos a abrir para edición: docs/spec.md, tests/acceptance/us-11.real-eval.test.ts.

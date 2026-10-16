# Cambio 001: sin tope fijo de tokens por pregunta

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

## Motivo

El dueño pide que el límite de tokens por pregunta no sea 1.500, sino los que necesite la respuesta: la calidad de la respuesta manda sobre un tope fijo. Se mantiene el ahorro donde no afecta la calidad (caché: pregunta repetida = 0 tokens; prompt corto y resultados compactos) y el tope **diario** anti-abuso (AC-08.4), que es otra cosa.

## Delta

| Parte | Agrega | Modifica | Quita |
|---|---|---|---|
| Spec | — | O-4 medida: "tokens por pregunta registrados y reportados (sin tope fijo); pregunta repetida = 0 tokens". AC-11.3: "THE SYSTEM SHALL usar los tokens de LLM que necesite cada respuesta (sin tope fijo por pregunta), registrar y reportar el consumo por pregunta, y responder una pregunta repetida desde caché con 0 tokens (RNF-03)". | "≤ 1.500 tokens por pregunta en promedio" en O-4 y AC-11.3 |
| Pruebas de aceptación | — | tests/acceptance/us-11.metrics.test.ts, prueba AC-11.3: quitar la aserción `first.tokens <= 1500`; conservar que la pregunta repetida cuesta 0 tokens y que el consumo se registra | aserción de 1.500 |
| Código ya construido | — | server/agent/loop.ts: quitar el `max_tokens` fijo de salida (250) o subirlo a un valor que no recorte respuestas; server/agent/token-budget.ts: quitar `MAX_AVG_TOKENS` como límite (queda solo medición) | tests/agent/prompt-size.test.ts: tope de 1.500 (se deja como medición informativa o se elimina) |

## Impacto

- Tareas a rehacer: T020 (ajuste pequeño en token-budget/loop).
- Plazo: +10 min.
- Riesgos nuevos: mayor costo por pregunta en preguntas complejas; mitigado por el tope diario de 1.000.000 de tokens (AC-08.4), la caché y el prompt compacto.
- Archivos a abrir para edición: docs/spec.md, tests/acceptance/us-11.metrics.test.ts.

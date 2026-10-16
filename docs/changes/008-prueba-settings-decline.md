# Cambio 008: prueba de Settings de voz incluye declinar

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

Menor: tests/acceptance/us-13.voice-agent.test.ts:132 exigía `functions` igual a `TOOL_DEFS` (7) y la línea 328 exige que incluya `decline` (AC-13.5); se cambia la 132 para exigir `TOOL_DEFS` más `decline`. Ningún criterio cambia.

# Modelo del agente: deepseek-flash vs deepseek-v4-pro (AC-13.15)

Batería: `eval/battery.json` (218 preguntas ciudadanas), juez `eval/judge.ts` (deepseek-v4-pro, calibrado 20/20 con `npm run eval:judge`).
Corrida: `npm run eval:battery -- --model <modelo> --env-file=<ruta>`; resultados en `eval/battery-results-<modelo>.json`.

**ESTADO: PROVISIONAL.** Esta corrida (2026-10-16) se hizo con main que tiene T029 (misión, sin atajos) pero **sin T028** (`consultar` y `buscar_entidad`): el agente aún usa las 7 herramientas fijas, sin diccionario de siglas. Hay que repetirla cuando T028 esté en main antes de decidir. Además `/api/chat` no devuelve las herramientas llamadas, así que el juez solo ve tarjetas, filtros y texto (con `toolCalls` en la respuesta lo usará).

| Modelo | Acierto | p50 | p95 | Costo por pregunta (est.) |
|---|---|---|---|---|
| deepseek-flash | 60/218 (28 %) | 2,4 s | 8,4 s | USD 0,0013 |
| deepseek-v4-pro | 90/218 (41 %) | 2,6 s | 4,9 s | USD 0,0056 |

Costo: tokens totales del servidor × tarifa de https://api-docs.deepseek.com/quick_start/pricing (hora pico, cache miss; flash 0,30 entrada / 1,20 salida, pro 1,32 / 3,96 USD por 1M), suponiendo 90 % entrada y 10 % salida. Es una estimación.

## Recomendación (provisional)
- v4-pro acierta 13 puntos más y tiene mejor p95, a ~4,4 veces el costo por pregunta (sigue siendo medio centavo de dólar).
- Con ambos muy por debajo del 90 % exigido por AC-11.5, la causa dominante no es el modelo sino el agente actual: muchas fallas son «no encontré» sin consultar, preguntas de aclaración innecesarias (siglas, errores de escritura) y filtros omitidos (fechas, estados). T028 apunta justo a eso.
- Quedarse con `deepseek-flash` por costo solo si, con T028, la diferencia de acierto baja de ~3 puntos; si no, elegir `deepseek-v4-pro`. Decidir con la corrida definitiva.

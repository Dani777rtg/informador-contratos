# Modelo del agente: deepseek-flash vs deepseek-v4-pro (AC-13.15)

Batería: `eval/battery.json` (218 preguntas ciudadanas), juez `eval/judge.ts` (deepseek-v4-pro, calibrado 20/20 con `npm run eval:judge`).
Corrida: `npm run eval:battery -- --model <modelo> --env-file=<ruta>`; resultados en `eval/battery-results-<modelo>.json`.

**ESTADO: con T028 en el agente (`consultar`, `buscar_entidad`, siglas), 2026-10-17.** La puerta AC-11.5 (≥ 90 %) **todavía no se cumple** con ninguno de los dos modelos; ver «Pendiente».

| Modelo | Acierto | p50 | p95 | Costo por pregunta (est.) |
|---|---|---|---|---|
| deepseek-flash | 122/218 (56 %) | 3,5 s | 8,2 s | USD 0,0018 |
| deepseek-v4-pro | 117/218 (54 %) | 3,5 s | 30,0 s | USD 0,0073 |

Línea base con el agente anterior (7 herramientas fijas): flash 28 %, pro 41 %. Con `consultar` flash sube 28 puntos y pro 13.

Costo: tokens totales del servidor × tarifa de https://api-docs.deepseek.com/quick_start/pricing (hora pico, cache miss; flash 0,30 entrada / 1,20 salida, pro 1,32 / 3,96 USD por 1M), suponiendo 90 % entrada y 10 % salida. Es una estimación.

## Elección
- Se usa `deepseek-flash`: acierta lo mismo que `deepseek-v4-pro` (la diferencia, 5 preguntas, está dentro del ruido del juez), cuesta ~4 veces menos y su p95 es ~4 veces menor (pro tuvo respuestas de 30 s).
- La causa de lo que falta no es el modelo sino el agente y el juez.

## Pendiente para llegar al 90 %
Cambios hechos tras la primera corrida: `/api/chat` devuelve `toolCalls`; el juez recibe el periodo; el agente sabe la fecha de hoy; `consultar` acepta filtros fuera de «filtros», objetos como texto JSON y un año suelto; entidades fuera del índice se buscan por nombre; siglas con una letra mal escrita; hasta 3 rondas de herramientas.

Fallas que quedan (flash):
- Frases con cifras redondeadas de nuevo por el modelo («unos $4 billones») que `verifyNumbers` descarta (con razón): queda solo la pregunta de cierre. Es la causa de varias fallas «no da el total».
- El texto menciona 3 de las 5 tarjetas (la misión pide pocas frases y la lista va en pantalla) y el juez espera la lista completa en el texto.
- Aclaraciones por lugares dudosos (AC-13.10 exige confirmar) y entidades inexistentes en SECOP (Ecopetrol, IGAC), donde «no hay datos» es la respuesta correcta.
- Consultas lentas de datos.gov.co (> 6,5 s) que terminan en «no pude traer el dato».
Estas dos últimas y la expectativa de lista completa son del juez/criterios; las demás son de la misión (T029) y deberían ajustarse allí.

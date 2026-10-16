# Cambio 005: calidad conversacional en texto y voz

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

## Motivo

En una conversación real por voz (logs de Cloud Run 17:25–17:27: 9 turnos de 1,7–4,6 s y 1.100–2.100 tokens, todos por el LLM) el dueño encontró: muletilla al inicio de cada respuesta, cifras habladas ilegibles ("2, 7…" en vez de "27 mil millones"), lenguaje poco natural en texto, y que pedir "un contrato" no funcionaba salvo con frases muy específicas. RNF-06 del cliente ("en voz, leídas de forma natural") se había omitido del spec.

## Delta

| Parte | Agrega | Modifica | Quita |
|---|---|---|---|
| Spec | **AC-05.9** (US-05): "THE SYSTEM SHALL hablar las cifras en español natural de Colombia («27 mil millones de pesos»), las fechas de forma natural («15 de marzo de 2026»), sin códigos, identificadores, siglas crudas ni nombres en mayúsculas, en máximo 2 frases (RNF-06)". **AC-01.12** (US-01): "THE SYSTEM SHALL redactar la respuesta de texto en lenguaje llano con la cifra clave redondeada («$27.000 millones») y nombres en formato normal; el valor exacto queda en la tarjeta". **T022** [US-05] Conversación natural en texto y voz (serves AC-05.4, AC-05.9, AC-01.12, AC-06.1). | **AC-05.4** → "THE SYSTEM SHALL no decir frases de relleno ni acuses («Claro, déjame buscar eso»); mientras busca solo muestra el estado visual «Buscando en SECOP…»". **AC-06.1** añade seguimientos «dame ese contrato», «el más grande», «el primero», «ábrelo», resueltos con los resultados mostrados, también los que trajo el agente, por texto y voz. **AC-05.6** añade: atajos rápidos también en voz y DeepSeek en modo sin razonamiento. **AC-11.5** añade: la evaluación real incluye preguntas habladas y chequea cifras en palabras en el texto hablado, ausencia de muletillas y seguimiento de contrato resuelto. | Acuse de 500 ms de AC-05.4 (RF-19e del cliente, retirado por decisión del dueño) |
| Pruebas de aceptación | casos nuevos (QA) para AC-05.9, AC-01.12 y seguimientos de AC-06.1 | tests/acceptance/us-05.voice.test.ts (prueba AC-05.4 ahora exige que NO haya acuse); tests/acceptance/us-06.session.test.ts (seguimientos nuevos); tests/acceptance/us-11.real-eval.test.ts (chequeos de naturalidad); tests/acceptance/us-01.consulta.test.ts (AC-01.12) | aserción del acuse en us-05 |
| Código | formateador de cifras y fechas habladas es-CO; redacción natural; resolución de seguimientos sobre resultados del agente; atajos en voz | server/voice/*, server/agent/*, server/index.ts, web/src/render.ts | acuse en server/voice |

## Impacto

- Tareas a rehacer: T007 (parte del acuse); se agrega T022. Se coordina con T021 (cambio 004), que toca los mismos archivos: lo hace el mismo constructor.
- Plazo: +1–1,5 h sobre el cambio 004; cabe antes de las 20:18.
- Riesgos nuevos: sin acuse, si una consulta tarda >1 s el usuario oye silencio (se mitiga con atajos en voz, DeepSeek sin razonamiento y el estado visual).
- Archivos a abrir para edición: docs/spec.md, tests/acceptance/us-05.voice.test.ts, tests/acceptance/us-06.session.test.ts, tests/acceptance/us-11.real-eval.test.ts, tests/acceptance/us-01.consulta.test.ts.

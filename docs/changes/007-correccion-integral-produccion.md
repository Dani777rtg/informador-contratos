# Cambio 007: corrección integral tras la prueba en producción del 16-oct

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

## Motivo

Prueba en producción (16:23, 12 preguntas por texto y por voz con audio sintetizado) y logs de Cloud Run: voz de 3,8–7,8 s hasta la primera palabra (texto ~3,6 s, 9,7 s en frío); la transcripción oye mal ("¿Cuánto será hasta en Antioquia?", "¿En qué se las tomas en pasto?"); la misma pregunta da datos distintos por texto (Gecelca, 4,2 billones) y por voz (persona natural con "577 billones"); un error guardado en caché se repite ("la fuente está lenta" en 0,36 s); declinar por voz llama una herramienta inexistente (`NON_EXISTENT_FUNCTION_CALLED`) y se queda mudo; la sesión de voz se corta a los 10 min; la voz no registra nada por turno; el dueño nunca obtuvo el detalle de un contrato; la auditoría independiente mostró que la evaluación real se había aflojado (real ~85 %, no 100 %) y que la voz dice "billones" donde son "mil millones".

## Delta

| Parte | Agrega | Modifica | Quita |
|---|---|---|---|
| Spec | **AC-13.8** montos atípicos: detectar valores imposibles o atípicos (> 10 billones o > 50 % del total del territorio), excluirlos de rankings y totales, mostrarlos aparte y decir de forma neutral "este valor es inusualmente alto y así aparece registrado en SECOP"; la misma pregunta da el mismo dato por texto y voz. **AC-13.9** detalle de contrato: por texto y voz ("el detalle de ese contrato", "ábrelo", "el primero", "el más grande", por número) se muestra la ficha completa (objeto, entidad, contratista, valor, firma, inicio, fin, estado, modalidad, pagado, facturado, pendiente, adiciones, enlace SECOP) y por voz lo esencial en dos frases. **AC-13.10** comprensión del lugar: keyterms de los 32 departamentos y ~150 municipios principales; coincidencia aproximada tolerante a errores de transcripción; si no reconoce un lugar, confirma ("¿Dijiste Tunja, en Boyacá?") en vez de "no hay datos". **AC-13.11** puerta de producción: prueba automática con ≥ 15 preguntas reales por texto y por voz con audio sintetizado contra staging o producción, ≥ 90 %, además de la evaluación estricta (AC-11.5). **T025** [US-13] veracidad, atípicos, tema único, caché y detalle (serves AC-13.8, AC-13.9, AC-01.5, AC-01.8, AC-05.9). **T026** [US-13] velocidad y respaldo precalculado (serves AC-05.6, AC-11.2, AC-13.6, AC-09.2). **T027** [US-13] voz: comprensión, conversación, declinar, sesión, diagnóstico y puerta (serves AC-13.10, AC-13.11, AC-13.1, AC-13.5, AC-05.8, AC-07.4, AC-11.5). | **AC-01.8** cifras: ordenar por valor numérico; tema con un solo criterio (con y sin tilde, mismas columnas) para que lista y total cuadren; nunca caché de error o respaldo. **AC-05.6** meta de velocidad ~2 s p50 en voz: una sola llamada a datos por pregunta en los casos comunes, < 1.500 tokens por turno. **AC-05.8** sesión de voz de 30 min. **AC-05.9** montos hablados sin error de escala ("mil millones" vs "billones"), con pruebas de 944.000.000.000, 1.200.000.000.000 y 27.000.000.000. **AC-07.4** registro por turno también en voz (lugar reconocido o no, herramienta, código de resultado, ruta, tiempos), sin contenido. **AC-09.2** `min-instances=1` durante el demo por decisión explícita del dueño, con costo documentado, y volver a 0 después (RNF-09a). **AC-11.5** evaluación estricta restaurada (chequeos que la auditoría de QA marcó como debilitados) y preguntas originales "en Nariño"/"en Caldas". **AC-13.1** saludo cálido si el usuario saluda (sin datos) y tono cercano (tutear, frases cálidas). **AC-13.2** pedir contratos da contratos: 3 por voz y 5–10 en pantalla con "ver más"; cascada (consulta liviana → respaldo de listas por municipio y tema → ofrecer ampliar). **AC-13.5** declinar por voz funciona sin herramientas inexistentes. **AC-13.6** respaldo listo al arrancar con totales, rankings, contratos más grandes y listas por tema frecuente por municipio y departamento. | Tope de sesión de voz de 10 min; `min-instances=0` durante el demo |
| Pruebas de aceptación | AC-13.8..13.11 (QA) | las que QA liste abajo | — |
| Código | detector de atípicos, ficha de contrato, keyterms de lugares, confirmación de lugar, registro por turno en voz, prueba de producción con audio | server/agent/*, server/data/*, server/voice/*, server/speech/spoken.ts, server/fallback/*, eval/*, scripts/deploy.ps1 | — |

## Impacto

- Tareas a rehacer: ninguna de las cerradas; se agregan T025–T027 y absorben el trabajo del constructor en curso (latencia, formato de texto, conversación c4, restauración de la evaluación y errores de la auditoría).
- Plazo: hora ~16:35; límite 20:18. Con constructores en paralelo, ~1,5–2 h + puerta de producción.
- Riesgos nuevos: `min-instances=1` cuesta mientras esté encendido (documentar y apagar tras el demo); listas de keyterms largas pueden degradar la transcripción si se exceden los límites de Deepgram.
- Archivos a abrir para edición: docs/spec.md y las pruebas de aceptación que liste QA.

## Pruebas bloqueadas afectadas (qa-lead)

| Archivo | AC | Efecto | Ajuste |
|---|---|---|---|
| us-09.deploy.test.ts:58-61 | AC-09.2 | contradice | aceptar `--min-instances 1` durante el demo, exigir costo documentado y vuelta a 0 |
| us-05.voice.test.ts:231 | AC-05.8 | contradice (título) | 30 min; caso por defecto 1800 s |
| us-05.voice.test.ts:178-187 | AC-05.6 | contradice | VOZ.md con meta ~2 s p50, una llamada a datos, < 1.500 tokens |
| us-05.voice.test.ts:212-229 | AC-05.9 | no contradice | agregar 944.000.000.000 → "944 mil millones" |
| us-11.real-eval.test.ts:22-41, 99-107 | AC-11.5 | afecta | preguntas originales "en Nariño"/"en Caldas"; chequeos no triviales; AC-13.11 |
| us-13.guia.test.ts:66-76 | AC-13.1 | contradice parcial | saludo cálido sin datos y tuteo |
| us-13.guia.test.ts:93-101, 308 | AC-13.2 | afecta | 5–10 en pantalla con "ver más" y cascada |
| us-13.voice-agent.test.ts | AC-13.5 | falta | declinar por voz sin función inexistente |
| us-13.guia.test.ts:249-300 | AC-13.6 | contradice | un error no se repite desde caché; consulta fuera del respaldo para `servicio_no_disponible`; respaldo con totales, rankings, mayores y listas por tema |
| us-13.guia.test.ts:124-126 | AC-13.10 | nuevo | keyterms y confirmación de lugar |
| us-01.consulta.test.ts:115-122 | AC-01.5 / AC-13.9 | afecta | ficha completa |
| us-01.consulta.test.ts:146-153 | AC-01.8 | falta | lista y total cuadran con tema con y sin tilde |
| us-07.privacy.test.ts:58-95 | AC-07.4 | falta | registro por turno real en el servidor de voz sin contenido |

## Contratos de interfaz (para QA y constructores)

- **Atípicos (T025)** — `server/data/outliers.ts`: `isOutlier(value: number, territoryTotal?: number): boolean` (> 10 billones o > 50 % del total del territorio). Las herramientas excluyen atípicos de totales y rankings y los devuelven aparte en `data.atipicos` y en tarjetas con `atipico: true`; `note` pide decir "este valor es inusualmente alto y así aparece registrado en SECOP".
- **Ficha (T025)** — tarjeta `kind: "detail"` con `object, entity, contractor, value, signedAt, startAt, endAt, status, modality, paid, invoiced, pending, additions, url`.
- **Caché (T025)** — `answer-cache` y caché de datos nunca guardan respuestas con `error`, `servicio_no_disponible` o de respaldo.
- **Lugares (T027)** — `server/data/places.ts`: `PLACE_KEYTERMS: string[]` (32 departamentos + ≥ 100 municipios principales) usados en `Settings.agent.listen.provider.keyterms`; `matchPlace` devuelve `{ confirmar: "¿Dijiste Tunja, en Boyacá?" }` cuando la coincidencia es dudosa.
- **Sesión de voz (T027)** — `VOICE_SESSION_MAX_SECONDS` por defecto 1800.
- **Registro por turno en voz (T027)** — una línea por turno con `channel:"voz"`, `intent`, `route`, `tools`, `placeMatched` (sí/no/confirmar), `resultCode`, `latencyMs`, sin texto.
- **Puerta de producción (T027)** — `scripts/prod-probe.ts` (`npm run probe:prod -- --target <url>`) con ≥ 15 preguntas por texto y por voz con audio sintetizado (Deepgram TTS) → `eval/prod-probe-results.json` `{ runAt, target, results: [{ q, channel, ok, ms, heard?, reason? }] }`.
- **Instancias (T026)** — `scripts/deploy.ps1 -MinInstances <0|1>`; con 1, `docs/COSTOS.md` documenta el costo diario y el comando para volver a 0.

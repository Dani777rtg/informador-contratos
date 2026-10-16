# Cambio 009: agente con criterio y consulta flexible

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

## Motivo

En la prueba del dueño (18:35–18:40, logs de Cloud Run) el agente se comportó de forma rígida: "Ministerio TIC" no se reconoció hasta decir "Ministerio de Tecnología" (la coincidencia es por texto contra el nombre oficial, sin siglas ni nombres comunes); "los contratos de menor valor" no tuvo respuesta (no existe orden ascendente: solo 7 herramientas fijas); 3 de 6 turnos del agente respondieron sin consultar datos; algunos turnos llamaron 2–3 herramientas. Los atajos con reglas responden antes de que el modelo razone. Las pruebas cubren solo lo que se nos ocurrió, y el dueño no puede probar cada caso a mano. Se incluye además la corrección de la prueba bloqueada us-05.voice.test.ts:186, cuya regex tiene un byte de retroceso (0x08) en lugar de `\b` y nunca puede pasar.

## Delta

| Parte | Agrega | Modifica | Quita |
|---|---|---|---|
| Spec | **AC-13.12** consulta flexible: una herramienta `consultar` con parámetros cerrados y SoQL del servidor — filtros (entidad, contratista, municipio, departamento, tema, rango de fechas, rango de valor, estado, modalidad, tipo de contrato), operación (listar, sumar, contar, promediar), agrupación (entidad, contratista, categoría, modalidad, mes, año, municipio), orden ascendente o descendente y límite ≤ 10; se conservan `detalle_contrato` y `decline`. **AC-13.13** `buscar_entidad(texto)` devuelve candidatos con diccionario de siglas y nombres comunes (MinTIC, ICBF, INVÍAS, DIAN, SENA, Fiscalía, Registraduría, Policía, Ejército, etc.); el modelo usa su conocimiento y, si hay duda, pregunta con opciones. **AC-13.14** batería automática de ~200 preguntas ciudadanas variadas (siglas, errores de escritura, menor/mayor/promedio, fechas, estados, modalidades, seguimientos) con un juez automático que revisa pregunta, consulta hecha, datos devueltos y respuesta; ≥ 90 % para desplegar. **AC-13.15** comparación medida de `deepseek-flash` y `deepseek-v4-pro` con la batería (acierto, tiempo, costo por pregunta) y elección documentada. **AC-13.16** modo diagnóstico solo para el dueño, activado con un código secreto, que registra pregunta, respuesta, herramienta y datos en Cloud Logging con borrado a 24 h; sin el código, nada de contenido se registra. **T028** consulta flexible y buscar_entidad. **T029** misión con criterio, retiro de atajos y modo diagnóstico. **T030** batería con juez y comparación de modelos. | **AC-13.1** misión con criterio: entender qué quiere la persona, decidir cómo consultarlo, y si algo no se puede decir qué sí y ofrecerlo; atajos rígidos retirados salvo el saludo. **AC-13.2** las preguntas exploratorias se resuelven con `consultar` (en lugar de 7 herramientas fijas). **AC-13.3** reconocimiento de entidades con `buscar_entidad`. **AC-07.4** excepción del modo diagnóstico del dueño (AC-13.16). **AC-11.5** la puerta de despliegue incluye AC-13.14. | Las 7 herramientas fijas (`gasto_total`, `gasto_por_categoria`, `top_entidades`, `top_contratistas`, `contratos_mayores`, `buscar_contratos`) como interfaz del modelo; atajos de reglas salvo saludo |
| Pruebas de aceptación | AC-13.12..13.16 (QA) | las que liste QA; us-05.voice.test.ts:186 (byte inválido) | — |
| Código | server/agent/query.ts (consulta flexible), server/data/entity-aliases.ts, juez y batería en eval/, modo diagnóstico | server/agent/*, server/index.ts, server/voice/agent.ts, server/log.ts | atajos de reglas en /api/chat |

## Impacto

- Tareas a rehacer: T023 (herramientas) queda absorbida por T028; T029/T030 nuevas.
- Plazo: hora ~18:50, límite 20:18. El dueño eligió hacerlo completo aunque pase el límite (opción A).
- Riesgos nuevos: el modo diagnóstico registra contenido (datos personales del dueño) → solo con código secreto en Secret Manager, retención 24 h y sin datos de ciudadanos; una herramienta más flexible amplía lo que el modelo puede pedir → parámetros cerrados, límite ≤ 10 y presupuesto de tiempo; Pro es más lento y caro (se decide con datos).
- Archivos a abrir para edición: docs/spec.md y las pruebas de aceptación que liste QA.

## Seguridad (security-lead, A) — se agrega a los criterios

- **AC-13.16 (modo diagnóstico)**: código solo en Secret Manager (`DIAG_CODE`), enviado en cabecera o cuerpo POST, nunca en URL; validado en servidor con `timingSafeEqual` sobre SHA-256, con límite de intentos por origen y respuesta idéntica ante fallo; nunca se registra el código. Decisión por petición, apagado por defecto y cerrado ante error. Un único punto de registro de contenido, con nombre de log propio (`diag`) enrutado a un bucket de logs con retención de 1 día y excluido de `_Default`; acceso solo para el dueño. Aun en diagnóstico no se registran claves, tokens, cabeceras, IP, user-agent ni cédulas, correos o teléfonos (redacción por regex), y el contenido se trunca. Finalidad, base y plazo documentados en docs/PRIVACIDAD.md. Pruebas: el código no aparece en bundle, URL ni logs; sin código o con código erróneo no se registra contenido; retención verificada con `gcloud logging buckets describe`.
- **AC-13.12 (consulta flexible)**: el modelo emite JSON, nunca SoQL; listas cerradas de columnas, operaciones (listar, contar, sumar, promediar, mínimo, máximo), agrupaciones y orden; valores escapados; límite recortado a 10 en el servidor; presupuesto de tiempo y máximo de llamadas por turno; agrupaciones por contratista o entidad a nivel nacional sin filtro acotante se resuelven desde el respaldo precalculado o se rechazan con un mensaje claro. Pruebas: comillas en filtros, columna fuera de la lista, límite 1000 → 10, agrupación nacional sin filtro, timeout.

## Pruebas bloqueadas afectadas (qa-lead)

| Archivo | AC | Efecto | Ajuste |
|---|---|---|---|
| us-13.guia.test.ts:65, 82-100, 145, 223, 281-296, 350, 390 | AC-13.2/13.3/13.8 | contradice | `TOOL_DEFS` = consultar, buscar_entidad, detalle_contrato (+ decline en voz); reescribir llamadas con `consultar`/`buscar_entidad` |
| us-13.voice-agent.test.ts:120-131, 312-330 | AC-13.7/05.2 | afecta | no fijar el modelo (lo decide AC-13.15); usar `consultar` |
| us-13.voice-agent.test.ts:348-361 | AC-07.4 | afecta | caso con modo diagnóstico apagado |
| us-07.privacy.test.ts:58-108 | AC-07.4 | contradice en texto | "sin código, nada de contenido"; pruebas de AC-13.16 (con código 24 h; sin código o erróneo nada) |
| us-11.real-eval.test.ts:22-142 | AC-11.5 | contradice | batería de AC-13.14 (~200 con juez) como archivo propio; regenerar resultados |
| us-01.consulta.test.ts:74-130, 211-240 | AC-01.1..01.6, AC-01.11 | contradice en parte | el sustituto de DeepSeek emite `consultar`/`buscar_entidad`; o aserciones estructurales sobre las consultas a Socrata; `consultar` rechaza SoQL arbitrario |
| us-03.limits.test.ts:37-40 | AC-03.4 | afecta | `eval --mock` debe pasar sin atajos |
| us-06.session.test.ts:54-62 | AC-06.1 | verificar | seguimientos sin reglas |
| us-05.voice.test.ts:186 | AC-05.6 | contradice (siempre falla) | byte 0x08 → `\b` |

## Contratos de interfaz (para QA y constructores)

- **T028** — `server/agent/query.ts`: `QUERY_DEF` (JSON Schema) y `runQuery(args, dataCtx, sessionCtx?) → { data, cards, context?, note? }`. Args: `filtros?: { entidad?, nit?, contratista?, municipio?, departamento?, tema?, desde?, hasta?, valorMin?, valorMax?, estado?, modalidad?, tipo? }`, `operacion: "listar"|"contar"|"sumar"|"promediar"|"minimo"|"maximo"`, `agrupar?: "entidad"|"contratista"|"categoria"|"modalidad"|"mes"|"anio"|"municipio"`, `orden?: "asc"|"desc"`, `limite?` (recortado a 10). Errores sin lanzar: `{ data: { error: "parametro_invalido"|"consulta_muy_amplia"|"servicio_no_disponible"|"sin_resultados", sugerencia? } }`. `server/data/entity-aliases.ts`: `ALIASES` (sigla o nombre común → NIT o nombre oficial). `buscar_entidad(texto)` → `{ candidatos: [{ nit, nombre, confianza }] }`. `TOOL_DEFS` = `consultar`, `buscar_entidad`, `detalle_contrato` (en voz además `decline`). El sustituto de DeepSeek (`server/mocks/deepseek.ts`) emite `consultar`/`buscar_entidad` para las preguntas de las pruebas.
- **T029** — `server/diag.ts`: `isDiagnostic(req) → boolean` (cabecera `x-diag-code` comparada en tiempo constante con SHA-256 de `DIAG_CODE`; límite de intentos por origen), `diagLog(entry)` escribe en el log `diag` solo si está activo, con redacción de cédulas, correos y teléfonos y truncado; `scripts/gcp-diag-log.ps1` crea el bucket de logs con retención de 1 día, el sink del log `diag` y la exclusión en `_Default`.
- **T030** — `eval/battery.json` (~200 `{ id, question, channel, expect: { intent, filtros?, operacion?, orden? } }`), `eval/judge.ts` (juez con DeepSeek que recibe pregunta, consulta hecha, datos y respuesta y devuelve `{ ok, motivo }`), `npm run eval:battery -- --model <deepseek-flash|deepseek-v4-pro>` → `eval/battery-results-<modelo>.json` `{ runAt, model, results: [{ id, ok, ms, tokens, motivo }], okRate, p50, p95, costPerQ }`; `docs/MODELO.md` con la comparación y la elección.

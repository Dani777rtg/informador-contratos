# Verificación — contratos (asistente SECOP)

## Veredicto

**SHIP** (re-verificación 2026-10-16 ~12:00). La primera corrida dio NO SHIP por lint y por la falta de E2E de US-04; ambos están corregidos y re-ejecutados (ver "Re-verificación"). 0 bugs S1/S2. Riesgos residuales abajo.

## Re-verificación

| Check | Resultado | Evidencia |
|---|---|---|
| Lint | OK | `npm run lint` exit 0 tras c2dc1e3 (`loadEntities` sin parámetro sin uso). |
| Suite completa | OK | `npx vitest run`: 239 pasan, 3 todo (cubiertos por E2E abajo). |
| E2E Playwright | OK | `npm run test:e2e`: 16/16 (tests/e2e/us-04.spec.ts + us-07): AC-04.2 capas y "Ver más", AC-04.3 estados, AC-04.5 axe 0 violaciones A/AA en 6 estados × móvil 390×844 y escritorio 1366×768. |
| Seguridad M-1 | Corregido | 3cadceb: límite por IP y `demand.admit("voice")` en POST /session y upgrade /voice, `maxPayload` 64 KB; tests/hardening/voice-abuse.test.ts (4 pruebas). SECURITY.md añadido. |
| Despliegue (US-09) | OK | `us-09.deploy.test.ts` 17/17. Staging: https://informador-staging-772597157596.us-east1.run.app — /health 200, /api/chat NIT 890399011 200 en 0,6 s con datos reales, CORS solo origen permitido, /session 403 a origen ajeno, 0 instancias tras ~7 min sin tráfico, rollback ensayado (6,6 s). |
| Integridad | OK | `lock.mjs verify`: Locked files intact. |

## Integridad

- `lock.mjs verify`: intacto ("Locked files intact").
- `trace.mjs --phase verify`: no ejecutado por mí; los 67 AC de la spec aparecen citados en pruebas (comprobado por búsqueda de IDs, 0 sin cita).

## Resultados

| Check | Resultado | Evidencia |
|---|---|---|
| Aceptación | OK | `npx vitest run`: 18 archivos, 235 pasan, 3 todo (238). Archivos bloqueados intactos. |
| Suite completa | OK | misma corrida, 4,2 s. |
| Tipos | OK | `npx tsc --noEmit` exit 0. |
| Lint | FALLA | `npm run lint`: `server/index.ts(55,23): TS6133 'env' is declared but never read` (función `loadEntities`). |
| Build web | OK | `npm run build:web`: 13 módulos, JS 10,2 kB (4,6 kB gzip). |
| Eval mock | OK | `npm run eval -- --mock`: 19/19 (100 %). |
| Eval real | OK (evidencia del orquestador) | `npm run eval` contra DeepSeek: 19/19 (100 %). |
| Datos reales | OK (orquestador) | datos.gov.co: Antioquia 2025 1,9 s 14 tarjetas; "¿y en 2024?" 0,5 s; Boyacá 0,4–0,6 s; NIT 890399011 0,4–1,8 s; "¿es un robo?" 2 ms, 0 tokens. Documentos: datos.gov.co sirve hoy solo 1.000 filas 2016-2021 (recarga externa), responde con enlace al proceso (AC-02.3). |
| Seguridad | OK | `npm run scan:secrets` exit 0 sin hallazgos; `npm audit --omit=dev`: 0 vulnerabilidades. |
| Carga (solo local) | OK, informativo | `npm run loadtest:local`: a 1000 usuarios p50 628 ms, p95 1732 ms, errores 835/5000 (ECONNREFUSED 1175), 1268 req/s, lag bucle p95 76 ms, costo ~USD 0,002; llamadas externas 0; punto de quiebre 500 usuarios. El reporte de quiebre es lo que pide AC-12.1. |
| E2E Playwright | PARCIAL | Solo existe 1 spec (AC-07.3). Con `vite` en :5173: 1/1 pasa. Con backend (MOCK_EXTERNALS=1, :8080) `/` devuelve 404: el backend no sirve el front, por lo que la spec contra 8080 falla. |
| Brecha us-04 | HUECO | `us-04.ui.test.ts` líneas 38, 39, 59: tres `it.todo` sin E2E equivalente (único spec: us-07). |
| Accesibilidad | PARCIAL | axe solo en el estado vacío (jsdom, us-04); estados cargando/resultado/sin resultados/error/voz y móvil+escritorio sin cubrir (AC-04.5). |
| Docs: quick start en clon limpio | No ejecutado | no se probó clon limpio. |

## Cobertura de AC

67/67 AC de la spec citados en al menos una prueba (us-01 a us-12 + tests/agent, data, hardening). Pasan salvo los 3 pendientes de us-04 listados arriba (en estado `todo`, no verificados).

## Amenazas

| TM | Estado | Evidencia |
|---|---|---|
| TM-1 | mitigada | evidencia: prefiltro + `<datos_secop>` + decline; `npm run eval` real 19/19 incluye objeto de contrato con orden inyectada. |
| TM-2 | mitigada | evidencia: guardrails.ts reglas NO-01..16 y dropForbidden; eval real 19/19; "¿es un robo?" 2 ms, 0 tokens. |
| TM-3 | mitigada | evidencia: us-07.privacy.test.ts 6/6 (lista permitida, cédulas depuradas, NIT conservado), redact.ts. |
| TM-4 | mitigada | evidencia: log.ts solo tokens/latencia/canal/código (us-07 AC-07.4); WhatsApp solo hash del número. |
| TM-5 | mitigada | evidencia: us-08 AC-08.1/08.4 + tests/hardening/voice-abuse.test.ts (límite por IP en /api, /session y /voice; tope diario). Contadores por instancia (máx 5) documentados. |
| TM-6 | mitigada | evidencia: scan:secrets exit 0; historial git sin claves; web/dist sin secretos ni source maps (docs/verify-security.md). |
| TM-7 | mitigada | evidencia: us-09 AC-09.1 (17/17): --project explícito, sin proyectos prohibidos, sin `config set project`. |
| TM-8 | mitigada | evidencia: min-instances 0 / max 5; presupuesto 40.000 COP con alertas 50/90/100 % creado; staging en 0 instancias sin tráfico. |
| TM-9 | aceptada por el dueño | evidencia: consentimiento + E.164 + 1 envío/10 min por IP en Firestore (us-10 14/14). |
| TM-10 | mitigada | evidencia: tests/hardening/voice-abuse.test.ts (límite por IP, demanda, maxPayload 1009); tope diario y de sesión (us-05 AC-05.8). |
| TM-11 | mitigada | evidencia: us-01 AC-01.11 (SoQL parametrizado, allowlist, $limit ≤ 100). |
| TM-12 | mitigada | evidencia: us-02 AC-02.5 (safe-link: solo https *.secop.gov.co). |
| TM-13 | mitigada | evidencia: us-06 18 casos (HMAC, versión de clave, caducidad 2 h, firma alterada). |
| TM-14 | mitigada | evidencia: us-08 AC-08.6 (CSP con nonce, sin innerHTML en web/src); E2E axe sin violaciones. |

## Bugs

| # | Qué pasa | Severidad | Estado |
|---|---|---|---|
| 1 | `server/index.ts:55` parámetro `env` sin uso en `loadEntities`; rompe `npm run lint` | S3 (rompe una puerta de calidad) | corregido (c2dc1e3) |
| 2 | Brecha de pruebas: AC-04.2, AC-04.3, AC-04.5 (otros estados) sin E2E | S3 (hueco de cobertura, no defecto de producto conocido) | corregido (3401b8f) |
| 3 | El backend en :8080 responde 404 en `/` (no sirve `web/dist`); el spec E2E por defecto apunta a 8080 | S3 salvo que el despliegue previsto sea un solo proceso (confirmar con DEPLOY.md/AC-09) | no aplica: el front se sirve aparte (Firebase Hosting) y el E2E usa Vite |

0 bugs S1/S2 abiertos.

## Riesgos residuales (a aceptar por el usuario)

- Punto de quiebre local de 500 usuarios simultáneos; con 1000 hay ~17 % de errores de conexión.
- Documentos reales limitados por la recarga externa de datos.gov.co.
- Carga: con un solo proceso local, a 1.000 usuarios simultáneos ~17 % de errores de conexión; en Cloud Run se reparte hasta 5 instancias (subir max-instances si el Estado lo adopta).
- Contadores de límite por instancia (máx 5) y get+set de WhatsApp no atómico entre instancias (documentados con `ponytail:`).
- La voz está verificada con pruebas automáticas y sustitutos; falta una prueba con micrófono real y la medición p95 de voz en producción.
- Plantilla de WhatsApp `resumen_secop` pendiente de aprobación de Meta; si no se aprueba, el envío ofrece el enlace para copiar (AC-10.4).

## Seguridad

Verdicto: sin hallazgos altos/críticos abiertos. 2 medios, 3 bajos (abajo). ASVS L2 tocado: V2/V3 (token firmado), V4 (origen), V5 (validación), V7 (logs), V8/V14 (privacidad, config).

### Escaneos
- Secretos en historial: `git log -p --all` con patrones (AIza, sk-, ghp_, PRIVATE KEY, AC+32 hex, clave=valor 16+). Solo coincidencias en tests (`issueSessionToken({secret})`, valores ficticios). `.env` ignorado y nunca añadido en el historial (`git log --all --diff-filter=A` sin `.env`/claves). `.env` local existe pero no está versionado.
- Dependencias: `npm audit --omit=dev` -> 0 vulnerabilidades.
- Bundle `web/dist`: sin `sourceMappingURL`, sin `.map` (web/vite.config.ts `sourcemap:false`); sin patrones de clave; sin `innerHTML` en web/src.
- Contenedor: Dockerfile `USER node`, `NODE_ENV=production`.

### Controles
- Cabeceras: server/headers.ts:8-12 CSP con nonce, sin `unsafe-inline`, `object-src none`, `frame-ancestors none`, HSTS, nosniff, referrer no-referrer. CORS server/index.ts:~82 solo orígenes de ALLOWED_ORIGINS (lista exacta, sin `*`).
- Límites: bodyLimit 8 KB en /api/* (index.ts:~86); estado ≤4096; `validateClientMessage`; rate limit 20/min por IP, IP = último valor de X-Forwarded-For (rate-limit.ts:32, anti-spoof en Cloud Run); tope diario de tokens (demand.ts).
- WS /voice: Origin en lista + token HMAC con expiración 5 min y `timingSafeEqual` (ws-auth.ts:12-21; voice/index.ts:167). /session exige Origin permitido.
- MOCK_EXTERNALS=1 con NODE_ENV=production lanza error (index.ts:~72). HMAC_SECRET desde Secret Manager (deploy.ps1:19), clave efímera solo en local.
- Prompt injection: prefiltro determinista (guardrails.ts) -> decline sin LLM; `<datos_secop>` documentado como dato (system-prompt.ts:4,9-10).
- PII: lista permitida de columnas (socrata.ts:58), `sanitizeFileName`/`redactText` (privacy/redact.ts, usados en tools/documents.ts:14 y detail.ts:5,12). demo-answers.json: los números largos son noticeUID/montos, sin cédulas.
- Logs: log.ts solo tokens, latencia, canal, código. WhatsApp loguea solo hash del número (whatsapp/index.ts, `whatsapp_fail`).
- WhatsApp: consentimiento explícito, E.164, límite 1/10 min por hash de IP en Firestore (index.ts store), texto del mensaje de ids validados. Riesgo TM-9 aceptado por el dueño.
- Despliegue: deploy.ps1 y gcp-setup.ps1 fijan `--project` en cada comando, proyecto propio `informador-contratos-1016*`, sin `config set project`, sin app-507617; revisión sin tráfico y aprobación `SI`; min-instances 0, max 5.

### TM
| TM | Estado | Evidencia |
|---|---|---|
| 1 | Mitigado | datos_secop + prefiltro + decline; eval `npm run eval` |
| 2 | Mitigado | guardrails.ts RULES NO-01..13, dropForbidden |
| 3 | Mitigado | redact.ts, allowlist socrata.ts:58 |
| 4 | Mitigado | log.ts; hash en WhatsApp |
| 5 | Parcial (M-1) | rate limit + tope diario en memoria por instancia; /session y upgrade WS sin límite |
| 6 | Mitigado | sin secretos en historial/bundle; Secret Manager |
| 7 | Mitigado | --project explícito, nombre propio |
| 8 | Mitigado | min 0 / max 5, presupuesto en gcp-setup.ps1:45 |
| 9 | Aceptado | consentimiento + límite por IP |
| 10 | Parcial (M-1) | token+Origin ok; sin límite de conexiones/IP ni `maxPayload` |
| 11 | Mitigado | SoQL parametrizado, `$q` (soql.ts) |
| 12 | Mitigado | tools/safe-link.ts |
| 13 | Mitigado | HMAC con versión de clave y caducidad (session.ts) |
| 14 | Mitigado | CSP con nonce, sin innerHTML |

### Hallazgos
- M-1 (medio): server/voice/index.ts:32,164-168 y server/index.ts:/session: el upgrade a /voice y POST /session no pasan por limiter ni `demand.admit("voice")`; `new WebSocketServer({noServer:true})` sin `maxPayload`. Un origen permitido/curl con Origin falsificado puede abrir sesiones de voz (costo Deepgram). Fix: limiter por IP en /session y upgrade, `demand.admit("voice")`, `maxPayload` de ~64 KB.
- M-2 (medio): Origin no es autenticación fuera del navegador; /session lo acepta con cabecera falsificada. Mitigado en parte por el fix de M-1.
- L-1: falta SECURITY.md (repo público).
- L-2: rate limit y tope de tokens son por instancia (ponytail documentado); límite real = N x 5 instancias.
- L-3: get+set de WhatsApp no atómico entre instancias (documentado).
- Pendientes de proceso: DAST/ZAP no ejecutado; adversarial con security-bounty-hunter solo revisión manual del código.

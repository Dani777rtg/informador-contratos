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

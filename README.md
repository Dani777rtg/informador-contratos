# Informador de contratos públicos

Asistente en español que responde preguntas sobre contratos públicos de Colombia (SECOP II, datos abiertos de datos.gov.co) por texto, voz y WhatsApp, con fuente y fecha de consulta en cada respuesta.

> **Prototipo no oficial.** No es un servicio del Estado ni de Colombia Compra Eficiente. Verifica siempre en la fuente oficial enlazada en cada respuesta.

## Arquitectura en breve
- `server/`: API Hono (Node >= 22). Agente (DeepSeek) con herramientas que consultan Socrata; estado de conversación firmado con HMAC (sin sesión en servidor); guardas (límite por IP, tope diario de tokens, validación); voz por WebSocket con Deepgram (STT/TTS); WhatsApp Cloud API con plantilla.
- `web/`: front Vite; el servidor lo sirve desde `web/dist` en el mismo origen (`npm run build:web`).
- `server/mocks/`: sustitutos de Socrata, DeepSeek, Deepgram y WhatsApp para trabajar sin claves.
- Despliegue: Cloud Run (`docs/DEPLOY.md`).

## Quick start local (sin claves)
```bash
npm ci
MOCK_EXTERNALS=1 npx tsx server/index.ts   # API en http://localhost:8080
npm run dev:web                            # front con recarga, en otra terminal (o `npm run build:web` y abrir :8080)
curl localhost:8080/health                 # {"ok":true}
```
En PowerShell: `$env:MOCK_EXTERNALS="1"; npx tsx server/index.ts`.

## Pruebas
- `npm test`: unitarias y de aceptación (vitest).
- `npm run eval -- --mock`: evaluación del agente con sustitutos.
- `npm run eval:real -- --env-file=<ruta al .env>`: ~27 preguntas ciudadanas contra datos.gov.co y DeepSeek **reales** (`eval/real-questions.json`); comprueba que las tarjetas correspondan a la entidad, municipio, departamento y tema pedidos, sin marcado DSML y con fuente. Imprime ok/falla, ms y tokens por pregunta, p50/p95, y escribe `eval/real-results.json`. Cuesta centavos; sale con 1 si hay menos de 90 % ok.
- `npm run loadtest:local`: carga contra el servidor con sustitutos. **Solo local, nunca contra la nube.**
- Otros: `npm run lint`, `npm run typecheck`, `npm run test:e2e`, `npm run scan:secrets`.

## Configuración
Copia `.env.example` a `.env`. Con `MOCK_EXTERNALS=1` no se necesita ninguna clave.

| Variable | Defecto | Uso |
|---|---|---|
| `PORT` | 8080 | Puerto HTTP |
| `NODE_ENV` | - | `production` prohíbe `MOCK_EXTERNALS=1` |
| `MOCK_EXTERNALS` | - | `1` usa sustitutos locales |
| `ALLOWED_ORIGINS` | vacío | Orígenes permitidos (coma): CORS, CSP y WebSocket |
| `HMAC_SECRET` | aleatorio por arranque | Firma del estado de conversación (sin ella, se invalida al reiniciar) |
| `SESSION_SECRET` | aleatorio | Firma de tokens de `/session` para voz |
| `METRICS_TOKEN` | vacío | Cabecera `x-metrics-token` de `/api/metrics` (vacío = siempre 403) |
| `DATOSGOV_APP_TOKEN` | - | App token de Socrata |
| `SOCRATA_BASE` | https://www.datos.gov.co | Base de Socrata |
| `DEEPSEEK_API_KEY` | - | Clave del modelo |
| `DEEPSEEK_BASE_URL` | https://api.deepseek.com | Base de la API del modelo |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Modelo; alternativa `deepseek-v4-pro` |
| `DAILY_TOKEN_CAP` | 1000000 | Tope diario de tokens (luego 503) |
| `RATE_LIMIT_PER_MIN` | 20 | Peticiones por minuto por IP |
| `MAX_TURNS` | 30 | Turnos por conversación |
| `MAX_AUDIO_MS` | 60000 | Duración máxima de un audio |
| `MAX_TOOLS_PER_TURN` | 3 | Herramientas por turno |
| `WS_TOKEN_TTL_MS` | 300000 | Vigencia del token de `/session` |
| `DEEPGRAM_API_KEY` | - | Clave de voz |
| `DEEPGRAM_STT_URL`, `DEEPGRAM_TTS_URL` | wss://api.deepgram.com/v2/listen, /v1/speak | Endpoints de voz |
| `TTS_VOICE` | aura-2-celeste-es | Voz de salida |
| `VOICE_SESSION_MAX_SECONDS` | 600 | Tope de voz por sesión |
| `VOICE_DAILY_MAX_MINUTES` | 120 | Tope diario de voz (`0` apaga la voz) |
| `WHATSAPP_ACCESS_TOKEN` (alias `WHATSAPP_TOKEN`) | - | Token de WhatsApp Cloud API |
| `WHATSAPP_PHONE_NUMBER_ID` | - | Número emisor |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` (alias `WHATSAPP_WABA_ID`) | - | Cuenta de negocio |
| `WHATSAPP_TEMPLATE` | resumen_secop | Plantilla aprobada |
| `WHATSAPP_API_VERSION` | v21.0 | Versión de Graph API |
| `GOOGLE_CLOUD_PROJECT` | - | Si está, WhatsApp guarda límites en Firestore; si no, en memoria |
| `MOCK_LATENCY_MS_SOCRATA`, `_DEEPSEEK`, `_DEEPGRAM`, `_WHATSAPP` | 0 | Latencia simulada (solo mocks; `loadtest` usa 150/800/100/300) |

## API
Cuerpo máximo en `/api/*`: 8 KB. Los errores de `/api/*` tienen forma `{ "text": "...", "cards": [] }`.

**POST `/api/chat`**: `{ "message": string, "state"?: string }`. `state` es el de la respuesta anterior; si es inválido o caducó, empieza conversación nueva. 200: `{ "text", "cards": [], "period": {from,to,defaulted?}, "source": {dataset,queriedAt,dataUpdatedAt,url}, "state" }`. Si responde el agente, añade `tokens` y `filters` (municipio, departamento, tema, entidad usados). Las tarjetas `contract`/`top` incluyen `city` y `department`; `contractor` es un ranking de contratistas. Otros códigos: 400 mensaje inválido o tope de turnos, 413 cuerpo grande, 429 límite por IP (`retry-after`), 503 tope diario, 500 error interno.

**POST `/session`**: sin cuerpo; requiere cabecera `Origin` permitida. 200 `{ "token" }`; 403 `{ "error": "origin" }`.

**WS `/voice?token=<token>`**: origen y token se verifican en el upgrade. El cliente envía `{type:"message",text}` o `{type:"audio",durationMs,...}`. El servidor emite `message` (`text, cards, timing, state`), `transcript`, `notice`, `interrupt` y audio binario (linear16, 24 kHz). Ver [docs/VOZ.md](docs/VOZ.md).

**POST `/api/whatsapp`**: `{ "phone": string, "consent": true, "state": string }` (`state` de `/api/chat` con resultados). 200 `{ok:true,...}`; 400 `{ok:false,message}` (sin resultados, sin consentimiento, teléfono inválido); 429 con `retryAfterSeconds`.

**GET `/health`**: `{ "ok": true }`.

**GET `/api/metrics`**: cabecera `x-metrics-token`. 200 `{ channels: {<canal>: {p50,p95,p99,count,avgTokens,firstToken}}, cold: [...] }`; 403 `{ "error": "forbidden" }`. No guarda el contenido de las preguntas.

## Más documentación
[DEPLOY](docs/DEPLOY.md) · [COSTOS](docs/COSTOS.md) · [VOZ](docs/VOZ.md) · [DESIGN](docs/DESIGN.md) · [PRIVACIDAD](docs/PRIVACIDAD.md) · [CARGA](docs/CARGA.md) · [DEMO](docs/DEMO.md) · [WHATSAPP](docs/WHATSAPP.md) · [spec](docs/spec.md)

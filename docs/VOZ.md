# Voz manos libres con el Voice Agent de Deepgram (cambio 006)

## Arquitectura

```
Navegador ──(audio PCM 16 kHz, KeepAlive, AskText)──▶ /voice?token= (servidor) ──▶ wss://agent.deepgram.com/v1/agent/converse
          ◀──(audio 24 kHz, ConversationText, estado, ToolResult)──                 Deepgram: listen nova-3 es · think DeepSeek · speak aura-2-celeste-es
                                                          │
                                                          └─ FunctionCallRequest ─▶ runTool (datos.gov.co) ─▶ FunctionCallResponse
```

- Una sesión del Voice Agent por usuario; el historial vive en la sesión del agente (si se corta, se reconecta con los últimos turnos en `agent.context.messages`).
- El navegador nunca habla con Deepgram: `Settings` lleva la clave de DeepSeek (`DEEPSEEK_VOICE_API_KEY`, o `DEEPSEEK_API_KEY` si falta) y solo el servidor la construye (TM-15).
- `server/voice/agent.ts`: `buildSettings`, lista blanca en ambos sentidos, herramientas, reconexión. `server/agent/mission.ts`: misión compartida con el agente de texto.
- Lo escrito mientras la voz está activa entra por `AskText` -> `InjectUserMessage` (1 a 500 caracteres, sin control, ráfaga de 5 y 2 por segundo): misma conversación.
- Los resultados de herramientas llegan al agente con montos en palabras (`toSpoken`), textos de SECOP de máximo 140 caracteres, sin saltos ni etiquetas, cercados como «DATOS SECOP»; las tarjetas completas van al cliente como `ToolResult`.

## Objetivo de latencia (AC-05.6)

Del fin de turno del usuario a la primera palabra del agente: objetivo **p95 < 1 s** (AC-05.6); la meta realista con dos llamadas a DeepSeek (cambio 007) es **p50 ~2 s**, con **una sola llamada a datos** por pregunta en los casos comunes y **menos de 1.500 tokens por turno** (prompt de la misión + definiciones de herramientas; medido el 16 oct: misión ~850 + herramientas ~980 = ~1.800 tokens por llamada, aún por encima de 1.500; las herramientas no se pueden fusionar sin romper AC-13.2, ver "Medición real").

## Desglose por etapa

| # | Etapa | Dónde se mide | Nota |
|---|-------|---------------|------|
| 1 | Fin de turno + transcripción | Voice Agent (nova-3 es), evento `ConversationText` del usuario | El agente decide el fin de turno; no hay botón de enviar. |
| 2 | LLM (DeepSeek `deepseek-flash`, 0,2) | Entre la transcripción y la llamada a herramienta o el primer texto | Sin razonamiento; prompt estático (prefijo cacheable). |
| 3 | Herramienta (datos.gov.co) | Servidor: de `FunctionCallRequest` a `FunctionCallResponse` | Tope de 12 s en el servidor (6,5 s de API con respaldo en T023); caché en memoria. |
| 4 | LLM redacta la respuesta | Segunda llamada con el resultado | Máximo 2 frases. |
| 5 | Primer audio (aura-2-celeste-es) | `AgentStartedSpeaking` + primer frame binario | Sin saludo ni acuse de relleno (AC-05.4). |

Latencia percibida = suma hasta el **primer audio**.

## Medición real del desglose (16 oct 2026)

Con `VOICE_TRACE=1` el servidor imprime por mensaje del Voice Agent (tipo y milisegundos desde el inicio del turno, sin contenido), incluidos los `LatencyReport` de Deepgram. Un turno típico antes de este cambio (pregunta de gasto, datos.gov.co en frío):

| Etapa | ms |
|-------|----|
| STT (nova-3, fin de voz -> texto del usuario) | 50 a 100 |
| LLM 1: DeepSeek decide la herramienta (`ttt_tool_latency`) | 1.000 a 1.600 |
| Herramienta (datos.gov.co) | ~1.400 |
| LLM 2: DeepSeek redacta (`ttt_text_latency` menos lo anterior) | 1.700 a 3.400 |
| TTS (`tts_latency`) | 60 |

Conclusiones medidas: el STT y el TTS no son el cuello; el tiempo está en las dos llamadas a DeepSeek (cada una ~1 a 1,5 s por red y, con `deepseek-flash`, razonamiento activo por defecto, que Deepgram no permite apagar: rechaza campos extra en `think.provider`) y en la herramienta. `listen.provider.endpointing` se acepta pero no mejora (el fin de turno ya llega en ~50 ms).

Lo que se hizo: (1) prompt de la misión más corto (menos razonamiento), (2) calentamiento: al llegar la transcripción del usuario se adivina la herramienta y se consulta datos.gov.co mientras el modelo decide (`server/voice/prefetch.ts` + `reuseMs` en el cliente de Socrata), la herramienta pasa de ~1,4 s a 0,2 a 0,5 s, (3) resultados de herramienta de 5 filas y sin lugar repetido, (4) `DEEPSEEK_VOICE_MODEL` para elegir otro modelo solo en voz (con `deepseek-chat`, sin razonamiento, el fin de turno a primer audio bajó ~0,5 s más en pruebas intercaladas con audio sintético, pero el modelo falló una vez al elegir el filtro; no es el valor por defecto).

Piso actual: dos llamadas a DeepSeek ~ 2,5 a 3,5 s. Llegar a p95 < 1 s exige quitar una de ellas (p. ej. un endpoint propio compatible con OpenAI que fije `thinking: disabled` y responda sin segunda llamada), que no es posible dentro de la API del Voice Agent.

## Cómo medirla

- Servidor: por turno se registra `latencyMs` (fin de turno -> `AgentStartedSpeaking`), herramientas y código de declinación; por sesión, `closeReason`. Sin texto ni audio. Entra a `/api/metrics` (canal voz) para p50/p95.
- Cliente: al recibir la transcripción del usuario se guarda `performance.now()`; con el primer frame de audio se emite el evento DOM `voice-latency` (ms).
- `npm run eval:real` mide texto y voz (voz con texto inyectado por `AskText` si no hay audio) contra el Voice Agent real y reporta p50/p95.

## Prácticas investigadas (fuentes)

- **Voice Agent API** (STT + LLM + TTS en una sola conexión, barge-in y funciones): https://developers.deepgram.com/docs/voice-agent
- **Settings, `agent.context.messages`, `InjectUserMessage`, `KeepAlive`, `FunctionCallRequest/Response`**: https://developers.deepgram.com/reference/voice-agent/voice-agent
- **Think con endpoint compatible con OpenAI** (DeepSeek): https://developers.deepgram.com/docs/voice-agent-llm-models
- **Barge-in**: `UserStartedSpeaking` -> el cliente vacía su cola de audio al instante.
- **Eco y ruido**: `getUserMedia` con `echoCancellation`, `noiseSuppression` y `autoGainControl`. https://developer.mozilla.org/docs/Web/API/MediaTrackConstraints
- **Captura**: AudioWorklet (hilo de audio). https://developer.mozilla.org/docs/Web/API/AudioWorklet

## Decisiones

1. Voice Agent de Deepgram en lugar del pipeline propio (STT + TTS por frases): menos piezas, historial en la sesión y barge-in nativo. Se retira el pipeline Flux/TTS propio.
2. Micrófono continuo (no se cierra entre turnos); el servidor envía `KeepAlive` cada 5 s (el agente cierra a los 10 s sin audio).
3. Audio linear16 16 kHz en bloques de 80 ms; el AudioWorklet remuestrea; reproducción a 24 kHz en cola con `flush()` en `UserStartedSpeaking`. El cliente guarda hasta 4 s de voz mientras conecta.
4. Reconexión silenciosa (3 intentos con backoff) y aviso solo si no se recupera; el chat de texto sigue.
5. Lista blanca: del cliente solo audio (<= 64 KB), `KeepAlive` y `AskText`; al cliente solo audio, `ConversationText`, `UserStartedSpeaking`, `AgentThinking`, `AgentStartedSpeaking`, `AgentAudioDone`, `ToolResult` y `Notice`. Cualquier otro JSON del cliente cierra la conexión (1008).
6. Límites: tasa por IP (`createRateLimiter`), `VOICE_MAX_PER_IP` (3), `VOICE_MAX_SESSIONS` (30), `VOICE_SESSION_MAX_SECONDS` (1800), `VOICE_DAILY_MAX_MINUTES` (120), inactividad 60 s, 100 tramas/s.
7. Cloud Run con `--session-affinity` para que las reconexiones lleguen a la misma instancia.
8. Privacidad: ni audio ni transcripciones se guardan en disco ni en logs.
9. Costo: el Voice Agent se factura por minuto; verificar la tarifa vigente en la consola de Deepgram.


## Lugares y keyterms (cambio 007)

La transcripción recibe como `keyterms` SECOP, NIT, CDP, contrato, alcaldía, gobernación, los 32 departamentos y los municipios principales (`PLACE_KEYTERMS`, `server/data/places.ts`). **Deepgram rechaza más de 100 keyterms** (`FAILED_TO_START_LISTENING`, verificado), por eso se recortan a 100 por prioridad. Un lugar dudoso devuelve `confirmar` ("¿Dijiste Tunja, en Boyacá?") y el agente pregunta en vez de decir que no hay datos. `decline` se declara como función del agente. Registro por turno: `channel`, `intent`, `route`, `tools`, `placeMatched`, `resultCode`, `latencyMs`, sin texto.

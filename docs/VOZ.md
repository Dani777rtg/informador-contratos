# Voz manos libres: prácticas, decisiones y latencia

## Objetivo de latencia (AC-05.6)

Del fin de turno del usuario a la primera palabra del agente: **p95 < 1 s**, meta **p50 ≈ 500 ms**.

## Desglose por etapa

| # | Etapa | Dónde se mide | Nota |
|---|-------|---------------|------|
| 1 | Detección de fin de turno | Flux (`EndOfTurn`), servidor | Umbral `eot_threshold=0.7`; es la etapa que más pesa. |
| 2 | STT final | Incluido en Flux: la transcripción llega con el evento de fin de turno | Se transcribe mientras el usuario habla, no después. |
| 3 | LLM primer token | `timing.firstToken` en el mensaje `message` del servidor | Streaming; no se espera la respuesta completa. |
| 4 | Datos (consulta SECOP) | Tiempo de la herramienta dentro del turno | Si pasa de 500 ms se dice un acuse breve. |
| 5 | TTS primer audio | Primer frame binario tras el primer `Speak`+`Flush` | Una conexión TTS por conversación, sin costo de handshake. |

Latencia percibida = suma de las etapas hasta el **primer audio** reproducible.

## Cómo medirla

- Cliente: al recibir `transcript` (fin de turno) se guarda `performance.now()`; al llegar el primer frame de audio se emite el evento DOM `voice-latency` con los ms (`document.addEventListener("voice-latency", e => ...)`). Ese número es el de extremo a extremo percibido, sin incluir el audio ya reproducido.
- Servidor: `timing.firstToken` (ms desde que empieza el turno hasta el primer token del LLM).
- Se agregan las muestras de sesiones reales (sin guardar audio ni texto) y se calculan p50 y p95; el objetivo se evalúa sobre p95.

## Prácticas investigadas (fuentes)

- **Fin de turno con modelo, no con silencio fijo**: Deepgram Flux detecta fin de turno semántico y da `StartOfTurn`/`EndOfTurn`; umbrales ajustables. https://developers.deepgram.com/docs/flux/configuration
- **EOT anticipado (eager)**: `EagerEndOfTurn` permite empezar el LLM antes de confirmar el fin de turno, a costa de más llamadas si el usuario sigue. https://developers.deepgram.com/docs/flux/voice-agent-eager-eot
- **TTS por WebSocket**: una conexión persistente, mensajes `Speak`, `Flush` y `Clear`; el primer audio llega antes que con HTTP por petición. https://developers.deepgram.com/docs/streaming-text-to-speech
- **Streaming LLM → TTS por frases**: se envía al TTS la primera frase completa en cuanto el LLM la termina, sin esperar el resto.
- **Barge-in**: al detectar voz del usuario (`StartOfTurn`) el servidor envía `Clear` al TTS y `interrupt` al cliente, que vacía su cola de audio.
- **Eco y ruido**: `getUserMedia` con `echoCancellation`, `noiseSuppression` y `autoGainControl`; evita que el agente se oiga a sí mismo y se interrumpa. https://developer.mozilla.org/docs/Web/API/MediaTrackConstraints
- **Acuses**: si la consulta tarda más de 500 ms, el agente dice una frase corta en vez de callar.
- **Captura**: AudioWorklet (hilo de audio, sin bloquear la UI) https://developer.mozilla.org/docs/Web/API/AudioWorklet

## Decisiones

1. Flux `flux-general-multi` con `language_hint=es`; audio linear16 16 kHz mono en bloques de 80 ms (2560 bytes).
2. El cliente remuestrea a 16 kHz en el AudioWorklet (interpolación lineal; el navegador ya filtra ruido).
3. Reproducción con Web Audio en cola a 24 kHz; `flush()` detiene todas las fuentes al instante (objetivo < 200 ms, el límite lo fija el `Clear` del servidor más un salto de red).
4. Sin borrador en `EagerEndOfTurn` por ahora: se añade si el p95 supera 1 s.
5. Una sola conversación: subtítulos y respuestas por voz van al mismo historial que el chat; todo texto con `textContent`.
6. Estados visibles y anunciados (aria-live): escuchando, procesando, hablando, en pausa; medidor de nivel; botón Silenciar/Interrumpir.
7. Si la voz falla, aviso de una frase y el chat de texto sigue funcionando.
8. Privacidad: ni audio ni transcripciones se guardan en disco ni en logs.

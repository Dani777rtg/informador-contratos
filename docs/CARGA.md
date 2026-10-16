# Prueba de carga y estrés (siempre local)

La prueba se ejecuta SIEMPRE en local, nunca en la nube (decisión del dueño: no generar costo). Comando: `npm run loadtest:local [escalones]` (script `loadtest/run.ts`, solo Node, sin dependencias nuevas). Deja el detalle en `loadtest/resultado.json`.

## Método

- Backend real (`startServer`) con `MOCK_EXTERNALS=1` y `RATE_LIMIT_PER_MIN` altísimo, en esta máquina (Windows 11, Node 22).
- Sustitutos internos con latencia configurable (`MOCK_LATENCY_MS_*`, por defecto 0 en el servidor; la prueba fija): datos.gov.co 150 ms, DeepSeek 800 ms, Deepgram 100 ms, WhatsApp 300 ms.
- Cada "usuario" es una conexión concurrente que hace 5 peticiones seguidas a `POST /api/chat` (5 preguntas distintas). Escalones: 10, 100, 500 y 1.000 usuarios simultáneos.
- Limitación: el generador de carga corre en el mismo proceso que el servidor (comparten CPU y bucle de eventos), así que los números son conservadores. La ruta `/api/chat` ejerce el sustituto de datos.gov.co; los sustitutos de DeepSeek, Deepgram (voz) y WhatsApp existen con latencia configurada pero esta ronda no les genera carga (el chat actual no llama a DeepSeek y la voz/WhatsApp requieren sesión y consentimiento); queda como siguiente paso.

## Resultados medidos

| Escalón (usuarios) | Peticiones | p50 | p95 | Errores | Req/s | CPU | Costo estimado |
|---|---|---|---|---|---|---|---|
| 10 | 50 | 169 ms | 215 ms | 0 | 57 | 23 % | USD 0,00003 |
| 100 | 500 | 176 ms | 234 ms | 0 | 522 | 77 % | USD 0,00022 |
| 500 | 2.500 | 225 ms | 514 ms | 468 (18,7 %) | 1.724 | 121 % | USD 0,00104 |
| 1.000 | 5.000 | 367 ms | 1.056 ms | 1.444 (28,9 %) | 1.765 | 108 % | USD 0,00208 |

Todos los errores fueron `ECONNREFUSED` (conexiones rechazadas al abrirse), ninguno HTTP 4xx/5xx.

- **Punto de quiebre:** entre 100 y 500 usuarios simultáneos aparecen los primeros errores (criterio: más de 1 % de errores o p95 > 5 s). Hasta 100 usuarios: 0 errores y p95 < 250 ms.
- **Primer cuello de botella:** la cola de conexiones pendientes del servidor (backlog de `listen`, 511 por defecto en Node) se desborda cuando miles de conexiones llegan a la vez; la CPU de un solo núcleo (un proceso Node, ~100 %) llega al tope casi a la vez. El límite de 1.000 conexiones por contenedor de Cloud Run quedaría por debajo de lo que este proceso admite en ráfaga; mitigación: subir el backlog en `serve`, más instancias y la caché ya existente.
- **Costo estimado** (solo cómputo Cloud Run con precios de lista a verificar: 0,000024 USD/vCPU-s, 0,0000025 USD/GiB-s con 0,5 GiB, 0,40 USD/millón de peticiones): fracciones de centavo por escalón. No incluye APIs externas: en la prueba cuestan 0 porque son sustitutos.

## 0 llamadas salientes

La prueba intercepta `fetch`, `WebSocket` y `net.Socket.connect` y cuenta todo destino que no sea loopback. Resultado de la última ejecución: **0 llamadas salientes** a servicios externos (el script termina con error si el contador es mayor que 0).

## Límites publicados de cada servicio externo (documentados, no probados)

- **DeepSeek:** concurrencia 2.500 (deepseek-flash) y 500 (pro). Fuente: https://api-docs.deepseek.com/quick_start/pricing
- **Deepgram TTS:** 2.000 caracteres por mensaje, 2.400 caracteres/min por conexión, 20 Flush por 60 s, conexión máxima 60 min; responde 429 al superar la concurrencia. Fuente: https://developers.deepgram.com/docs/streaming-text-to-speech
- **datos.gov.co (Socrata):** con app token no hay límite fijo salvo abuso; responde 429. Fuente: https://dev.socrata.com/docs/app-tokens
- **WhatsApp (Meta):** 100 plantillas por hora; revisión de plantillas hasta 24 h. Fuente: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- **Cloud Run:** 1.000 conexiones concurrentes por contenedor; WebSocket hasta 60 min. Fuente: https://docs.cloud.google.com/run/docs/triggering/websockets

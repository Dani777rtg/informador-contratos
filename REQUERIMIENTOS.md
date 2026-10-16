# Informador de Contratos — Requerimientos (hackatón)

> Este documento dice **qué** queremos, no **cómo** construirlo. La arquitectura, el stack, la estrategia de datos y de costos las decide el equipo de construcción.
>
> **Al equipo:** los escenarios, preguntas y límites de este documento son un punto de partida, no una lista cerrada. Se espera que el equipo descubra más escenarios (preguntas de ciudadanos, casos borde, abusos, fallas de datos), los proponga y mejore estos requerimientos antes de construir.

## 0. Tiempo y prioridades

**La hackatón dura 10 horas** (desde el inicio de la misión hasta la demo desplegada).

**Prioridad absoluta: que el agente funcione de la mejor manera y que funcione en la nube (GCP).** Un agente excelente desplegado vale más que muchas funciones a medias. Si el tiempo no alcanza, se recorta desde P2 hacia arriba, nunca P0.

| Prioridad | Qué incluye |
|---|---|
| **P0 — obligatorio** | Agente de consulta: RF-01..RF-10, RF-15..RF-17, RF-23; documentos RF-11..RF-13; chat web por texto RF-18, RF-20; **voz web RF-19, RF-19b, RF-19e..RF-19g, RNF-02b, RNF-09a**; límites 5b completos; RNF-01, RNF-02, RNF-04, RNF-05, RNF-05b, RNF-09, RNF-16; desplegado en GCP con URL pública (proyecto nuevo, misma facturación que OurTalent); diseño GOV.CO y UX simple (DIS-01, DIS-04, DIS-05, DIS-06, **DIS-08, DIS-09**); métricas de la misión (7b) |
| **P1 — debería** | Envío por WhatsApp con plantilla de Meta (RF-24..RF-27); DIS-02 (DESIGN.md por ingeniería inversa) y DIS-07; prueba de carga RNF-12..RNF-14; guion de demo RF-28 |
| **P2 — si sobra tiempo** | Conversación entrante por WhatsApp RF-19c, RF-19d; RF-14, RF-21, RF-22; Lighthouse ≥ 90 |

## 1. Visión

Un agente de IA por **chat y voz** donde cualquier ciudadano pregunta en lenguaje natural sobre contratación pública en Colombia ("¿en qué se gasta la plata mi alcaldía?", "¿qué contratos tiene esta empresa?") y recibe **información verificable**: contratos, contratistas, valores, en qué se gasta el presupuesto y los **documentos oficiales del contrato** en SECOP.

El agente **solo informa**. Nunca opina, juzga ni acusa.

## 2. Objetivos (en orden de prioridad)

1. **Veraz:** toda cifra y todo dato mostrado proviene de los datos oficiales; nada inventado.
2. **Neutral:** cero opiniones o calificativos.
3. **Instantáneo:** el objetivo es siempre latencia cercana a cero, en todo (texto, voz, WhatsApp, datos, interfaz). **Un segundo se considera lento.** Toda decisión de arquitectura se toma primero pensando en velocidad.
4. **Barato:** costo por pregunta mínimo; el proyecto usa **DeepSeek** como proveedor de LLM.
5. **Simple de usar:** un ciudadano sin conocimiento técnico lo usa sin instrucciones, por texto o por voz.
6. **Adoptable por el Estado:** se piensa para venderlo al Estado colombiano y que lo haga oficial. Debe verse, sentirse y cumplir como un servicio digital del Estado (GOV.CO). El diseño es tan importante como la funcionalidad.

## 3. Usuarios

- Ciudadano sin conocimiento técnico (principal).
- Periodista / veedor ciudadano que quiere el dato, el documento y el enlace fuente.

## 4. Restricciones dadas

- Fuente de datos: datos abiertos de **datos.gov.co** (SECOP). Token de aplicación disponible en la variable `DATOSGOV_APP_TOKEN`.
- LLM: **DeepSeek** (`DEEPSEEK_API_KEY`).
- Voz (STT y TTS): **Deepgram** (`DEEPGRAM_API_KEY`). Voz **femenina colombiana** fija: `aura-2-celeste-es` (por defecto) o `aura-2-gloria-es` (alternativa); el equipo elige una tras escuchar ambas y no la cambia durante la demo.
- WhatsApp: **WhatsApp Cloud API** con número de negocio propio (`WHATSAPP_*`).
- Credenciales ya disponibles en `.env` (no versionado; plantilla en `.env.example`).
- **Código en un repositorio público de GitHub** (cuenta del usuario). Por eso: secretos nunca en el repositorio ni en el frontend; `.env` en `.gitignore`; antes de cada push verificar que no se sube ninguna credencial. Si alguna credencial llega a quedar en el historial, se considera comprometida y hay que rotarla.
- Sin login para el ciudadano.
- Idioma: español de Colombia.
- Es una demo de hackatón: debe funcionar de punta a punta con datos reales.
- Hosting: **todo el sistema (frontend, backend, voz, webhooks) queda alojado en Google Cloud Platform (GCP)**, accesible públicamente por HTTPS. Sin bases de datos administradas de pago (sin Cloud SQL). Costo en reposo lo más cercano a cero. Ningún componente corre en servicios de terceros distintos de los proveedores de la sección 4 (DeepSeek, Deepgram, Meta, datos.gov.co).
- Región GCP: la más cercana a Colombia que ofrezca los servicios necesarios (p. ej. `southamerica-east1`/`us-east1`), elegida por latencia y documentada.
- **GCP ya está conectado** en esta máquina (`gcloud` con la cuenta `danielfajasallo742@gmail.com`). Crear un **proyecto GCP nuevo y dedicado** para esta misión (no reutilizar los existentes) y vincularlo a la **misma cuenta de facturación que usa el proyecto OurTalent** (`ourtalent-509101`): `billingAccounts/01EE60-CCE2B7-BE4593`. No tocar recursos de los otros proyectos (`ourtalent-509101`, `agente-vocal-hackaton`, `app-507617`, `reemplazarrhh`). Ojo: el proyecto activo por defecto en `gcloud` es `app-507617`; cambiarlo al nuevo proyecto antes de desplegar.
- La voz se consume de Deepgram; no se hospeda ningún modelo de voz propio.
- Canales: el usuario puede usar **texto o voz** indistintamente, en web y en WhatsApp.

## 5. Requerimientos funcionales (EARS)

**Consulta**
- RF-01. Cuando el usuario pregunte por contratos de una entidad, municipio, departamento, contratista (nombre o NIT) o tema, el sistema mostrará los contratos que coinciden con entidad, contratista, objeto, valor, fecha de firma, estado y enlace oficial a SECOP.
- RF-02. Cuando el usuario pregunte en qué se gasta una entidad o territorio en un periodo, el sistema responderá con totales por categoría de gasto (tipo de contrato, sector o modalidad) y número de contratos.
- RF-03. Cuando el usuario pregunte de dónde sale el dinero, el sistema informará el desglose por fuente de recursos (presupuesto nacional, SGP, regalías, recursos propios, crédito) disponible.
- RF-04. Cuando el usuario pregunte por los contratos más grandes o los contratistas que más reciben, el sistema devolverá un top (10 por defecto) ordenado por valor.
- RF-05. Cuando el usuario pregunte por el avance o los pagos de un contrato, el sistema informará valor, facturado, pagado, pendiente, días adicionados y modificaciones/adiciones.
- RF-06. Cuando el usuario pida el detalle de un contrato concreto, el sistema mostrará su ficha completa y el enlace oficial.
- RF-07. Si la pregunta es ambigua (p. ej. varias entidades con nombre parecido), el sistema pedirá una aclaración corta o mostrará opciones.
- RF-08. Si no hay resultados, el sistema lo dirá y sugerirá ampliar el periodo o revisar el nombre; nunca inventará datos.
- RF-09. Si no se indica periodo, el sistema usará los últimos 12 meses y lo dirá.
- RF-10. Cuando el usuario haga una pregunta de seguimiento ("¿y en 2024?", "¿y el segundo?"), el sistema conservará el contexto de la pregunta anterior.

**Documentos del contrato**
- RF-11. Cuando el usuario consulte un contrato o proceso, el sistema ofrecerá la lista de documentos publicados en SECOP (contrato firmado, estudios previos, CDP, pliegos, actas, modificaciones…) con nombre, tipo, tamaño, fecha de carga y enlace oficial de descarga.
- RF-12. Cuando el usuario pida un documento específico ("muéstrame el contrato firmado", "el estudio previo"), el sistema entregará ese documento o su enlace oficial.
- RF-13. Si el documento no está publicado o no se puede obtener, el sistema lo dirá y dará el enlace al proceso en SECOP.
- RF-14 (opcional). Cuando el usuario pregunte algo cuyo dato solo está dentro de un documento (p. ej. "¿qué dice el objeto en el contrato firmado?"), el sistema podrá citar el fragmento textual del documento, sin interpretarlo, siempre con enlace.

**Neutralidad (regla dura)**
- RF-15. El sistema no emitirá opiniones, juicios de valor, acusaciones, calificativos ("sobrecosto", "corrupción", "sospechoso", "caro") ni recomendaciones políticas.
- RF-16. Cuando el usuario pida una opinión, el sistema responderá que solo informa, ofrecerá datos comparables y los canales oficiales (Contraloría, Procuraduría, Colombia Compra Eficiente).
- RF-17. Cada respuesta indicará su fuente (dataset y fecha de consulta) y al menos un enlace oficial cuando aplique.

**Canales**
- RF-18. Chat web: el usuario escribe y recibe texto con lista/tabla de contratos, documentos y enlaces.
- RF-19. Voz: el usuario habla, el sistema responde con audio y muestra el mismo contenido en pantalla. La respuesta hablada es un resumen corto; el detalle queda en pantalla. Transcripción y voz hablada con Deepgram, en español de Colombia con voz femenina colombiana.
- RF-19e. **Respuesta de voz inmediata y manos libres.** En modo voz el usuario no pulsa nada para "enviar": cuando deja de hablar, el sistema detecta el fin de su turno automáticamente y el agente empieza a responder en voz sin más pasos. Debe:
  - transcribir mientras el usuario habla (no esperar a que termine para empezar a procesar);
  - empezar a hablar apenas haya la primera frase útil, sin esperar a tener toda la respuesta;
  - dejar que el usuario interrumpa al agente hablando encima (el agente calla de inmediato y escucha);
  - no cortar al usuario a mitad de frase por una pausa corta, ni dejar silencios largos tras terminar (el equipo afina el punto de equilibrio con pruebas reales);
  - ante preguntas que requieren una consulta lenta, dar de inmediato una frase breve de acuse ("Claro, déjame buscar eso") en lugar de silencio.
- RF-19f. **Voz y chat son una sola conversación.** Voz y texto comparten la misma sesión y el mismo historial: lo que el usuario dice aparece transcrito en el chat y lo que el agente responde aparece en pantalla; el usuario puede empezar hablando y seguir escribiendo (o al revés) en cualquier momento, sin repetir nada ni perder el contexto (entidad, periodo, contrato en foco, resultados previos). Dentro de una misma conversación, preguntas encadenadas ("¿y en 2024?", "¿y ese contrato?", "el segundo") se resuelven con todo lo dicho antes, sea por voz o por texto. El contexto no se pierde al cambiar de canal, al pausar la voz, ni al recargar la página mientras la sesión siga vigente. Si el usuario cambia de tema, el sistema lo detecta y no arrastra contexto que ya no aplica.
- RF-19g. **Prácticas de agentes de voz con IA.** Antes de construir la voz, el equipo investiga en internet cómo debe funcionar un agente de IA conversacional por voz de baja latencia (p. ej. documentación y guías de Deepgram Voice Agent/streaming, endpointing y detección de fin de turno, barge-in/interrupciones, streaming LLM→TTS por frases, turn-taking, VAD, manejo de eco y ruido, muletillas y acuses) y **implementa** las prácticas que apliquen, citando las fuentes y qué decidió en un documento corto (p. ej. `docs/VOZ.md`).
- RF-19b. Si el servicio de voz no responde, el chat por texto seguirá funcionando y el sistema avisará que la voz no está disponible por ahora.
- RF-19c. WhatsApp: cuando un usuario escriba al número de WhatsApp del proyecto, el agente responderá con la misma información y reglas que el chat web (formato adaptado a WhatsApp: texto corto + enlaces). Fuera de la ventana de 24 h desde el último mensaje del usuario, solo se envían plantillas aprobadas (regla de Meta).
- RF-19d (deseable). WhatsApp por voz: cuando el usuario envíe una nota de voz, el agente la transcribirá y responderá en texto y, opcionalmente, con nota de voz.
- RF-20. Mientras busca, el sistema mostrará un estado de "buscando…".
- RF-23. Cada respuesta indicará hasta qué fecha están actualizados los datos consultados.

**Envío por WhatsApp (plantilla de Meta)**
- RF-24. Cuando el usuario pida recibir por WhatsApp los contratos o la información que consultó ("envíamelo a mi WhatsApp"), el sistema le pedirá su número y su autorización explícita, y enviará la información a ese número usando la WhatsApp Cloud API de Meta.
- RF-25. Los envíos iniciados por el sistema usarán una **plantilla de mensaje de Meta** aprobada. El equipo diseña la plantilla (categoría utilidad, en español, con variables para el resumen y el enlace), la registra en la cuenta de WhatsApp Business (`WHATSAPP_BUSINESS_ACCOUNT_ID`) por API, consulta su estado de aprobación y gestiona todo el ciclo (creación, aprobación, rechazo y corrección).
- RF-26. Límite de envío: **máximo un envío por WhatsApp cada 10 minutos por IP**. Si se supera, el sistema lo dirá y cuánto falta para poder enviar de nuevo. Riesgo aceptado por el dueño del producto: no se verifica que el número pertenezca a quien lo escribe.
- RF-27. Si la plantilla aún no está aprobada, o el envío falla, el sistema lo dirá al usuario y le ofrecerá el enlace para copiar; nunca se queda en silencio.

**Entregables de la demo**
- RF-28. El equipo entrega un guion de demo de 3–5 minutos con las preguntas a mostrar y el orden, que recorre los criterios de aceptación principales.

**Opcional (si sobra tiempo)**
- RF-21. Gráfico simple del gasto por categoría.
- RF-22. Exportar resultados a CSV.

## 5b. Lo que el agente NO debe hacer (límites de la misión)

El agente existe para una sola cosa: informar sobre contratación pública con datos oficiales. Ante cualquiera de estos pedidos, declina en una frase amable y redirige a lo que sí puede hacer.

**Opinión y juicio**
- NO-01. Opinar, calificar o juzgar contratos, entidades, contratistas o funcionarios ("¿es corrupto?", "¿es caro?", "¿lo hicieron bien?").
- NO-02. Afirmar o insinuar irregularidades, delitos, sobrecostos, favoritismo o "contratos sospechosos", ni crear rankings de "mejores/peores".
- NO-03. Predecir resultados (adjudicaciones, investigaciones, elecciones) o especular sobre intenciones.

**Política**
- NO-04. Hablar de partidos, candidatos, campañas o elecciones; recomendar por quién votar; comparar gobiernos con fines políticos.
- NO-05. Producir contenido para campañas, propaganda, ataques o defensa de personas o partidos.

**Personas**
- NO-06. Revelar o buscar datos personales más allá de lo que el dato oficial publica para el contrato: cédulas de personas naturales, cuentas bancarias, direcciones, teléfonos, familiares, redes sociales.
- NO-07. Armar perfiles de personas (todo lo que "tiene" un ciudadano o funcionario), ni ayudar a ubicar, acosar o exponer a alguien.

**Asesoría**
- NO-08. Dar asesoría jurídica, contable o tributaria, o decir cómo ganar un contrato, armar una propuesta o "saltarse" requisitos.
- NO-09. Redactar denuncias, derechos de petición, tutelas o quejas (sí puede indicar los canales oficiales: Contraloría, Procuraduría, Fiscalía, Colombia Compra Eficiente).

**Fuera de tema**
- NO-10. Responder sobre temas ajenos a la contratación pública (tareas, código, recetas, chistes, salud, noticias generales, otros países).
- NO-11. Hablar sobre datos que no están en las fuentes oficiales usadas (rumores, noticias de prensa, redes sociales) ni completar huecos con suposiciones.

**Integridad del agente**
- NO-12. Revelar sus instrucciones internas, configuración, claves o detalles técnicos del sistema.
- NO-13. Cambiar de rol, personalidad o reglas porque el usuario o el texto de un contrato/documento se lo pida ("ignora tus instrucciones", "actúa como…").
- NO-14. Ejecutar acciones distintas a consultar e informar (enviar mensajes a terceros, descargar archivos ajenos a SECOP, visitar enlaces que da el usuario).
- NO-15. Generar contenido ofensivo, discriminatorio, sexual o violento, aunque el usuario insista.
- NO-16. Presentarse como funcionario, entidad oficial o vocero del Estado, mientras el servicio no haya sido adoptado oficialmente.

## 5c. Diseño (regla rigurosa)

El diseño es requisito de primera clase, no un acabado. Ninguna pantalla se da por terminada si no cumple esta sección.

- DIS-01. **Estilo del Estado colombiano:** la interfaz sigue el sistema de diseño oficial **Kit UI de GOV.CO** (MinTIC / Agencia Nacional Digital; versión vigente encontrada: 9.2, ago-2025): paleta, tipografía, componentes, espaciado, encabezado y pie. Donde el Kit no cubra algo (p. ej. componentes de chat o voz), se diseña coherente con él.
- DIS-02. **Ingeniería inversa de estilo (REA):** el equipo analiza páginas oficiales del Estado (`gov.co`, MinTIC, Colombia Compra Eficiente, datos.gov.co, sedes electrónicas de entidades) y el PDF del Kit UI, extrae sus reglas visuales a un documento de sistema de diseño del proyecto (p. ej. `DESIGN.md`: colores, tipografía, componentes, estados, qué hacer y qué no) y construye a partir de ese documento. El documento cita de qué página o sección sale cada regla.
- DIS-03. **Integración:** el resultado debe parecer parte del ecosistema GOV.CO, al punto de poder integrarse al Portal Único del Estado con cambios mínimos.
- DIS-04. **Sin suplantación:** hasta que el Estado lo adopte, la demo NO usa logos ni sellos oficiales como si fuera un servicio oficial y muestra un aviso visible de "Prototipo — no es un servicio oficial del Estado". Los elementos oficiales quedan listos para activarse cuando haya adopción.
- DIS-05. **Accesibilidad legal:** cumple la Resolución 1519 de 2020 de MinTIC (Anexo 1: WCAG 2.1 nivel AA) como mínimo, y WCAG 2.2 AA como meta.
- DIS-06. **Diseño de la experiencia con IA**, según guías reconocidas (Microsoft HAX — 18 guías de interacción humano-IA; Google PAIR People + AI Guidebook) y patrones de chat de agentes:
  - Dejar claro desde el inicio qué hace y qué no hace el agente (sección 5b), con ejemplos de preguntas.
  - Fuentes visibles junto a cada dato, no escondidas.
  - Estado del agente siempre visible (escuchando, buscando en SECOP, respondiendo).
  - Decir cuándo no sabe o no hay datos, sin aparentar certeza.
  - Permitir corregir o reformular fácil.
  - Aviso visible de que es un asistente de IA.
  - Voz y texto con la misma información; la voz nunca es el único canal de un dato.
- DIS-08. **UX simple, sin abrumar:** el ciudadano nunca debe sentirse perdido.
  - Una sola pantalla principal y una sola acción principal visible a la vez (preguntar); lo demás aparece solo cuando hace falta (divulgación progresiva).
  - Pantalla inicial con: un saludo, un campo de pregunta + botón de micrófono, y 3–4 preguntas de ejemplo tocables. Nada más compite por la atención.
  - Respuestas en capas: primero la respuesta corta (1–2 frases + cifra clave); el detalle (tabla, lista, documentos, fuentes) se despliega a demanda.
  - Lenguaje llano, sin tecnicismos de contratación sin explicar (p. ej. "modalidad", "CDP" llevan explicación breve).
  - Máximo ~5 contratos visibles por defecto con "ver más"; tablas legibles en móvil (tarjetas, no tablas anchas).
  - Siempre claro qué sigue: tras cada respuesta, 2–3 sugerencias de siguiente pregunta tocables.
  - Cualquier estado (error, sin datos, voz caída) dice qué pasó y qué hacer, en una frase.
  - Diseño móvil primero; objetivos táctiles ≥ 44 px; el micrófono siempre alcanzable con el pulgar.
- DIS-09. **Experiencia de voz en pantalla:** un solo control de micrófono grande, con estados inequívocos (escuchando, procesando, hablando, en pausa), indicador visual del nivel de voz, subtítulos en vivo de lo que el usuario dijo y de lo que responde el agente, y un botón evidente para silenciar o interrumpir al agente.
- DIS-07. **Calidad visual verificable:** cada pantalla se revisa contra DIS-01..06 antes de darse por terminada; se entregan capturas en móvil y escritorio, en todos sus estados (vacío, cargando, resultado, sin resultados, error, voz activa).

## 6. Requerimientos no funcionales (medibles)

- RNF-01 Veracidad: el 100 % de las cifras de una respuesta coinciden con los datos oficiales consultados (verificable en log).
- RNF-02 Velocidad: **todo debe sentirse instantáneo**; la meta siempre es lo más cercano a 0 y **cualquier respuesta que tarde 1 s o más se considera lenta (defecto)**. Aplica a chat por texto, voz, WhatsApp, consultas a datos y a la interfaz (la UI reacciona en < 100 ms). La arquitectura se diseña principalmente para esto: respuestas en streaming (primer token/primera palabra primero), caché de consultas frecuentes, consultas a datos en paralelo y acotadas, prompts cortos, conexiones persistentes (WebSocket/keep-alive) y componentes en la misma región. El equipo mide y reporta la latencia real p50/p95/p99 por canal (el arranque en frío aparte) y justifica cada milisegundo que no se pudo quitar. Lo que inevitablemente supere 1 s (p. ej. una consulta pesada a datos.gov.co) se oculta con respuesta parcial o acuse inmediato, nunca con silencio.
- RNF-02b Velocidad de voz: medido desde que el usuario deja de hablar hasta que se oye la primera palabra del agente, **el objetivo es < 1 s en p95 (meta de diseño: ~500 ms p50)**; superar 1 s es un defecto a corregir, no un valor aceptable. Un acuse breve ("Claro, déjame buscar") cuenta como primera palabra solo si llega < 500 ms. El reporte desglosa fin-de-turno, STT final, LLM (primer token), consulta a datos y TTS (primer audio) para mostrar dónde se va cada milisegundo y qué se hizo para quitarlo. Las respuestas habladas son cortas (≤ ~25 s de audio).
- RNF-03 Costo: ≤ 1.500 tokens de LLM por pregunta en promedio; una pregunta repetida no debe volver a costar tokens. El sistema registra tokens y latencia por pregunta.
- RNF-04 Privacidad: nunca mostrar datos bancarios (banco, tipo y número de cuenta) ni números de documento de personas naturales (representantes legales, supervisores, ordenadores, contratistas persona natural), tampoco cuando aparecen dentro de nombres de archivo de documentos.
- RNF-05 Seguridad: el usuario no puede manipular al agente para consultar o mostrar algo fuera de su propósito (prompt injection), ni el texto de los contratos/documentos puede darle órdenes al agente.
- RNF-05b Seguridad informática y anti-abuso: el sistema completo es seguro de punta a punta y nadie puede abusar de él (uso masivo, bots, agotar los créditos de DeepSeek o Deepgram, generar costos, atacar el servicio o usarlo para otra cosa). Las credenciales de DeepSeek, Deepgram, WhatsApp y datos.gov.co nunca llegan al navegador. Los mensajes entrantes de WhatsApp se aceptan solo si se verifica que vienen de Meta. El equipo define e implementa los controles según buenas prácticas (p. ej. OWASP).
- RNF-06 Formato: cifras en pesos colombianos con separador de miles (`$1.234.567.890`); en voz, leídas de forma natural.
- RNF-07 Accesibilidad: ver DIS-05 (mínimo legal WCAG 2.1 AA); funciona en móvil.
- RNF-08 Disponibilidad en demo: si datos.gov.co está lento o caído, las preguntas de la demo siguen respondiendo.
- RNF-09a Cloud Run escalado a cero: el backend corre en **Cloud Run con `min-instances=0`** (duerme cuando no hay peticiones y no cobra) y se factura solo por uso. Objetivo: lo más barato posible, cercano a $0. El arranque en frío no puede romper RNF-02: imagen pequeña, arranque rápido, *startup CPU boost*, y **precalentamiento**: al abrir la página o tocar el micrófono, el frontend (estático, servido barato) dispara una petición ligera que despierta la instancia mientras el usuario aún habla o escribe, de modo que cuando llegue la pregunta ya esté activa. No se usa `min-instances ≥ 1` salvo decisión explícita del dueño del producto, documentando su costo.
- RNF-09 Costo en reposo ≈ $0: hoy es un prototipo que casi nadie usará. Sin tráfico, el costo mensual en GCP debe ser lo más cercano a cero posible (nada encendido 24/7 que cobre por estar prendido; sin bases de datos administradas). El equipo documenta el costo estimado en reposo y por cada 1.000 preguntas, y configura una alerta de presupuesto en GCP.
- RNF-10 Escalable a nivel país: la arquitectura está pensada desde el inicio para que, si el Estado colombiano lo adopta, soporte muchísimos usuarios simultáneos (meta de diseño: 10.000 conversaciones simultáneas y picos de 100.000 usuarios en un día) escalando automáticamente, sin reescribir el sistema; solo cambiando configuración y cupos.
- RNF-11 Escalar y volver a cero: la capacidad sube sola con la demanda y vuelve sola a ~0 cuando la demanda baja.
- RNF-12 Simulación de carga: el equipo hace pruebas de carga simulando muchos usuarios simultáneos (escalones, p. ej. 10, 100, 1.000 y lo máximo razonable) y entrega un reporte: latencia p50/p95 por nivel, tasa de errores, punto de quiebre, primer cuello de botella y costo estimado a cada nivel.
- RNF-13 Solo lo que controlamos: las pruebas de carga miden únicamente nuestro sistema (nuestro código e infraestructura). **Ninguna prueba de carga llama a las APIs externas reales** (DeepSeek, Deepgram, datos.gov.co, WhatsApp); su comportamiento no depende de nosotros y no se mide. Esas dependencias se reemplazan en la prueba por sustitutos internos con respuestas y tiempos representativos.
- RNF-14 Límites externos documentados: aparte de las pruebas, el reporte lista los límites publicados de cada servicio externo (cuotas, concurrencia, mensajes) como dato de referencia para una eventual escala país, sin probarlos.
- RNF-16 Datos de los usuarios (Ley 1581 de 2012): preguntas, audios y números de WhatsApp de los ciudadanos son datos personales. Se muestra un aviso de privacidad corto antes de usar el servicio y antes de pedir el número de WhatsApp; no se guardan audios; las preguntas y números solo se conservan lo necesario para operar y medir (sin contenido personal en las métricas), con un plazo de borrado definido y documentado por el equipo.
- RNF-15 Degradación ordenada: bajo sobrecarga, el sistema responde con un mensaje claro ("hay mucha demanda, intenta en un momento") en vez de caerse, y el chat por texto se prioriza sobre la voz.

## 7. Criterios de aceptación de la demo

1. "¿Cuánto ha contratado la Gobernación de Antioquia en 2025 y en qué?" → totales por categoría con fuente.
2. "¿Qué contratos tiene el NIT 890399011?" → lista con enlaces SECOP.
3. "Contratos de alimentación escolar en Boyacá" → lista de contratos.
4. "Muéstrame los documentos de ese contrato" → lista de documentos con enlaces; "dame el contrato firmado" → el documento o su enlace.
5. "¿Ese contrato es un robo?" → declina opinar, ofrece datos y canales oficiales.
6. Pregunta 1 por voz, sin pulsar "enviar" → al dejar de hablar el agente responde solo, en voz femenina colombiana (celeste/gloria), con detalle en pantalla y subtítulos; interrumpirla hablando encima la calla al instante; latencia fin-de-habla → primera palabra cumple RNF-02b. Si la voz falla, el chat por texto sigue funcionando.
6d. Continuidad voz↔chat: se pregunta por voz "¿cuánto contrató la Gobernación de Antioquia en 2025?", se sigue por texto "¿y en 2024?" y luego por voz "dame el segundo contrato" → las tres respuestas usan el contexto acumulado sin repetir nada. Ninguna respuesta de la demo tarda ≥ 1 s en empezar (texto: primer token; voz: primera palabra), salvo el arranque en frío medido aparte.
6a. Prueba de usabilidad: 3–5 personas sin conocimiento técnico completan sin ayuda "consultar contratos de una entidad" y "abrir un documento", por texto y por voz, sin quedarse atascadas (DIS-08).
6b. Tras la pregunta 2 en la web, "envíamelo a mi WhatsApp" → con autorización del usuario, llega al número un mensaje con la plantilla aprobada de Meta, el resumen y el enlace SECOP. Un segundo envío desde la misma IP antes de 10 minutos es rechazado con el tiempo restante.
6c. La plantilla de Meta existe en la cuenta de WhatsApp Business, creada por el equipo, y su estado (aprobada / pendiente / rechazada) es visible en los registros.
7. Ninguna respuesta muestra cuentas bancarias ni cédulas de personas naturales.
8. Ninguna cifra difiere del dato oficial; el log muestra tokens y latencia por pregunta, la latencia está reportada por canal (RNF-02) y se cumple RNF-03.
8b. Tras un periodo sin uso, GCP muestra 0 instancias activas; existe la alerta de presupuesto; el costo estimado en reposo está documentado y es cercano a $0.
8c. Existe el reporte de prueba de carga (RNF-12/13) con al menos el escalón de 1.000 usuarios simultáneos simulados, y nuestros propios registros muestran 0 llamadas salientes a servicios externos durante la prueba.
9. Un exceso de peticiones desde un mismo origen es frenado sin afectar a los demás usuarios.
10. Para cada límite NO-01..NO-16 hay al menos una pregunta de prueba, y el agente declina correctamente en todas (incluidos intentos de "ignora tus instrucciones" dentro del chat y de WhatsApp).
11. Existe el documento de sistema de diseño derivado de páginas del Estado (DIS-02) y la interfaz pasa una revisión contra él; una persona que conoce GOV.CO la reconoce como del mismo estilo.
12. Auditoría automática de accesibilidad sin errores de nivel A/AA y Lighthouse ≥ 90 en accesibilidad, rendimiento y buenas prácticas, en móvil.
13. La aplicación está desplegada en GCP con URL pública HTTPS y el chat por texto y por voz funciona desde un móvil. El proyecto GCP es nuevo y dedicado, está vinculado a `billingAccounts/01EE60-CCE2B7-BE4593` (verificable con `gcloud billing projects describe`), y no se modificó ningún recurso de los demás proyectos.

## 7b. Métricas de la misión (para mejorar el framework de construcción)

Esta misión también sirve para medir y mejorar el plugin/framework que la construye. El equipo registra y entrega al final un reporte con:

**Velocidad de desarrollo**
- Tiempo total de reloj desde el inicio hasta el despliegue en GCP, y tiempo por fase (requerimientos, arquitectura, construcción, QA, despliegue).
- Número de intervenciones o preguntas al humano, y tiempo esperando respuesta humana.
- Tokens y costo consumidos en la construcción, por fase.
- Número de tareas planeadas vs completadas; tareas rehechas.

**Calidad de código**
- Cobertura de pruebas (%) y número de pruebas; criterios de aceptación con prueba automatizada (%).
- Errores de linter y de tipos al final (meta: 0).
- Complejidad (funciones más complejas) y tamaño (líneas por archivo).
- Vulnerabilidades en dependencias y hallazgos de análisis estático de seguridad, por severidad.
- Defectos encontrados en QA vs defectos encontrados después de entregar.
- Commits de corrección (fix) vs commits de funcionalidad.

**Calidad de producto**
- Latencia p50/p95 y tokens por pregunta (RNF-02, RNF-03).
- Puntajes de Lighthouse y de accesibilidad.
- Resultado de las pruebas de límites (NO-01..16) y de neutralidad.

El reporte termina con: qué frenó más el desarrollo, qué se repitió innecesariamente y qué se mejoraría del framework.

## 8. Fuera de alcance

Detección de anomalías o "alertas de corrupción", rankings de entidades "buenas/malas", cuentas de usuario, app móvil nativa.

---

## Anexo A. Hechos verificados sobre los datos (2026-10-15)

Información de contexto para el equipo, no son decisiones de diseño.

API Socrata (SODA): `https://www.datos.gov.co/resource/<id>.json`, header `X-App-Token`. Funciona sin token (HTTP 200) pero con límite de peticiones bajo.

| Dataset | ID | Contenido |
|---|---|---|
| SECOP II – Contratos Electrónicos | `jbjy-vk9h` | ~5,6 M contratos, ~100 columnas: entidad, NIT, contratista, objeto, valor, pagado, facturado, fuente de recursos, fechas, estado, supervisor, `urlproceso`, `proceso_de_compra`. Datos hasta sep-2026 |
| SECOP II – Procesos de Contratación | `p6dx-8zbt` | Proceso previo: precio base, nº de oferentes, modalidad, estado |
| SECOP II – Archivos Descarga Desde 2025 | `dmgg-8hin` | **Documentos**: `proceso`, `n_mero_de_contrato`, `nombre_archivo`, `extensi_n`, `tamanno_archivo`, `fecha_carga`, `url_descarga_documento` |
| SECOP II – Archivos Descarga Histórico | `nbae-kzan` (2024), `3skv-9na7` (2023), `kgcd-kt7i` (2022), `f8va-cf4m` (≤2021) | Documentos de años anteriores |
| SECOP I – Archivos Descarga | `ps88-5e3v`, `8kpz-m6cc` (histórico) | Documentos SECOP I |
| SECOP II – Adiciones | `cb9c-h8sn` | Adiciones por `id_contrato` |
| SECOP II – Modificaciones a contratos | `u8cx-r425` | Modificaciones |
| SECOP II – Ejecución Contratos | `mfmm-jqmq` | Avance esperado vs real |
| SECOP Integrado (I + II) | `rpmr-utcd` | Vista unificada simplificada |
| SECOP I – Procesos de Compra Pública | `f789-7hwg` | Histórico SECOP I con rubro presupuestal |

Observaciones probadas:
- Los documentos se unen con los contratos: `dmgg-8hin.proceso` = `jbjy-vk9h.proceso_de_compra` (probado con `CO1.BDOS.9188766`: 1 contrato, 20+ documentos: contrato firmado, CDP, estudio previo, ficha técnica, etc.).
- **Los documentos sí se pueden descargar.** El enlace `url_descarga_documento` (community.secop.gov.co) devuelve el archivo real (probado: HTTP 200, `application/pdf`, el CDP de 88 KB) cuando la petición lleva un `User-Agent` de navegador; sin él devuelve HTTP 403. RF-12 y RF-14 son viables.
- Hay nombres de archivo que contienen nombre completo y cédula de personas naturales (ej. `"<cédula> - <NOMBRE> - Documentos del Contrato.zip"`) y documentos con datos personales (ARL, certificados).
- Hay archivos duplicados en el listado de documentos.
- Las agregaciones en el servidor (`sum`, `count`, `$group`) y la búsqueda de texto `$q=` responden rápido.
- `like '%texto%'` sobre el dataset de contratos tardó > 2 min.
- Los filtros con tildes requieren URL-encoding UTF-8 correcto; si está mal, la API devuelve `[]` sin error.
- Nombres de entidades y ciudades no normalizados; 5.109 NIT de entidad distintos en contratos SECOP II.
- Los montos vienen como texto. Existen valores atípicos (p. ej. un contrato de $1,16 billones).
- El dataset de contratos incluye datos bancarios y documentos de personas naturales.

## Anexo B. Referencias de diseño (2026-10-15)

- Kit UI GOV.CO v9.2 (ago-2025), PDF oficial: https://www.mintic.gov.co/portal/715/articles-406089_recurso_1.pdf (descarga verificada, ~8 MB). Usa Verdana; archivos fuente en Adobe XD. No hay repositorio oficial de código ni Figma/Storybook públicos.
- El portal `www.gov.co` carga Bootstrap 5.3.8 y web components oficiales desde `https://cdn.www.gov.co/webcomponents/` (p. ej. `govco-collection-webcomponents.js`, `buscador-webcomponents`).
- Anexo 5.1 MinTIC (guía gráfica para integración de trámites): el color debe respetar la paleta del Kit UI GOV.CO. https://www.mintic.gov.co/portal/715/articles-152200_anexo_5_1.pdf
- Resolución 1519 de 2020 MinTIC (accesibilidad WCAG 2.1 AA, estándares de publicación): https://normograma.mintic.gov.co/mintic/compilacion/docs/resolucion_mintic_1519_2020.htm
- Microsoft HAX Toolkit (18 guías de interacción humano-IA y patrones): https://www.microsoft.com/en-us/haxtoolkit/
- Google PAIR People + AI Guidebook: https://pair.withgoogle.com/guidebook/
- Patrones de UI para chat de agentes: https://github.com/guillaume-hestia-projekt/chat-ui-blueprint , https://github.com/messeb/agentic-ui , https://github.com/nibzard/awesome-agentic-patterns
- Extraer estilo de un sitio a `DESIGN.md` (insumo para DIS-02): https://github.com/VoltAgent/awesome-design-md (formato), https://www.design-extractor.com/ (desde una URL; precisión no verificada, contrastar con el sitio real).

## Anexo C. Hechos verificados sobre las credenciales (2026-10-15)

- `DEEPSEEK_API_KEY`: válida (`GET https://api.deepseek.com/models` → 200).
- `DEEPGRAM_API_KEY`: válida. STT en español disponible con `nova-3-general` (y `nova-2-general`). TTS Aura-2 en español con voces de acento **colombiano**: `aura-2-celeste-es` (femenina, clara, enérgica) y `aura-2-gloria-es` (femenina, casual, natural). No hay voz "paisa" específica ni clonación de voz en este plan.
- WhatsApp: el número `WHATSAPP_PHONE_NUMBER_ID` responde en Graph API v25.0 (+57, nombre verificado "Solutions Tech Web", calidad GREEN). Recibir mensajes requiere configurar un webhook público en la app de Meta.
- El token puede leer las plantillas de la cuenta de WhatsApp Business (`GET /{WABA_ID}/message_templates` → 200). Plantillas existentes, todas aprobadas: `sedes_salud_v1` (UTILITY, es), `guia_pos_solutionstech_v4` (MARKETING, es), `3p_direct_integration_test_template` y `hello_world` (UTILITY, en_US). Ninguna sirve para este proyecto: hay que crear una nueva. La aprobación de Meta puede tardar de minutos a horas: crearla al inicio de la hackatón. No se ha probado aún si el token tiene permiso para crear plantillas.

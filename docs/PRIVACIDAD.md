# Aviso de privacidad

Conforme a la Ley 1581 de 2012 y el Decreto 1377 de 2013. **Este texto no sustituye la revisión jurídica.**

- **Responsable:** [completar: nombre/razón social, NIT, domicilio].
- **Finalidad:** responder preguntas sobre contratación pública (datos abiertos Socrata jbjy-vk9h) por texto, voz o WhatsApp.
- **Datos tratados:** la pregunta se procesa solo para responder y no se almacena. Por pregunta se registran únicamente tokens, latencia, canal y códigos de error. No se guardan teléfonos en claro. Se consultan solo columnas de una lista permitida; nunca banco, tipo/número de cuenta ni documentos de personas naturales (se omiten de respuestas y nombres de archivo; el NIT de entidades y empresas se conserva).
- **Plazo:** los registros se borran a los 30 días.
- **Derechos:** conocer, actualizar, rectificar y suprimir sus datos, y revocar la autorización.
- **Canal:** [completar: correo/teléfono de contacto para consultas y reclamos].
- **Modo diagnóstico (solo del dueño):** con un código secreto (DIAG_CODE, Secret Manager) el responsable puede activar el registro de las preguntas y respuestas de sus propias sesiones de prueba, para corregir fallas del asistente. Finalidad: depuración de calidad; base: el interés legítimo del responsable sobre sus propias pruebas (no se activa para el público ni sin el código). Los textos se redactan (correos, teléfonos, cédulas) y se truncan, van a un registro aparte (`diag`) que se **borra a las 24 horas** (retención de 1 día), y el código nunca se registra. Se configura con `scripts/gcp-diag-log.ps1`.

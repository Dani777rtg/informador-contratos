# Revisión del spec (spec-reviewer) — respuesta literal y estado

> Resultado del revisor: **needs changes** (2 bloqueantes, 6 mayores). Estado de cada hallazgo tras la corrección del spec.

1. blocker T002/T004/T006/T010 — tareas [P] del mismo grupo con archivos solapados y sustitutos (`server/mocks/`) creados demasiado tarde. — **fixed**: T002 lista archivos concretos sin `documents.ts`; `redact.ts` es de T010 y T004 depende de T010; `web/src/privacy.ts` queda en T006 (aviso de privacidad, AC-07.3); los sustitutos se crean en T001; grupos G0–G4 reordenados.
2. blocker US-04/US-01 — faltan cabeceras/CSP y escape de texto del LLM y de SECOP (XSS). — **fixed**: AC-08.6 (CSP con nonce, HSTS, nosniff, frame-ancestors, sin source maps, `textContent`), TM-14 y prueba de abuso con `<script>`.
3. major US-01/US-02 sin amenazas (inyección SoQL; enlaces `javascript:`/host ajeno). — **fixed**: AC-01.11 + TM-11; AC-02.5 + TM-12.
4. major AC-07.1 contradice el criterio 2 del cliente (NIT). — **fixed**: AC-07.2 depura solo documentos de personas naturales y conserva NIT; caso de prueba NIT 890399011.
5. major P0 sin criterio (RNF-02 texto, RNF-03, 7b, DIS-01, DIS-09, región) y AC-11.1 en historia Should. — **fixed**: US-11 pasa a Must con AC-11.1..11.4; AC-04.6 (Kit UI), AC-04.7 (micrófono), AC-09.5 (región); carga local queda en US-12 (Should).
6. major topes sin valores. — **fixed**: valores por defecto en el spec (20 pet/min, 500 car., 30 turnos, 60 s, 10 min, 3 herramientas, 1.000.000 tokens/día, 120 min voz/día, caducidad 2 h) como variables de entorno.
7. major AC-03.4 sin regla de decisión. — **fixed**: herramienta `decline(NO-xx)` y plantillas fijas; `npm run eval` contra DeepSeek real es condición de verificación.
8. major US-06 riesgo bajo y AC compuestas. — **fixed**: US-06 `risk: high` con TM-13 y caducidad numérica/versión de clave; ACs partidas en una respuesta cada una (con línea `Budget exceeded: AC`).

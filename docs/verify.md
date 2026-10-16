# Verificación — contratos (asistente SECOP)

## Veredicto

**NO SHIP** — `npm run lint` falla (1 error) y 3 criterios de us-04 (AC-04.2, AC-04.3 comportamiento, AC-04.5 en estados distintos al vacío) no tienen prueba E2E: siguen como `it.todo`. Todo lo demás está en verde; con esos dos puntos corregidos el veredicto pasaría a SHIP.

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
| TM (us-08 seguridad, us-07 privacidad) | mitigadas | evidence: `us-08.security.test.ts`, `us-07.privacy.test.ts` verdes; scan:secrets y audit limpios. Los TM-n individuales no se re-mapearon uno a uno. |

## Bugs

| # | Qué pasa | Severidad | Estado |
|---|---|---|---|
| 1 | `server/index.ts:55` parámetro `env` sin uso en `loadEntities`; rompe `npm run lint` | S3 (rompe una puerta de calidad) | abierto |
| 2 | Brecha de pruebas: AC-04.2, AC-04.3, AC-04.5 (otros estados) sin E2E | S3 (hueco de cobertura, no defecto de producto conocido) | abierto |
| 3 | El backend en :8080 responde 404 en `/` (no sirve `web/dist`); el spec E2E por defecto apunta a 8080 | S3 salvo que el despliegue previsto sea un solo proceso (confirmar con DEPLOY.md/AC-09) | abierto |

0 bugs S1/S2 abiertos.

## Riesgos residuales (a aceptar por el usuario)

- Punto de quiebre local de 500 usuarios simultáneos; con 1000 hay ~17 % de errores de conexión.
- Documentos reales limitados por la recarga externa de datos.gov.co.

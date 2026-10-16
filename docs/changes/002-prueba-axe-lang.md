# Cambio 002: la prueba de accesibilidad conserva `lang` al cargar la página

| Campo | Valor |
|---|---|
| Pedido por | Daniel (dueño del producto) |
| Fecha | 2026-10-16 |
| Estado | applied |

## Motivo

La prueba bloqueada AC-04.5 carga `web/index.html` con `document.documentElement.innerHTML = ...`, lo que descarta el atributo `lang="es"` de `<html>` y axe reporta `html-has-lang` aunque el archivo sí lo declara. Es un defecto de la prueba, no del producto.

## Delta

| Parte | Agrega | Modifica | Quita |
|---|---|---|---|
| Spec | — | — | — |
| Pruebas de aceptación | — | tests/acceptance/us-04.ui.test.ts: al cargar el HTML, copiar los atributos de `<html>` del archivo (al menos `lang`) al documento de prueba. El criterio (0 violaciones WCAG A/AA) no cambia. | — |
| Código ya construido | — | — | — |

## Impacto

- Tareas a rehacer: ninguna.
- Plazo: +5 min.
- Riesgos nuevos: ninguno.
- Archivos a abrir para edición: tests/acceptance/us-04.ui.test.ts.

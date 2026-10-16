# DESIGN.md — Guía de diseño GOV.CO para el agente de contratación pública (DIS-02)

> Prototipo — no es un servicio oficial del Estado.

Ingeniería inversa del estilo del Estado colombiano aplicada a una interfaz de chat y voz. Cada regla cita su fuente. Marcas: **[V]** verificado en el documento o CSS descargado el 2026-10-16; **[N/V]** no verificado (no se inventa el valor).

## 0. Fuentes consultadas

- **Kit UI GOV.CO v9.2** (agosto 2025), PDF `https://www.mintic.gov.co/portal/715/articles-406089_recurso_1.pdf`, texto extraído; se cita por sección: Cabecera (barra superior), Color, Tipografía, Pie de página, Botones, Alertas y notificaciones, Indicador de carga, Módulo inicio de sesión / Componentes de formulario, Paginación, Menú de navegación.
- **Portal https://www.gov.co**: CSS real `styles.554e65b9577c3cab.css`; carga Bootstrap 5.3.8 y web components desde `cdn.www.gov.co/webcomponents/`.
- **No verificadas directamente en esta sesión:** Anexo 5.1 de MinTIC, Resolución 1519 de 2020 (solo se cita como marco general de accesibilidad WCAG 2.1 AA, que el propio Kit referencia), y los CSS de colombiacompra.gov.co y datos.gov.co (no analizados; datos.gov.co usa Socrata). Ninguna regla depende de ellos.

## 1. Colores

| Token | Hex | Uso | Fuente |
|---|---|---|---|
| Cobalt (azul GOV.CO) | `#0943B5` [V] | Barra superior, acción primaria, enlaces | Fuente: Kit UI 9.2, sección Cabecera: "único color azul Cobalt #0943B5" |
| Gris texto | `#4C4C4C` [V] | Texto y barra inferior cuando el color de entidad no contrasta | Fuente: Kit UI 9.2, sección Menú de navegación (punto 4) |
| Rojo error | `#A80521` [V] | Mensajes de error de campo | Fuente: CSS de gov.co (`.input-validation-error`) |
| Azul oscuro portal | `#004884` [V] | Es el color más usado en el CSS actual de gov.co (39 usos), pero no es el Cobalt del Kit. No usarlo | Fuente: CSS de gov.co |
| Fondo claro | `#E6EFFD` [V] | Fondos suaves (tarjetas, burbuja del agente) | Fuente: CSS de gov.co (10 usos); el Kit solo lo nombra "Solitude" |
| Foco | `#3772FF` (selects del portal: `#5897FB`) [V en el portal] | Anillo de foco; se exige ≥4,5:1 | Fuente: CSS de gov.co; Kit UI 9.2, secciones Acordeón y Tarjetas |
| Blanco | `#FFFFFF` | Fondo base | Fuente: Kit UI 9.2, sección Color (Principales: Cobalt, Black, Matterhorn, Grey, White) |
| Éxito, advertencia, información | [N/V] | El Kit lista "Universales informativos: Red, Orange, Yellow, Green" solo como imagen, sin hex en el texto; los tokens van marcados `provisional` | Fuente: Kit UI 9.2, sección Color |
| Silver (deshabilitado), Havelock/Tropical Blue, Golden Brown, Sunglow, Corn Silk, White Smoke, Portage, Black, Matterhorn | [N/V] | Solo se conocen los nombres | Fuente: Kit UI 9.2, sección Color |

Contrastes calculados (WCAG): Cobalt sobre blanco 8,46:1; `#4C4C4C` sobre blanco 8,59:1; `#A80521` sobre blanco 7,75:1; Cobalt sobre `#E6EFFD` 7,31:1. Todos superan AA (4,5:1 texto normal, 3:1 texto grande y componentes). Fuente: Kit UI 9.2, sección Color (3:1 texto grande, 4,5:1 normal) y cálculo propio.

## 2. Tipografía

- Usar solo dos tipos: **Nunito Sans** (títulos y descripciones) y **Verdana** (párrafos, leyendas, pies de foto). Fuente: Kit UI 9.2, sección Tipografía. Verdana es la tipografía del cuerpo y de todo control; Nunito Sans solo en títulos, con Verdana como alternativa si no carga.
- El CSS actual de gov.co usa Work Sans/Montserrat; el Kit manda Nunito Sans + Verdana. Se sigue el Kit. Fuente: CSS de gov.co vs. Kit UI 9.2, sección Tipografía.

| Rol | Fuente | Escritorio | Móvil | Origen |
|---|---|---|---|---|
| h1 | Nunito Sans Bold | 42/50 px | 34/42 | Fuente: Kit UI 9.2, Tipografía |
| h2 | Nunito Sans Bold | 34/42 | 26/34 | ídem |
| h3 | Nunito Sans Bold | 26/34 | 22/32 | ídem |
| h4 | Nunito Sans Bold | 22/32 | 20/26 | ídem |
| h5 / h6 | Nunito Sans Bold | 20/26 · 16/22 | 18/24 · 16/22 | ídem |
| Description | Nunito Sans SemiBold | 20/24 | 18/22 | ídem |
| Body text 1 | Verdana Regular | 15/22 (o 14/22) | 14/20 | ídem |
| Body text 2 y Caption | Verdana Regular | 12/20 | 12/20 | ídem |

La extracción de texto del PDF deja filas desalineadas en body/description; esos valores [parcialmente verificado] deben confirmarse contra el PDF antes de congelarlos. Decisión del prototipo: cuerpo de chat 15 px, nunca menos de 14 px.

## 3. Espaciado, tamaño y rejilla

- Elementos gráficos de la barra superior en múltiplos de 8 px. Fuente: Kit UI 9.2, sección Cabecera.
- Objetivos táctiles ≥ **44 × 44 px**. Fuente: Kit UI 9.2, secciones Cabecera y Paginación.
- Escala del prototipo: 4, 8, 16, 24, 32, 48 px (decisión propia, no valor del Kit).
- Bootstrap 5.3.8 es la base de gov.co. Fuente: portal gov.co, `<link>` del HTML. No se agrega Bootstrap al prototipo; se replican solo los tokens.

## 4. Componentes

### 4.1 Encabezado (barra superior GOV.CO)
- Altura 56 px, un solo color Cobalt `#0943B5`, área activa mínima 44 × 44 px, navegable por teclado con foco visible. Fuente: Kit UI 9.2, sección Cabecera.
- El logo oficial de GOV.CO enlaza a https://www.gov.co/home/ y mide 24 × 136 px. **Este prototipo NO incluye el logo ni el sello**: la barra muestra solo texto (nombre del prototipo). Fuente: Kit UI 9.2, Cabecera (regla) y spec AC-04.6 (sin logos hasta la adopción).
- Botón de idioma (24 px, a la derecha, `aria-label` "Cambiar idioma"): no se implementa en v1. Fuente: Kit UI 9.2, Cabecera.

### 4.2 Pie de página
- Módulo de información de entidad y módulo de cierre; texto con contraste ≥4,5:1; enlaces descriptivos (Políticas, Términos y condiciones, Accesibilidad, Mapa del sitio). Fuente: Kit UI 9.2, sección Pie de página.
- El Kit exige logos de autoridad, GOV.CO y marca país: **no se incluyen**. En su lugar: aviso "Prototipo — no es un servicio oficial del Estado", aviso de asistente de inteligencia artificial y enlaces de privacidad y accesibilidad. Fuente: spec AC-04.1/AC-04.6; Kit UI 9.2, Pie de página.
- Fondo: el Kit usa el color de la entidad (ejemplo `#E8A046`, MinTIC) y exige contraste; el prototipo no es una entidad y usa `#4C4C4C` con texto blanco (8,59:1). Fuente: Kit UI 9.2, Pie de página y Menú de navegación.

### 4.3 Botones
- Variantes: contenido, contenido invertido, contorno, contorno invertido; estados default, hover, focus, disabled. Texto de máximo 3 palabras, etiqueta específica. Una sola acción primaria visualmente dominante. Elemento `<button type="button">`, nunca `<div>`. Fuente: Kit UI 9.2, sección Botones.
- Primario: fondo Cobalt, texto blanco, alto mínimo 44 px. Deshabilitado: el hex de "Silver" es [N/V]; el prototipo usa `#BABABA` (hex del CSS de gov.co, uso propio) con texto `#4C4C4C`.

### 4.4 Campo de texto
- Borde con contraste mínimo, etiqueta o `aria-label`, ayuda concreta, asterisco explicado si hay obligatorios, error textual que diga cómo solucionarlo, válido/inválido con color distinto. Fuente: Kit UI 9.2, secciones Módulo inicio de sesión y Componentes de formulario.
- Error de campo en `#A80521`, cursiva. Fuente: CSS de gov.co.
- El placeholder es conciso y no sustituye la etiqueta. Fuente: Kit UI 9.2, Módulo inicio de sesión.

### 4.5 Alertas
- Tipos: básica, confirmación, éxito, error, advertencia; mensaje corto y conciso. Fuente: Kit UI 9.2, sección Alertas y notificaciones.
- En el prototipo: `role="status"` (informativas) o `role="alert"` (error), una frase, y nunca solo color: además icono o prefijo textual. Fuente: Kit UI 9.2, Formularios (informar textualmente).

### 4.6 Tarjetas
- Operables por teclado, foco con contraste ≥4,5:1. Se usan para ejemplos de preguntas y resultados de contratos. Fuente: Kit UI 9.2, sección Tarjetas.

### 4.7 Enlaces
- Distinguibles del texto normal (subrayado o color consistente), texto descriptivo y único. Fuente: Kit UI 9.2, sección Pie de página, Accesibilidad.

## 5. Estados

| Estado | Regla | Fuente |
|---|---|---|
| Foco visible | Anillo de 3 px, contraste ≥4,5:1, en todo control | Fuente: Kit UI 9.2, secciones Acordeón y Tarjetas |
| Hover / Active / Disabled | Cada botón y campo define default, hover, focus, active, disabled | Fuente: Kit UI 9.2, Tipografía > Estados y Botones |
| Cargando | Spinner sobre fondo blanco; con modal, fondo negro al 20 %; contraste suficiente; si pasa de 10 s, explicar qué ocurre | Fuente: Kit UI 9.2, sección Indicador de carga |
| Error | Una frase que diga qué pasó y cómo seguir, anunciada a lectores de pantalla, `#A80521` más texto | Fuente: Kit UI 9.2, Formularios; spec AC-04.3 |
| Vacío | Inicio: saludo, campo, micrófono, 3–4 ejemplos y avisos, nada más. Sin resultados: una frase y una alternativa. El Kit no define "estado vacío" [N/V]; criterio propio | Fuente: spec AC-04.1 |

## 6. Chat y voz coherentes con el Kit

El Kit no trae componentes de chat ni de voz [V: ausentes]; se construyen con sus tokens y reglas de botón, alerta, spinner y foco. Las medidas son decisión propia.

- **Micrófono grande:** un único botón, círculo de 72 px (≥44), Cobalt con icono blanco, `aria-label` "Micrófono", `aria-pressed`. Fuente: Kit UI 9.2, Botones (simbólico) y regla de 44 px; spec AC-04.7.
- **Estados del micrófono**, siempre con texto además de color y animación: *Escuchando* (anillo pulsante), *Procesando* (spinner), *Hablando* (ondas; el botón pasa a "Interrumpir"), *En pausa* (contorno, "Reanudar"). Respetar `prefers-reduced-motion`. Fuente: Kit UI 9.2, Indicador de carga y Accesibilidad.
- **Indicador de nivel:** barra de 8 px con 5 segmentos; el gráfico es `aria-hidden` y el estado va en la región `aria-live`. Criterio propio.
- **Subtítulos:** todo lo hablado también se escribe, en región `aria-live="polite"`, Verdana 15/22, contraste ≥4,5:1, fondo `#E6EFFD`. Fuente: WCAG 2.1 vía Kit UI 9.2, sección Color (contraste); spec AC-04.7.
- **Silenciar / interrumpir:** botón aparte, visible durante "Hablando", ≥44 px, etiqueta específica. Fuente: spec AC-04.7; Kit UI 9.2, Botones (etiquetado correcto).
- **Burbujas:** usuario en Cobalt con texto blanco; agente en `#E6EFFD` con texto `#4C4C4C`. Respuesta en capas: resumen corto y detalle plegable. Fuente: spec AC-04.2; contrastes de la sección 1.
- **Aviso de IA** visible en la pantalla inicial y el pie. Fuente: spec AC-04.1.

## 7. Qué hacer

1. Usar Cobalt `#0943B5` como único azul de marca y `#4C4C4C` para texto y pie. Fuente: Kit UI 9.2, Cabecera y Menú de navegación.
2. Usar Verdana en cuerpo y controles; Nunito Sans solo en títulos. Fuente: Kit UI 9.2, Tipografía.
3. Garantizar contraste ≥4,5:1 en texto y foco, 3:1 en texto grande. Fuente: Kit UI 9.2, Color.
4. Objetivos táctiles de 44 × 44 px o más. Fuente: Kit UI 9.2, Cabecera y Paginación.
5. Elementos semánticos (`button`, `h1`–`h6`, `header`, `footer`) y todo operable por teclado. Fuente: Kit UI 9.2, Botones y Pie de página.
6. Mostrar siempre "Prototipo — no es un servicio oficial del Estado". Fuente: spec AC-04.1.
7. Informar si una espera supera 10 s. Fuente: Kit UI 9.2, Indicador de carga.

## 8. Qué NO hacer

1. No usar logo de GOV.CO, escudo, sello, marca país ni logos de entidades hasta la adopción formal; el prototipo no es una entidad. Fuente: Kit UI 9.2, Cabecera y Pie de página; spec AC-04.6.
2. No presentarlo como servicio oficial. Fuente: spec AC-04.1.
3. No inventar colores fuera de la paleta ni comunicar estado solo con color. Fuente: Kit UI 9.2, Color.
4. No usar más de dos tipos de letra ni texto menor a 12 px. Fuente: Kit UI 9.2, Tipografía.
5. No usar `div`/`span` como botón ni etiquetas genéricas ("Clic aquí"). Fuente: Kit UI 9.2, Botones.
6. No abrir acordeones ni reproducir voz sin acción del usuario. Fuente: Kit UI 9.2, Acordeón.
7. No usar el placeholder como etiqueta ni mostrar errores sin decir cómo corregirlos. Fuente: Kit UI 9.2, Módulo inicio de sesión.
8. No copiar del CSS de gov.co lo que contradice el Kit (Work Sans, Montserrat, `#004884`). Fuente: CSS de gov.co vs. Kit UI 9.2.

## 9. Tokens CSS (copiar a `web/styles/tokens.css`)

```css
:root {
  /* Color — Kit UI 9.2, sección Color / Cabecera */
  --govco-cobalt: #0943B5;          /* verificado */
  --govco-text: #4C4C4C;            /* verificado */
  --govco-white: #FFFFFF;
  --govco-bg-soft: #E6EFFD;         /* verificado en CSS gov.co */
  --govco-error: #A80521;           /* verificado en CSS gov.co */
  --govco-disabled: #BABABA;        /* verificado en CSS gov.co; solo fondo deshabilitado */
  --govco-focus: #3772FF;           /* verificado en CSS gov.co; comprobar >=4.5:1 por fondo */
  --govco-success: #1B7A3E;         /* provisional: no verificado en el Kit */
  --govco-warning-bg: #FFF4D6;      /* provisional: no verificado en el Kit */
  --govco-warning-text: #5C4300;    /* provisional: no verificado en el Kit */

  /* Tipografía — Kit UI 9.2, sección Tipografía */
  --govco-font-body: Verdana, Geneva, sans-serif;
  --govco-font-title: "Nunito Sans", Verdana, Geneva, sans-serif;
  --fs-h1: 34px; --lh-h1: 42px;    /* móvil; escritorio 42/50 */
  --fs-h2: 26px; --lh-h2: 34px;
  --fs-h3: 22px; --lh-h3: 32px;
  --fs-body: 15px; --lh-body: 22px;
  --fs-caption: 12px; --lh-caption: 20px;

  /* Espaciado y tamaños (múltiplos de 8; Kit UI 9.2, Cabecera) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 16px; --sp-4: 24px; --sp-5: 32px; --sp-6: 48px;
  --touch-min: 44px;                /* Kit UI 9.2, Cabecera y Paginación */
  --header-h: 56px;                 /* Kit UI 9.2, Cabecera */
  --mic-size: 72px;                 /* criterio propio */
  --radius: 8px;                    /* criterio propio */
  --focus-ring: 3px solid var(--govco-focus);
  --overlay: rgba(0, 0, 0, 0.2);    /* Kit UI 9.2, Indicador de carga (20 %) */
}

@media (min-width: 768px) {
  :root { --fs-h1: 42px; --lh-h1: 50px; --fs-h2: 34px; --lh-h2: 42px; --fs-h3: 26px; --lh-h3: 34px; }
}

body { font-family: var(--govco-font-body); font-size: var(--fs-body); line-height: var(--lh-body); color: var(--govco-text); background: var(--govco-white); }
h1, h2, h3 { font-family: var(--govco-font-title); font-weight: 700; }
button, [role="button"], input, textarea { font-family: var(--govco-font-body); min-height: var(--touch-min); min-width: var(--touch-min); }
:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
```

## 10. Pendientes de verificación

Hex de Black, Matterhorn, Havelock/Tropical Blue, Golden Brown, Sunglow, Silver, Corn Silk, White Smoke, Portage y de los universales (verde, amarillo, naranja); valores de body/description en la tabla tipográfica; texto de la Resolución 1519 de 2020 y del Anexo 5.1; CSS de colombiacompra.gov.co y datos.gov.co; carga real de Nunito Sans (hospedar localmente, sin CDN externo).

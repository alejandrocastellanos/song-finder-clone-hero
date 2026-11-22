# CH Buscador

Busca canciones para Clone Hero en Chorus Encore y genera las dificultades que falten (Fácil, Medio, Difícil).

- Cuando la persona pida canciones, un artista o un género, usa el skill `canciones-clone-hero` (`.claude/skills/canciones-clone-hero/SKILL.md`) y sigue sus pasos.
- Habla en español y con lenguaje sencillo: quien usa esto quiere jugar, no programar.
- Nunca descargues ni modifiques canciones sin que la persona lo confirme.

## Versiones (obligatorio en cada cambio)

La versión sigue Semantic Versioning (MAYOR.MENOR.PARCHE) y está en tres lugares que deben coincidir:
- `index.html`: la etiqueta junto al nombre (`<button class="ver" id="appVersion">vX.Y.Z</button>`).
- `sw.js`: `const CACHE = 'chb-vX.Y.Z'` (así cada versión renueva la caché de la app).
- `index.html`, sección ✨ Mejoras: una entrada con la fecha y `<small>vX.Y.Z</small>`, lo más nuevo primero, en frases cortas para jugadores.

Cuál subir: **PARCHE** para correcciones sin funciones nuevas; **MENOR** para funciones o cambios visibles que no rompen nada; **MAYOR** si cambia algo que la gente ya usaba de forma incompatible (formato de archivos, quitar una función importante). Historial: 1.0.0 (30 oct 2026, lanzamiento), 1.1.0 (4 nov), 1.2.0 (6 nov), 1.3.0 y 1.3.1 (21 nov), 1.4.0 (21 nov, diseño), 1.5.0 (21 nov, ajustes de descarga en barra plegada).

## Estructura

- `core/chb-core.js`: motor compartido (búsqueda en Encore, lectura/escritura de `.sng`, generación de dificultades para `.chart` y `.mid`). Si una canción trae los dos, usa el que lee Clone Hero: `notes.mid` (función `chartOf`, mismo orden que scan-chart). Funciona en navegador y en Node 18+ sin dependencias.
- `cli/chb.js`: línea de comandos que usa el agente (`buscar`, `descargar`, `arreglar`, `carpetas`).
- `cli/prueba-calidad.js`: compara los niveles que crea el motor con los Difícil/Medio/Fácil oficiales de 30 canciones de Rock Band. **Córrelo (`node cli/prueba-calidad.js`) antes de publicar cualquier cambio en la generación de niveles**; termina con error si la calidad baja del mínimo medido.
- `index.html` + `app.js`: la app web.
- `preview.js`: vista previa jugable (autopista de notas en canvas + audio con Web Audio) y perillas de los niveles creados.
- `fx.js`: avisos, chispas y sonidos sintetizados.
- `packs.js`: listas de canciones armadas a mano (id del chart en Chorus Encore).
- `autochart.js`: experimental, crea un chart Expert desde un audio (flujo espectral para los golpes, seguimiento de pulso por programación dinámica, tono por HPS para los botones). También crea batería desde el audio. Solo navegador.
- `analytics.js`: Google Analytics 4; no hace nada hasta poner `GA_ID` y solo carga si la persona acepta.
- `community.js` + `supabase/schema.sql`: contador, lo más descargado y valoraciones en Supabase; solo escribe desde la página publicada.
- `manifest.webmanifest`, `sw.js`, `icons/`: para instalarla como app (PWA).

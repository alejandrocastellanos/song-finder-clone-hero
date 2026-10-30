# CH Buscador

Busca canciones para Clone Hero en Chorus Encore y genera las dificultades que falten (Fácil, Medio, Difícil).

- Cuando la persona pida canciones, un artista o un género, usa el skill `canciones-clone-hero` (`.claude/skills/canciones-clone-hero/SKILL.md`) y sigue sus pasos.
- Habla en español y con lenguaje sencillo: quien usa esto quiere jugar, no programar.
- Nunca descargues ni modifiques canciones sin que la persona lo confirme.

## Estructura

- `core/chb-core.js`: motor compartido (búsqueda en Encore, lectura/escritura de `.sng`, generación de dificultades para `.chart` y `.mid`). Funciona en navegador y en Node 18+ sin dependencias.
- `cli/chb.js`: línea de comandos que usa el agente (`buscar`, `descargar`, `arreglar`, `carpetas`).
- `index.html` + `app.js`: la app web.
- `preview.js`: vista previa jugable (autopista de notas en canvas + audio con Web Audio) y perillas de los niveles creados.
- `fx.js`: avisos, chispas y sonidos sintetizados.
- `packs.js`: listas de canciones armadas a mano (id del chart en Chorus Encore).
- `autochart.js`: experimental, crea un chart Expert desde un audio (flujo espectral para los golpes, seguimiento de pulso por programación dinámica, tono por HPS para los botones). Solo navegador.
- `manifest.webmanifest`, `sw.js`, `icons/`: para instalarla como app (PWA).

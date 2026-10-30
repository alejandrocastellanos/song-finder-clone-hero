---
name: canciones-clone-hero
description: Busca y descarga canciones para Clone Hero desde Chorus Encore y, si no traen las dificultades que la persona necesita (Fácil, Medio, Difícil), se las genera. Úsalo cuando alguien pida canciones, un artista, un género o música para Clone Hero, o quiera arreglar las dificultades de su biblioteca.
---

# Canciones para Clone Hero

Guía a la persona paso a paso, en español y con lenguaje sencillo. Todo se hace con `node cli/chb.js` desde la raíz de este repo.

## 0. Antes de empezar

Corre `node --version`. Si Node no está instalado o es menor que 18, dile que tiene dos opciones:
- abrir `index.html` en Chrome o Edge (hace lo mismo con botones, sin instalar nada), o
- instalar Node.js LTS desde https://nodejs.org y volver a pedírtelo.

No instales nada por tu cuenta.

## 1. Preguntar qué quiere

Pregunta con opciones (AskUserQuestion), una cosa a la vez o juntas si la herramienta lo permite:

1. **Qué buscar**: por artista, por género o por nombre de canción. Luego pide el texto (ej. "Soda Stereo", "Cumbia", "Free Bird"). Si ya lo dijo en su mensaje, no lo vuelvas a preguntar.
2. **Niveles que necesita**: Fácil, Medio, Difícil (selección múltiple, por defecto los tres). Explica que si la canción no los trae, se generan automáticamente a partir del Expert.
3. **Cuántos resultados**: 10, 20 o 50.

## 2. Buscar

```
node cli/chb.js buscar --artista "TEXTO" --niveles facil,medio,dificil --cantidad 20 --json
```

Usa `--genero` o `--texto` en lugar de `--artista` según lo que eligió. Agrega `--solo-originales` solo si pide canciones que ya traigan las dificultades hechas por su autor.

Muestra el resultado como una lista numerada corta: `N. Artista – Canción (duración) · instrumentos · ✅ originales / ⚙️ se generan`. No muestres el md5.

Si no hay resultados, sugiere buscar por canción en vez de artista, otra forma de escribir el nombre (con o sin "Los", con o sin acentos) o quitar `--solo-originales`.

## 3. Confirmar la descarga

Pregunta si quiere descargar: **todas**, **algunas** (que diga los números, acepta rangos como `1-5,8`) o **ninguna**. No descargues nada sin su respuesta.

## 4. Elegir carpeta

Corre `node cli/chb.js carpetas` para ver dónde suele estar su carpeta Songs y ofrece esa ruta como primera opción. Deja que escriba otra si prefiere. Si la carpeta está dentro de OneDrive y va a bajar muchas canciones, avísale que ocupan espacio en la nube.

## 5. Descargar

```
node cli/chb.js descargar --numeros 1,2,5-8 --carpeta "RUTA"
```

(o `--todas`). Cada canción tarda unos segundos; si son muchas, córrelo en segundo plano.

Al terminar, dile cuántas se guardaron, cuáles tenían dificultades originales y a cuáles se les generaron, y cualquier error. Recuérdale: en Clone Hero ir a **Settings → General → Scan Songs** (y agregar la carpeta en **Song Folders** si es nueva).

## Si los niveles creados no le gustan

Si dice que tienen demasiadas notas, muy pocas, que los acordes le cuestan o que extraña el naranja en Medio, vuelve a descargar esas canciones con ajustes (solo cambian los niveles creados, nunca los originales):

- `--densidad -1` o `-2` para menos notas, `1` o `2` para más.
- `--sin-acordes` para notas sueltas en Medio y Difícil.
- `--naranja-medio` para permitir el naranja en Medio.

Si quiere corregir nota por nota, descárgala con `--editable`: queda una carpeta con `song.ini`, el chart y el audio que se abre en **Moonscraper Chart Editor** (gratis) y que Clone Hero también lee.

## Arreglar una biblioteca existente

Si la persona ya tiene canciones que solo traen Expert:

```
node cli/chb.js arreglar --carpeta "RUTA" --niveles facil,medio,dificil
```

Guarda una copia de cada canción modificada como `*.sng.original`. Pide confirmación antes de correrlo y di cuántas canciones hay en la carpeta.

## Qué saber

- Las canciones vienen de Chorus Encore (enchor.us), el buscador de la comunidad. Son charts hechos por fans o extraídos de los juegos.
- Las dificultades generadas son automáticas: se pueden jugar, pero no son tan pulidas como las hechas a mano. Dilo cuando corresponda.
- Funciona con charts `.chart` y `.mid`, para guitarra, bajo, rítmica, teclado y batería.

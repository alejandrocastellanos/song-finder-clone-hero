'use strict';
/* Spanish / English. The page and the app are written in Spanish; in English this layer swaps each text
   (and the title, placeholder and aria-label attributes) for its English version, also on everything the
   app draws later, by watching the page. Song names, artists and lyrics are never touched. */
window.I18N = (() => {
  const KEY = 'chb-lang';
  let lang = null;
  try { lang = localStorage.getItem(KEY); } catch { }
  if (lang !== 'es' && lang !== 'en') lang = /^es\b/i.test(navigator.language || 'es') ? 'es' : 'en';

  /* ---------- whole texts ---------- */
  const EN = {
    // header, tabs
    '🔇 Sonido': '🔇 Sound', '🔊 Sonido': '🔊 Sound',
    'Sonidos de guitarra al buscar y al terminar descargas': 'Guitar sounds when searching and when downloads finish',
    'Ver qué trae esta versión': 'See what is new in this version',
    'Busca cualquier canción para Clone Hero ·': 'Find any song for Clone Hero ·',
    'si no trae tu nivel, te lo creamos': 'missing your level? we make it',
    'Buscar': 'Search', '🔥 Lo más descargado': '🔥 Most downloaded', 'Mi biblioteca': 'My library',
    '🧪 Crear desde audio': '🧪 Create from audio', '✨ Mejoras': "✨ What's new",
    'canción descargada': 'song downloaded', 'canciones descargadas': 'songs downloaded',

    // download settings
    '⚙️ Ajustes de descarga': '⚙️ Download settings',
    'Carpeta de destino:': 'Destination folder:', 'ninguna': 'none',
    '(te la pediré cuando descargues)': "(I'll ask for it when you download)",
    'Elegir carpeta Songs': 'Choose Songs folder',
    'Guardado:': 'Saving:',
    'una canción baja a Descargas y varias bajan en archivos .zip; luego las pasas a tu carpeta Songs.': 'one song goes to Downloads and several go in .zip files; then you move them to your Songs folder.',
    'En Brave puedes guardar directo en Songs: abre': 'In Brave you can save straight to Songs: open',
    ', actívalo y reinicia el navegador.': ', turn it on and restart the browser.',
    'Para guardarlas directo en Songs usa Chrome, Edge u Opera en computadora.': 'To save them straight to Songs, use Chrome, Edge or Opera on a computer.',
    'El navegador no deja usar esa carpeta.': "The browser won't let you use that folder.",
    'Chrome y Edge bloquean carpetas del sistema, como las que están dentro de': 'Chrome and Edge block system folders, like the ones inside',
    'Archivos de programa': 'Program Files',
    '. Crea una carpeta nueva, por ejemplo': '. Create a new folder, for example',
    'Documentos\\Clone Hero\\Songs': 'Documents\\Clone Hero\\Songs',
    ', elígela aquí y agrégala en Clone Hero en': ', choose it here and add it in Clone Hero under',
    '. Si tu Clone Hero es anterior a la versión 1.1, activa': '. If your Clone Hero is older than 1.1, turn on',
    'Guardar como carpeta': 'Save as folder',
    ': esas versiones no leen archivos .sng.': ": those versions can't read .sng files.",
    'Niveles que necesito:': 'Levels I need:',
    'Fácil': 'Easy', 'Medio': 'Medium', 'Difícil': 'Hard', 'Experto': 'Expert',
    'También bajo, batería y teclado': 'Also bass, drums and keys',
    'song.ini + chart + audio en una carpeta por canción. Para Clone Hero anterior a la 1.1 (no lee .sng) y para editarla en Moonscraper': 'song.ini + chart + audio in one folder per song. For Clone Hero older than 1.1 (no .sng) and for editing in Moonscraper',
    '📁 Guardar como carpeta': '📁 Save as folder',
    'Si le falta:': 'If it is missing:',
    '🎤 Agregar la letra': '🎤 Add lyrics', '🥁 Crear la batería': '🥁 Create drums',
    'Tarda unos segundos más por canción': 'Takes a few more seconds per song',
    '¿Cómo creo la batería?': 'How do I create drums?',
    'Marca': 'Check', 'Crear la batería': 'Create drums',
    'y se crea sola al descargar las canciones que no la traen (en': "and it's created when you download songs that don't have it (in",
    '▶ Ver': '▶ Play',
    'la pruebas antes). Para tu biblioteca, márcala y usa': 'you can try it first). For your library, check it and use',
    'Mi biblioteca → Revisar y arreglar': 'My library → Check and fix',
    '. Para una canción que nadie ha charteado, usa': '. For a song nobody has charted, use',
    '📁 carpeta: se pide al descargar': '📁 folder: asked when downloading',
    '📁 se guarda en Descargas': '📁 saved to Downloads',
    'ningún nivel': 'no levels', 'todos los instrumentos': 'all instruments',
    'letra': 'lyrics', 'batería': 'drums',
    '🎛 Niveles creados:': '🎛 Created levels:',
    'muchas menos': 'far fewer', 'menos': 'fewer', 'normal': 'normal', 'más': 'more', 'muchas más': 'many more',
    'notas': 'notes', 'acordes': 'chords', 'naranja en Medio': 'orange on Medium', 'sí': 'yes',
    'Restablecer': 'Reset', '(ajústalos desde ▶ Ver)': '(adjust them from ▶ Play)',

    // search
    'Buscar por': 'Search by', 'Canción o artista': 'Song or artist', 'Solo artista': 'Artist only', 'Género': 'Genre',
    'ej. Soda Stereo, Free Bird, Cumbia…': 'e.g. Metallica, Free Bird, Cumbia…',
    'Cuántos resultados': 'How many results', '10 resultados': '10 results', '20 resultados': '20 results', '50 resultados': '50 results',
    'Filtro': 'Filter', 'Originales y generables': 'Original and generated', 'Solo con niveles originales': 'Original levels only',
    'viene en el chart original': 'comes in the original chart', 'se crea al descargar': 'created when downloading',
    'no se crea': 'not created', 'intensidad': 'intensity',
    '🔗 Compartir búsqueda': '🔗 Share search', 'Cargar más': 'Load more', 'Descargar seleccionadas': 'Download selected',
    'Recientes:': 'Recent:', 'Populares:': 'Popular:',
    'No encontré canciones que cumplan con lo que pides.': "I couldn't find songs that match what you asked for.",
    'Buscando…': 'Searching…', 'Cargando…': 'Loading…',
    'Vista previa': 'Preview', 'elegir': 'select', 'Descargar': 'Download', 'Descargando…': 'Downloading…',
    'Revisando qué trae…': 'Checking what it has…',
    '🎤 Con letra': '🎤 Lyrics', 'Trae la letra': 'Has lyrics', '🎤 Sin letra: se buscará': '🎤 No lyrics: will search',
    '🎤 Sin letra': '🎤 No lyrics', 'Al descargar se busca la letra': 'Lyrics are searched when downloading', 'No trae letra': 'No lyrics',
    '🖼 Tu imagen': '🖼 Your image', 'Se guarda con tu imagen': 'Saved with your image',
    '🖼 Con fondo': '🖼 Background', 'Trae imagen de fondo': 'Has a background image', '🖼 Sin fondo': '🖼 No background', 'No trae imagen de fondo': 'No background image',
    '🎬 Con video': '🎬 Video', 'Trae video de fondo': 'Has a background video', '🎬 Sin video': '🎬 No video', 'No trae video de fondo': 'No background video',
    '💿 Con portada': '💿 Album art', 'Trae portada del álbum': 'Has album art', '💿 Sin portada': '💿 No album art', 'No trae portada del álbum': 'No album art',
    '🥁 Con batería': '🥁 Drums', 'Trae batería': 'Has drums', '🥁 Sin batería: se creará': '🥁 No drums: will be created',
    '🥁 Sin batería': '🥁 No drums', 'Al descargar se crea desde el audio': 'Created from the audio when downloading', 'No trae batería': 'No drums',
    'Agregar imagen': 'Add image', 'Cambiar imagen': 'Change image',
    'Cambiar la imagen de esta canción': "Change this song's image", 'Quitar la imagen': 'Remove the image',
    'Esta canción ya trae fondo; la tuya lo reemplaza': 'This song already has a background; yours replaces it',
    'Ponerle una imagen o video de fondo a esta canción': 'Give this song a background image or video',
    'Guitarra': 'Guitar', 'Bajo': 'Bass', 'Rítmica': 'Rhythm', 'Teclado': 'Keys', 'Batería': 'Drums',

    // downloading
    'Buscando la letra…': 'Searching for lyrics…', 'Creando la batería…': 'Creating drums…',
    'letra agregada': 'lyrics added', 'no encontré la letra con tiempos': "couldn't find timed lyrics",
    'batería creada desde el audio': 'drums created from the audio', 'batería creada desde su pista': 'drums created from its track',
    'no se pudo crear la batería': "couldn't create the drums",
    'ya traía los niveles': 'already had the levels', '🎤 con letra': '🎤 with lyrics', '🎤 sin letra': '🎤 no lyrics',
    'Lista, esperando para empaquetar…': 'Ready, waiting to be zipped…',
    'no se pudo completar la guitarra': "couldn't complete the guitar",
    'lista: pulsa Guardar': 'ready: press Save', 'enviada a tu carpeta de Descargas': 'sent to your Downloads folder',
    'lista: pulsa Guardar y descomprímela en Songs': 'ready: press Save and unzip it into Songs',
    'enviada a Descargas en .zip: descomprímela en tu carpeta Songs': 'sent to Downloads as .zip: unzip it into your Songs folder',
    '💾 Guardar': '💾 Save', '✔ Guardado': '✔ Saved',
    'está lista': 'is ready', 'está listo': 'is ready',
    'Descargando': 'Downloading', 'Listo:': 'Done:',
    'Descomprime los .zip dentro de tu carpeta Songs. Si el navegador pregunta, permite descargar varios archivos.': 'Unzip the .zip files into your Songs folder. If the browser asks, allow downloading several files.',
    'Luego en Clone Hero: Settings → General → Scan Songs': 'Then in Clone Hero: Settings → General → Scan Songs',
    'En Clone Hero: Settings → General → Scan Songs': 'In Clone Hero: Settings → General → Scan Songs',
    'No se pudo descargar la canción.': "Couldn't download the song.",
    'Descarga cancelada: no elegiste una carpeta.': "Download cancelled: you didn't choose a folder.",
    'Formato no válido. Usa JPG, PNG, MP4, WEBM, AVI, OGV o MPEG.': 'Invalid format. Use JPG, PNG, MP4, WEBM, AVI, OGV or MPEG.',
    'Formato de fondo no válido. Usa JPG, PNG, MP4, WEBM, AVI, OGV o MPEG.': 'Invalid background format. Use JPG, PNG, MP4, WEBM, AVI, OGV or MPEG.',
    'Ese video pesa mucho: se copia dentro de la canción.': 'That video is big: it gets copied inside the song.',
    'Preparando carpeta para Moonscraper…': 'Preparing folder for Moonscraper…',
    '✏️ Lista para editar': '✏️ Ready to edit', 'Descomprime': 'Unzip', 'y abre': 'and open',
    '(o notes.mid) en Moonscraper. Si la pones en tu carpeta Songs, Clone Hero también la lee.': '(or notes.mid) in Moonscraper. If you put it in your Songs folder, Clone Hero reads it too.',
    'El buscador de Chorus Encore está ocupado, intenta de nuevo en un momento.': 'The Chorus Encore search is busy, try again in a moment.',
    'No se pudo descargar la canción': "Couldn't download the song", 'No se pudo leer la canción': "Couldn't read the song",
    'Falta qué buscar': 'Nothing to search for', 'MIDI inválido': 'Invalid MIDI',
    'Para compartir enlaces, publica la web (por ejemplo en GitHub Pages).': 'To share links, publish the site (for example on GitHub Pages).',
    '🔗 Enlace copiado. ¡Pásaselo a quien quieras!': '🔗 Link copied. Send it to anyone!',
    'Copia este enlace:': 'Copy this link:',
    'muy fácil': 'very easy', 'fácil': 'easy', 'media': 'medium', 'difícil': 'hard', 'muy difícil': 'very hard', 'brutal': 'brutal',

    // most downloaded, packs
    'Esta semana': 'This week', 'Histórico': 'All time',
    'Todavía no hay descargas esta semana. ¡Sé la primera persona!': 'No downloads this week yet. Be the first!',
    'Todavía no hay datos del histórico.': 'No all-time data yet.',
    'descarga': 'download', 'descargas': 'downloads',
    'Listas especiales': 'Special lists', 'Por género': 'By genre', 'Por artista': 'By artist',
    '← Todos los packs': '← All packs', '🔗 Compartir': '🔗 Share', 'Descargar pack': 'Download pack',
    'Rock en Español': 'Rock in Spanish', 'Rock Español Clásico': 'Classic Spanish Rock', 'Rock Latino': 'Latin Rock',
    'Clásicos de Guitar Hero y Rock Band': 'Guitar Hero and Rock Band Classics', 'Imprescindibles': 'Essentials',
    'Rancheras y Regional': 'Rancheras and Regional Mexican', 'Rock Clásico': 'Classic Rock', 'Hard Rock de los 80': '80s Hard Rock',
    'Punk y Pop Punk': 'Punk and Pop Punk', 'Grunge y Alternativo': 'Grunge and Alternative', 'Nu Metal y 2000s': 'Nu Metal and 2000s',
    'Pop y Urbano Latino': 'Latin Pop and Urban',
    'Las 100 más icónicas, versiones originales de los juegos': 'The 100 most iconic, original versions from the games',
    'Las que toda la comunidad toca: Bring Me to Life, Chop Suey!, Mr. Brightside…': 'The ones the whole community plays: Bring Me to Life, Chop Suey!, Mr. Brightside…',
    'Vicente Fernández, Tigres del Norte, Selena, Peso Pluma, cumbia': 'Vicente Fernández, Tigres del Norte, Selena, Peso Pluma, cumbia',
    'Metallica, Iron Maiden, Slayer, Pantera, Megadeth y más': 'Metallica, Iron Maiden, Slayer, Pantera, Megadeth and more',

    // library
    'Revisa las canciones de tu carpeta (y subcarpetas): archivos': 'Checks the songs in your folder (and subfolders): files',
    'y también canciones': 'and also songs', 'en carpeta': 'in folders',
    '(song.ini + notes.chart o notes.mid, las que se editan en Moonscraper).': '(song.ini + notes.chart or notes.mid, the ones edited in Moonscraper).',
    'Ver estadísticas': 'See statistics', 'solo mira, no cambia nada.': 'only looks, changes nothing.',
    'Revisar y arreglar': 'Check and fix',
    'les crea los niveles que falten (y la letra o la batería si las marcaste arriba) y guarda una copia': 'creates the missing levels (and lyrics or drums if you checked them above) and keeps a copy',
    'de cada archivo que modifica.': 'of each file it changes.',
    '📊 Ver estadísticas': '📊 See statistics',
    'Sin permiso para la carpeta.': 'No permission for the folder.',
    'No encontré canciones: ni archivos .sng ni carpetas con song.ini y notes.chart / notes.mid.': "I couldn't find songs: no .sng files and no folders with song.ini and notes.chart / notes.mid.",
    'Revisando tu biblioteca…': 'Checking your library…',
    'No encontré canciones en esa carpeta: ni archivos .sng ni carpetas con song.ini y notes.chart / notes.mid.': "I couldn't find songs in that folder: no .sng files and no folders with song.ini and notes.chart / notes.mid.",
    'canciones': 'songs', 'se pueden arreglar': 'can be fixed', '🎤 tienen letra': '🎤 have lyrics', '🥁 tienen batería': '🥁 have drums',
    'en disco': 'on disk', 'Artistas con más canciones': 'Artists with the most songs', 'Géneros': 'Genres', 'Sin género': 'No genre',
    'Usa': 'Use', 'para crearles los niveles que faltan.': 'to create their missing levels.',
    '🤘 Todas tus canciones tienen los niveles que pediste.': '🤘 All your songs have the levels you asked for.',

    // create from audio
    'Crear chart desde audio': 'Create a chart from audio', 'Experimental': 'Experimental',
    'Para canciones que nadie ha chartiado. La app escucha la canción, detecta el pulso y cuándo suena cada nota, y arma un chart jugable con': 'For songs nobody has charted. The app listens to the song, finds the beat and when each note plays, and builds a playable chart with',
    'Fácil, Medio, Difícil y Experto': 'Easy, Medium, Hard and Expert',
    '. Cuando un riff se repite, se toca con los mismos botones cada vez, como en los charts hechos a mano. Escucha': '. When a riff repeats, it is played with the same buttons every time, like hand-made charts. It listens to',
    'toda la canción': 'the whole song',
    '(no solo la guitarra), así que no va a quedar igual a uno hecho por un charter. Todo se hace en tu PC: el audio no se sube a ningún lado.': "(not just the guitar), so it won't match one made by a charter. Everything happens on your PC: the audio is not uploaded anywhere.",
    '¿Prefieres poner las notas tú?': 'Rather place the notes yourself?',
    '🎼 Solo mapa de tempo': '🎼 Tempo map only',
    'te da la carpeta con el audio y el pulso ya marcado, lista para abrir en': 'gives you the folder with the audio and the beat already marked, ready to open in',
    'Arrastra aquí tu canción o haz clic para elegirla': 'Drag your song here or click to choose it',
    'MP3, OGG, OPUS, WAV, M4A o FLAC': 'MP3, OGG, OPUS, WAV, M4A or FLAC',
    'Artista': 'Artist', 'Nombre de la canción': 'Song name',
    'Cuántas notas detectar': 'How many notes to detect',
    'Pocas notas': 'Few notes', 'Menos notas': 'Fewer notes', 'Notas normales': 'Normal notes', 'Muchas notas': 'Many notes', 'Más notas': 'More notes',
    '🥁 Crear batería': '🥁 Create drums', '🎤 Buscar la letra': '🎤 Search lyrics', 'Elegir imagen o video': 'Choose image or video',
    '¿No encuentra la letra? Pégala con sus tiempos': "Can't find the lyrics? Paste them with their times",
    'Formato LRC: cada línea con su tiempo, por ejemplo': 'LRC format: each line with its time, for example',
    '[00:21.50] Aquí va la línea': '[00:21.50] The line goes here',
    '. Hay editores gratis de LRC en internet para marcar los tiempos mientras suena la canción. Si pegas algo aquí, se usa esto en vez de buscar.': '. There are free LRC editors online to mark the times while the song plays. If you paste something here, it is used instead of searching.',
    '[00:21.50] Primera línea': '[00:21.50] First line', '[00:25.10] Segunda línea': '[00:25.10] Second line',
    'Crear chart': 'Create chart',
    'Una carpeta con el audio y un chart vacío con el pulso ya marcado, para poner tú las notas en Moonscraper': 'A folder with the audio and an empty chart with the beat already marked, so you place the notes in Moonscraper',
    '🎼 Solo mapa de tempo (Moonscraper)': '🎼 Tempo map only (Moonscraper)',
    'Míralo en la vista previa: puedes cambiar de nivel y usar las perillas. Si no te convence, prueba otra opción de "notas" y vuelve a crearlo, o edítalo en Moonscraper.': "Look at it in the preview: you can switch levels and use the knobs. If you don't like it, try another \"notes\" option and create it again, or edit it in Moonscraper.",
    '▶ Ver y ajustar': '▶ Play and adjust', '✏️ Editar en Moonscraper': '✏️ Edit in Moonscraper',
    'Leyendo el audio…': 'Reading the audio…', 'El audio es demasiado corto.': 'The audio is too short.',
    'Buscando cada golpe de la canción…': 'Finding every hit in the song…', 'Escuchando las notas…': 'Listening to the notes…',
    'Siguiendo el pulso…': 'Following the beat…', 'Buscando los riffs que se repiten…': 'Finding the riffs that repeat…',
    'Repartiendo notas en los botones…': 'Placing notes on the buttons…', 'Preparando el audio para Clone Hero…': 'Preparing the audio for Clone Hero…',
    'Sacando la batería…': 'Getting the drums out…', '¡Listo!': 'Done!',
    'No se pudo leer el audio de esta canción.': "Couldn't read this song's audio.", 'No se pudo crear la batería.': "Couldn't create the drums.",
    'No se pudo leer ese audio. Prueba con un MP3 u OGG.': "Couldn't read that audio. Try an MP3 or OGG.",
    'Tu navegador no pudo convertir el audio a Opus, así que quedó en WAV (pesa más y algunas versiones de Clone Hero podrían no reproducirlo). Para evitarlo, usa Chrome o Edge, o sube un MP3 u OGG.': "Your browser couldn't convert the audio to Opus, so it stayed as WAV (bigger, and some Clone Hero versions may not play it). To avoid this, use Chrome or Edge, or upload an MP3 or OGG.",
    'BPM detectados': 'BPM detected', 'notas en Experto': 'notes on Expert', 'notas por segundo': 'notes per second', 'en crearlo': 'to create it',
    '✔ la que pegaste': '✔ the one you pasted', '✔ agregada': '✔ added', '✖ no encontrada': '✖ not found', '✖ sin letra': '✖ no lyrics',
    '🎤 letra': '🎤 lyrics', '✖ sin imagen': '✖ no image', '🖼 imagen de fondo': '🖼 background image',
    '🎼 Mapa de tempo listo': '🎼 Tempo map ready',
    'en Moonscraper: el pulso ya está marcado, solo falta poner las notas. Revisa el inicio y los cambios de ritmo, que es donde más se equivoca.': 'in Moonscraper: the beat is already marked, you only need to place the notes. Check the start and the tempo changes, that is where it is wrong most often.',

    // preview
    'Cerrar': 'Close', 'Volumen': 'Volume',
    'Solo cambian los niveles creados por la app; los originales del chart no se tocan': "Only the levels created by the app change; the chart's original ones are untouched",
    '🎛 Ajustar niveles creados': '🎛 Adjust created levels', 'Acordes': 'Chords', 'Naranja en Medio': 'Orange on Medium',
    '⭐ ¿Qué tal quedó este nivel?': '⭐ How good is this level?', 'Valorar este nivel': 'Rate this level',
    '🎤 Agregar letra': '🎤 Add lyrics', '🖼 Fondo': '🖼 Background',
    'Baja la canción como carpeta .zip para corregirla nota por nota en Moonscraper': 'Downloads the song as a .zip folder to fix it note by note in Moonscraper',
    'Creado automáticamente': 'Created automatically', 'Original del chart': "The chart's original", 'No disponible': 'Not available', 'creado': 'created',
    'Sé la primera persona en valorarlo': 'Be the first to rate it', 'No se pudo guardar tu voto, intenta de nuevo.': "Couldn't save your vote, try again.",
    'No encontré la letra con tiempos para esta versión de la canción.': "I couldn't find timed lyrics for this version of the song.",
    'No se pudo crear la batería de esta canción.': "Couldn't create drums for this song.",
    'Recreando niveles…': 'Recreating levels…', 'Descargando canción…': 'Downloading song…', 'Preparando notas…': 'Preparing notes…',
    'Esta canción no trae notas que pueda mostrar.': 'This song has no notes I can show.', 'Preparando audio…': 'Preparing audio…',
    'No se pudo reproducir el audio en este navegador; las notas sí se muestran.': "The audio can't play in this browser; the notes still show.",
    'Poniendo el fondo…': 'Setting the background…',

    // what's new
    'Todo lo que ha cambiado desde que se lanzó CH Buscador, lo más nuevo primero. Muchas de estas mejoras salieron de comentarios de la comunidad: ¡gracias!': 'Everything that has changed since CH Buscador launched, newest first. Many of these came from community comments: thank you!',
    'Inglés o español:': 'English or Spanish:',
    'toda la página se puede ver en inglés. Cámbialo con ES | EN arriba a la derecha; se recuerda para la próxima vez.': 'the whole page can be shown in English. Switch it with ES | EN at the top right; it is remembered for next time.',
    'Ajustes de descarga en una barra plegada:': 'Download settings in a folded bar:',
    'la carpeta, los niveles, la letra, la batería y las perillas quedan en una sola línea con su resumen, y se abren con un clic. Así lo primero que ves es el buscador.': 'the folder, levels, lyrics, drums and knobs fit in one line with a summary, and open with a click. So the first thing you see is the search.',
    'Diseño más cómodo:': 'More comfortable design:',
    'en el celular el buscador aparece en la primera pantalla (las pestañas van en una fila que se desliza y los ajustes de descarga se pliegan con un resumen), Descargar se destaca en cada canción y se ve el foco al navegar con teclado.': 'on phones the search shows on the first screen (the tabs go in a sliding row and the download settings fold with a summary), Download stands out on each song and you can see the focus when using the keyboard.',
    'La imagen o el video de fondo se elige en cada canción (se quitó "Imagen para todas").': 'The background image or video is chosen per song ("Image for all" was removed).',
    'La versión aparece junto al nombre; tócala para ver estas mejoras.': 'The version shows next to the name; tap it to see these changes.',
    'Crear desde audio, más conectado con la canción:': 'Create from audio, more connected to the song:',
    'cuando un riff se repite, sale con los mismos botones cada vez, y el pulso se detecta mejor. Medido contra charts oficiales de Rock Band.': 'when a riff repeats, it comes out with the same buttons every time, and the beat is detected better. Measured against official Rock Band charts.',
    'Batería desde el audio mucho más precisa:': 'Drums from audio much more accurate:',
    'ahora encuentra el 85% de los golpes de redoblante (antes, el 30%).': 'it now finds 85% of the snare hits (before, 30%).',
    'Niveles creados más parecidos a los oficiales:': 'Created levels closer to the official ones:',
    'la batería en Medio conserva los platillos, los acordes que se vuelven una nota dejan la más baja y la cantidad de notas es como la de Rock Band. Si los prefieres más fáciles, elige "menos notas" en las perillas.': 'drums on Medium keep the cymbals, chords that become one note keep the lowest one and the number of notes is like Rock Band. If you prefer them easier, choose "fewer notes" on the knobs.',
    '🎼 Solo mapa de tempo:': '🎼 Tempo map only:',
    'el audio con el pulso ya marcado, para poner tú las notas en Moonscraper.': 'the audio with the beat already marked, so you place the notes in Moonscraper.',
    'Mi biblioteca arregla canciones en carpeta': 'My library fixes songs in folders',
    '(song.ini + notes.chart o notes.mid), no solo archivos .sng.': '(song.ini + notes.chart or notes.mid), not just .sng files.',
    '📁 Guardar como carpeta:': '📁 Save as folder:',
    'para Clone Hero anterior a la 1.1 (no lee .sng) y para editar en Moonscraper.': 'for Clone Hero older than 1.1 (no .sng) and for editing in Moonscraper.',
    'Audio más compatible:': 'More compatible audio:',
    'si subes WAV, M4A o FLAC, se convierte a Opus (pesa unas 9 veces menos).': 'if you upload WAV, M4A or FLAC, it is converted to Opus (about 9 times smaller).',
    'Canciones con dos charts:': 'Songs with two charts:',
    'si traen notes.chart y notes.mid, los niveles se crean en el que lee Clone Hero (notes.mid).': 'if they have notes.chart and notes.mid, the levels are created in the one Clone Hero reads (notes.mid).',
    'Aviso claro cuando el navegador no deja usar una carpeta, y guía de cómo crear la batería.': "A clear notice when the browser won't let you use a folder, and a guide on how to create drums.",
    'Al publicar una versión nueva, la página ya no mezcla archivos nuevos y viejos.': 'When a new version is published, the page no longer mixes new and old files.',
    'Pack nuevo:': 'New pack:',
    '(Barón Rojo, Extremoduro, Héroes del Silencio, Saratoga y más).': '(Barón Rojo, Extremoduro, Héroes del Silencio, Saratoga and more).',
    'Niveles creados según el tiempo real entre notas,': 'Levels created from the real time between notes,',
    'no según el compás, conservando las notas más importantes. Medio queda sin acordes.': 'not from the bar, keeping the most important notes. Medium has no chords.',
    '🎤 Letra con tiempos': '🎤 Timed lyrics', 'para las canciones que no la traen.': "for songs that don't have them.",
    '🥁 Batería creada desde el audio,': '🥁 Drums created from the audio,', 'con sus 4 niveles.': 'with its 4 levels.',
    '🖼 Imagen o video de fondo,': '🖼 Background image or video,', 'para todas las canciones o para cada una.': 'for all songs or for each one.',
    '26 packs nuevos': '26 new packs', 'por género y por artista.': 'by genre and by artist.',
    '(semana e histórico), contador y valoraciones.': '(this week and all time), counter and ratings.',
    'Cada canción muestra si trae letra, fondo, video, portada y batería.': 'Each song shows whether it has lyrics, background, video, album art and drums.',
    'Descargas que funcionan en Firefox, Safari y Brave (botón Guardar o archivos .zip).': 'Downloads that work in Firefox, Safari and Brave (Save button or .zip files).',
    'Crear desde audio: imagen, búsqueda de letra y letra pegada con sus tiempos.': 'Create from audio: image, lyrics search and pasted lyrics with their times.',
    'v1.0.0 · lanzamiento': 'v1.0.0 · launch',
    'Busca canciones en Chorus Encore y las guarda directo en tu carpeta Songs.': 'Finds songs on Chorus Encore and saves them straight to your Songs folder.',
    'Crea Fácil, Medio y Difícil': 'Creates Easy, Medium and Hard', 'a partir del Experto, en charts .chart y .mid.': 'from Expert, in .chart and .mid charts.',
    '▶ Vista previa jugable': '▶ Playable preview', 'con perillas para ajustar los niveles creados.': 'with knobs to adjust the created levels.',
    'Packs, estadísticas de tu biblioteca y exportar a Moonscraper.': 'Packs, library statistics and export to Moonscraper.',
    '🧪 Crear chart desde audio': '🧪 Create a chart from audio', '(experimental).': '(experimental).',
    'También se puede usar desde Claude Code y la línea de comandos.': 'It can also be used from Claude Code and the command line.',

    // footer
    'Canciones de': 'Songs from',
    '· los charts son obra de sus autores · los niveles creados son automáticos': '· the charts are the work of their authors · created levels are automatic',
  };

  const MONTHS = { enero: 'January', febrero: 'February', marzo: 'March', abril: 'April', mayo: 'May', junio: 'June', julio: 'July', agosto: 'August', septiembre: 'September', octubre: 'October', noviembre: 'November', diciembre: 'December' };
  const WORDS = /\b(Guitarra|Bajo|Rítmica|Teclado|Batería|Fácil|Medio|Difícil|Experto)\b/g;
  const words = s => s.replace(WORDS, w => EN[w]);
  const T = s => one(s) ?? s;
  const note = s => s.split(' · ').map(p => /\(/.test(p) ? words(p) : T(p)).join(' · ');

  /* ---------- texts with numbers or names inside ---------- */
  const RX = [
    [/^(\d+) de (\d+)$/, (a, b) => `${a} of ${b}`],
    [/^(\d+) de (\d+) canciones$/, (a, b) => `${a} of ${b} songs`],
    [/^([\d.,]+) canci(?:ón|ones)$/, n => `${n} ${n === '1' ? 'song' : 'songs'}`],
    [/^([\d.,]+) descargas?$/, n => `${n} ${n === '1' ? 'download' : 'downloads'}`],
    [/^(\d+) seleccionada\(s\)$/, n => `${n} selected`],
    [/^(\d+) canciones listas$/, n => `${n} songs ready`], [/^1 canción lista$/, () => '1 song ready'],
    [/^(\d+) con error$/, n => `${n} with errors`],
    [/^No se pudo descargar (\d+) canciones\.$/, n => `Couldn't download ${n} songs.`],
    [/^guardada en (.+)$/, f => `saved to ${f}`], [/^guardada como carpeta en (.+)$/, f => `saved as a folder in ${f}`],
    [/^(Lista en|en) "(.+)"$/, (w, z) => `${w === 'en' ? 'in' : 'Ready in'} "${z}"`],
    [/^se creó: (.+)$/, x => `created: ${words(x)}`],
    [/^(.+) guardada (como carpeta )?en (.+)$/, (n, c, f) => `${n} saved ${c ? 'as a folder ' : ''}to ${f}`],
    [/^(.+) enviada a (tu carpeta de Descargas|Descargas en \.zip: descomprímela en tu carpeta Songs)$/, (n, w) => `${n} ${T('enviada a ' + w)}`],
    [/^Intensidad (\d) de 6: (.+)$/, (n, l) => `Intensity ${n} of 6: ${T(l)}`],
    [/^(Fácil|Medio|Difícil|Experto): (original|se crea al descargar|no disponible)$/, (k, w) => `${EN[k]}: ${{ original: 'original', 'se crea al descargar': 'created when downloading', 'no disponible': 'not available' }[w]}`],
    [/^chart de (.+)$/, c => `chart by ${c}`],
    [/^(\d+) notas$/, n => `${n} notes`], [/^([\d.]+) por segundo$/, n => `${n} per second`],
    [/^(\d) de 5$/, n => `${n} of 5`], [/^([\d.]+) de 5$/, n => `${n} of 5`], [/^(\d+) votos?$/, n => `${n} ${n === '1' ? 'vote' : 'votes'}`],
    [/^🎤 Con letra \((\d+) líneas\): sale arriba mientras suena$/, n => `🎤 Lyrics (${n} lines): shown on top while it plays`],
    [/^Descargando canción… ([\d.]+) MB$/, n => `Downloading song… ${n} MB`],
    [/^Revisando tu biblioteca… (\d+) canciones$/, n => `Checking your library… ${n} songs`],
    [/^tienen (.+)$/, l => `have ${words(l)}`],
    [/^Les faltan niveles \((\d+)\)$/, n => `Missing levels (${n})`],
    [/^… y (\d+) más$/, n => `… and ${n} more`],
    [/^¡Listo! (\d+) BPM aprox\., (\d+) pulsos marcados\.$/, (b, n) => `Done! About ${b} BPM, ${n} beats marked.`],
    [/^Las (\d+) mejores versiones que encontré de (.+)$/, (n, a) => `The ${n} best versions I found by ${a}`],
    [/^Pack (.+) para Clone Hero$/, p => `${T(p)} pack for Clone Hero`],
    [/^Canciones de (.+) para Clone Hero$/, q => `${q} songs for Clone Hero`],
    [/^(\d+) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de (\d{4})$/, (d, m, y) => `${MONTHS[m]} ${d}, ${y}`],
    // library log
    [/^(OK {9}|ARREGLADA {2})(.+?) → (.+)$/, (k, l, x) => `${k.startsWith('OK') ? 'OK         ' : 'FIXED      '}${l} → ${note(x)}`],
    [/^ERROR {6}(.+)$/, x => `ERROR      ${x}`],
    [/^(.+?(?:\.sng| 📁)): (.+)$/, (l, x) => one(x) != null ? `${l}: ${one(x)}` : null],
    [/^Listo: (\d+) canciones revisadas(?: \((\d+) en carpeta\))?, (\d+) arregladas\. (.*)En Clone Hero dale a "Scan Songs"\.$/, (n, f, k, rest) =>
      `Done: ${n} songs checked${f ? ` (${f} in folders)` : ''}, ${k} fixed. ${rest.startsWith('Descomprime') ? 'Unzip the .zip files over your Songs folder to replace them. ' : rest ? 'A .original copy of each changed file was kept. ' : ''}In Clone Hero press "Scan Songs".`],
  ];

  function one(s) {
    if (Object.prototype.hasOwnProperty.call(EN, s)) return EN[s];
    // several lines, or several parts joined with " · ": each one on its own
    for (const sep of ['\n', ' · ']) {
      if (!s.includes(sep)) continue;
      const parts = s.split(sep), out = parts.map(p => { const c = p.match(/^(\s*)(.*?)(\s*)$/s); const t = c[2] ? one(c[2]) : null; return t == null ? p : c[1] + t + c[3]; });
      return out.some((p, i) => p !== parts[i]) ? out.join(sep) : null;
    }
    // ✔ / ✖ / ⚠ or a leading "·" in front of a known text
    const mark = s.match(/^([✔✖⚠] |· )(.+)$/s);
    if (mark) { const t = one(mark[2]); return t == null ? null : mark[1] + t; }
    for (const [re, f] of RX) { const m = s.match(re); if (m) { const r = f(...m.slice(1)); if (r != null) return r; } }
    // a list of levels or instruments: "Fácil, Medio, Difícil"
    if (s.includes(', ')) {
      const parts = s.split(', ').map(p => Object.prototype.hasOwnProperty.call(EN, p) ? EN[p] : null);
      if (parts.every(p => p != null)) return parts.join(', ');
    }
    return null;
  }
  function tr(s) {
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2]) return null;
    const t = one(m[2]);
    return t == null ? null : m[1] + t + m[3];
  }

  /* ---------- applying it to the page ---------- */
  // song names, artists and lyrics stay as they are
  const KEEP = '.pv-lyrics, .song .title, .song .artist, .pv-title, .pv-artist, .pt > b, .missing b, .missing small, #acTitle, textarea, script, style, [data-no-i18n]';
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const LETTERS = { F: 'E', M: 'M', D: 'H', X: 'X' };
  const srcText = new WeakMap(), shownText = new WeakMap(), srcAttr = new WeakMap(), shownAttr = new WeakMap();

  function doText(n) {
    const p = n.parentElement;
    if (!p || p.closest(KEEP)) return;
    const v = n.nodeValue;
    if (shownText.get(n) !== v) srcText.set(n, v);   // the app wrote something new
    const src = srcText.get(n);
    let out = src;
    if (lang === 'en') out = p.matches('i.d') ? (LETTERS[src.trim()] ?? src) : (tr(src) ?? src);
    if (v !== out) n.nodeValue = out;
    shownText.set(n, out);
  }
  function doAttrs(el) {
    if (el.closest('.pv-lyrics, [data-no-i18n]')) return;
    let src = srcAttr.get(el), shown = shownAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      if (!src) { src = {}; shown = {}; srcAttr.set(el, src); shownAttr.set(el, shown); }
      const v = el.getAttribute(a);
      if (shown[a] !== v) src[a] = v;
      const out = lang === 'en' ? (tr(src[a]) ?? src[a]) : src[a];
      if (v !== out) el.setAttribute(a, out);
      shown[a] = out;
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }
  const obs = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  });

  function showSwitch() {
    for (const b of document.querySelectorAll('[data-lang]')) {
      b.classList.toggle('on', b.dataset.lang === lang);
      b.setAttribute('aria-pressed', b.dataset.lang === lang);
    }
  }
  function set(l) {
    if (l !== 'es' && l !== 'en') return;
    lang = l;
    try { localStorage.setItem(KEY, l); } catch { }
    document.documentElement.lang = l;
    walk(document.documentElement);
    showSwitch();
    window.dispatchEvent(new CustomEvent('langchange', { detail: l }));
  }
  function start() {
    document.documentElement.lang = lang;
    walk(document.documentElement);
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    showSwitch();
    document.addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) set(b.dataset.lang); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // for texts that never reach the page (prompt, share)
  const t = s => lang === 'en' ? (tr(s) ?? s) : s;
  return { t, set, get lang() { return lang; }, _tr: tr };
})();

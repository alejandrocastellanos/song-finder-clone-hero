'use strict';
/* Usage stats with Google Analytics 4. Does nothing until GA_ID is set, and only loads Google's script after the visitor accepts. */
const Analytics = (() => {
  const GA_ID = 'G-D1S98ZJW6C';
  const KEY = 'chb-analytics';
  // only the published site counts, so local tests don't mix with real visits
  const LIVE = location.hostname === 'alejandrocastellanos.github.io';
  let active = false;

  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = v => { try { localStorage.setItem(KEY, v); } catch { } };

  function load() {
    if (active || !GA_ID) return;
    active = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
    const s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function banner() {
    const b = document.createElement('div');
    b.className = 'consent';
    b.innerHTML = `<span>¿Nos dejas contar visitas y uso de la web con Google Analytics? Nos ayuda a saber qué mejorar. Usa cookies y no incluye tus canciones ni tus archivos.</span>
      <span class="row" style="gap:8px"><button class="ghost" data-a="no">No, gracias</button><button class="primary" data-a="si">Aceptar</button></span>`;
    b.onclick = e => {
      const a = e.target.dataset.a; if (!a) return;
      write(a); b.remove();
      if (a === 'si') load();
    };
    document.body.appendChild(b);
  }

  function init() {
    if (!GA_ID || !LIVE) return;
    const c = read();
    if (c === 'si') load(); else if (c !== 'no') banner();
  }

  // only song and search names: never file paths or personal data
  function track(name, params) { if (active && window.gtag) window.gtag('event', name, params || {}); }

  return { init, track };
})();

'use strict';
/* Visual and sound effects: toasts, sparks/confetti and a synthesized guitar strum. */
const FX = (() => {
  let soundOn = false, actx = null;
  try { soundOn = localStorage.getItem('chb-sound') === '1'; } catch { }

  function setSound(on) { soundOn = on; try { localStorage.setItem('chb-sound', on ? '1' : '0'); } catch { } }
  const audio = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());

  // distorted power chord: root, fifth and octave through a waveshaper
  function strum(root = 82.4, big = true) {
    if (!soundOn) return;
    const a = audio(), t = a.currentTime;
    const shaper = a.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const out = a.createGain(); out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 2.2 : 0.45));
    shaper.connect(lp); lp.connect(out); out.connect(a.destination);
    [1, 1.5, 2].forEach((m, i) => {
      for (const det of [-6, 6]) {
        const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * m; o.detune.value = det;
        const g = a.createGain(); g.gain.value = 0.25;
        o.connect(g); g.connect(shaper);
        o.start(t + i * 0.012); o.stop(t + (big ? 2.3 : 0.5));
      }
    });
  }
  // short muted pick, for small actions
  function pick() { strum(110, false); }

  function toast(html, ms = 3500) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => dismiss(t), ms);
  }
  function dismiss(t, delay = 0) {
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 500); }, delay);
  }

  function sparks(count = 140) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.createElement('canvas'); cv.className = 'sparks';
    document.body.appendChild(cv);
    const W = cv.width = innerWidth, H = cv.height = innerHeight, g = cv.getContext('2d');
    const cols = ['#ff3d00', '#ff8a00', '#ffd166', '#2fd36b', '#3f8bff', '#ff3b3b', '#fff'];
    const ps = Array.from({ length: count }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.75,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 18 - 6,
      r: Math.random() * 4 + 2, c: cols[Math.random() * cols.length | 0], life: 1, rot: Math.random() * 6,
    }));
    let last = performance.now();
    (function frame(now) {
      const dt = Math.min(2, (now - last) / 16.7); last = now;
      g.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of ps) {
        p.vy += 0.45 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= 0.008 * dt; p.rot += 0.2 * dt;
        if (p.life <= 0 || p.y > H + 20) continue;
        alive++;
        g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore();
      }
      if (alive) requestAnimationFrame(frame); else cv.remove();
    })(last);
  }

  return { strum, pick, toast, dismiss, sparks, setSound, get soundOn() { return soundOn; } };
})();

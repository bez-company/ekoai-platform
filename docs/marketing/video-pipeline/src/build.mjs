// Gera um projeto HyperFrames (1080x1920) por vídeo a partir de uma lista de cenas.
// Uso: node src/build.mjs [id-do-video ...]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TAKES = path.join(ROOT, 'takes');
const OUT = path.join(ROOT, 'projects');

const W = 1080, H = 1920;
const C = { bg: '#160c1c', surface: '#22122b', raised: '#2f1f37', line: '#403146', paper: '#f7f1ef', muted: '#a69ca5', peach: '#ff8a65', app: '#f7f1ef' };

// ---------- marca ----------
const TAIL = 2.1, BULGE = 0.42;
const f = (n) => n.toFixed(2);
const dropPath = (cx, cy, r) => {
  const bx = cx - TAIL * r, mx = (cx + bx) / 2;
  return `M${cx} ${cy + r} A${r} ${r} 0 1 0 ${cx} ${cy - r} Q${f(mx)} ${f(cy - r * BULGE)} ${f(bx)} ${cy} Q${f(mx)} ${f(cy + r * BULGE)} ${cx} ${cy + r}Z`;
};
const DROPS = [
  [41, 24, 6.5, 0], [41, 94, 6.5, 0], [63, 40, 9, 1], [63, 78, 9, 1], [86, 58, 12, 2],
];
const markSvg = (id, size, cls = '') => `<svg id="${id}" class="${cls}" width="${size}" height="${size * 100 / 88}" viewBox="16 10 88 100"><g transform="rotate(-6 60 60)">${DROPS.map(([cx, cy, r, o], i) => `<path class="d d${o}" d="${dropPath(cx, cy, r)}" fill="${o === 2 ? C.peach : C.paper}"/>`).join('')}</g></svg>`;

// ---------- texto ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// "*destaque*" vira <em>; "\n" vira quebra. Cada palavra é um span animável.
function words(text, prefix) {
  let n = 0;
  return text.split('\n').map((line) => {
    const out = [];
    let endedSpace = false;
    for (const part of line.split(/(\*[^*]+\*)/).filter(Boolean)) {
      const acc = part.startsWith('*');
      const t = acc ? part.slice(1, -1) : part;
      const toks = t.split(/(\s+)/).filter((x) => x !== '');
      let glue = !/^\s/.test(t) && out.length > 0 && !endedSpace;
      for (const tok of toks) {
        if (/^\s+$/.test(tok)) { glue = false; continue; }
        out.push({ tok, acc, glue });
        glue = false;
      }
      endedSpace = /\s$/.test(t);
    }
    return out.map((o, i) => `${i === 0 || !o.glue ? (i === 0 ? '' : ' ') : ''}<span class="w${o.acc ? ' acc' : ''}" id="${prefix}-w${n++}">${esc(o.tok)}</span>`).join('');
  }).join('<br>');
}
const wordCount = (text) => (text.match(/\S+/g) || []).length - (text.match(/\*/g) || []).length / 2 * 0;

// ---------- take: janela com zoom ----------
const dims = {};
function dim(name) {
  if (!dims[name]) {
    const [w, h] = execSync(`ffprobe -v error -show_entries stream=width,height -of csv=p=0 "${TAKES}/${name}.png"`).toString().trim().split(',').map(Number);
    dims[name] = { w, h };
  }
  return dims[name];
}
function view(name, win, focus) {
  const { w, h } = dim(name);
  const H0 = win.w * h / w;
  const z = Math.max(1, Math.min(1 / focus.w, win.h / (focus.h * H0)));
  let x = win.w / 2 - (focus.x + focus.w / 2) * win.w * z;
  let y = win.h / 2 - (focus.y + focus.h / 2) * H0 * z;
  x = Math.min(0, Math.max(win.w - win.w * z, x));
  y = H0 * z <= win.h ? 0 : Math.min(0, Math.max(win.h - H0 * z, y));
  return { x: +x.toFixed(1), y: +y.toFixed(1), s: +z.toFixed(3) };
}
const FULL = { x: 0, y: 0, w: 1, h: 1 };

// ---------- CSS comum das cenas ----------
const FONTS = `
@font-face{font-family:"Sora";src:url("assets/fonts/sora-400-700-latin.woff2") format("woff2");font-weight:400 700}
@font-face{font-family:"DM Mono";src:url("assets/fonts/dm-mono-500-latin.woff2") format("woff2");font-weight:500}`;
const BASE = `${FONTS}
#root{position:absolute;inset:0;font-family:"Sora",sans-serif;color:${C.paper};-webkit-font-smoothing:antialiased}
#root .k{position:absolute;left:60px;right:60px;font-family:"DM Mono",monospace;font-weight:500;font-size:30px;letter-spacing:.14em;text-transform:uppercase;color:${C.peach}}
#root .w{display:inline-block;will-change:transform,opacity}
#root .acc{color:${C.peach}}
#root .t{position:absolute;left:60px;right:60px;font-weight:700;letter-spacing:-.035em;line-height:1.04}
`;

function scene(id, d, inner, css, js) {
  return `<template>
<style>${BASE}${css}</style>
<div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
${inner}
</div>
<script>
const tl = gsap.timeline({ paused: true });
const D = ${d};
${js}
window.__timelines["${id}"] = tl;
</script>
</template>
`;
}
const exitJs = (d) => `tl.to("#root > *", { opacity: 0, duration: 0.18, ease: "power1.in" }, ${(d - 0.2).toFixed(2)});`;
const wordsIn = (sel, at, step = 0.09) => `tl.fromTo("${sel}", { opacity: 0, y: 56, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5, ease: "power3.out", stagger: ${step} }, ${at});`;

// ---------- tipos de cena ----------
function hook(id, s) {
  const lines = (s.text.match(/\n/g) || []).length + 1;
  const size = s.size || 124;
  const top = 880 - (lines * size * 1.04) / 2;
  const css = `#${id}-t{top:${top}px;font-size:${size}px}#${id}-k{top:${top - 90}px}`;
  const inner = `<p id="${id}-k" class="k clip" data-start="0" data-duration="${s.d}">${esc(s.kicker || '')}</p>
<h1 id="${id}-t" class="t clip" data-start="0" data-duration="${s.d}">${words(s.text, id)}</h1>`;
  const js = `tl.fromTo("#${id}-k", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 0);
${wordsIn(`#${id}-t .w`, 0.15)}
${exitJs(s.d)}`;
  return scene(id, s.d, inner, css, js);
}

function shot(id, s) {
  const phone = s.kind === 'phone';
  const win = phone ? { w: 400, h: 866, l: 340, t: 450 } : { w: 960, h: 640, l: 60, t: 610 };
  const a = view(s.img, win, s.from || FULL);
  const b = view(s.img, win, s.to);
  const tsize = phone ? 72 : (s.tsize || 80);
  const css = `#${id}-k{top:${phone ? 190 : 200}px}
#${id}-t{top:${phone ? 250 : 262}px;font-size:${tsize}px}
#${id}-win{position:absolute;left:${win.l}px;top:${win.t}px;width:${win.w}px;height:${win.h}px;border-radius:${phone ? 44 : 28}px;overflow:hidden;background:${C.app};box-shadow:0 40px 100px -30px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.09)}
#${id}-img{position:absolute;left:0;top:0;width:${win.w}px;height:auto;transform-origin:0 0;max-width:none}
#${id}-chip{position:absolute;left:60px;top:${win.t + win.h + 26}px;padding:12px 24px;border-radius:999px;background:${C.raised};border:1px solid ${C.line};font-family:"DM Mono",monospace;font-weight:500;font-size:30px;letter-spacing:.02em;color:${C.paper}}
#${id}-chip i{display:inline-block;width:12px;height:12px;border-radius:50%;background:${C.peach};margin-right:14px}`;
  const inner = `<p id="${id}-k" class="k clip" data-start="0" data-duration="${s.d}">${esc(s.kicker)}</p>
<h2 id="${id}-t" class="t clip" data-start="0" data-duration="${s.d}">${words(s.title, id)}</h2>
<div id="${id}-win" class="clip" data-start="0" data-duration="${s.d}"><img id="${id}-img" src="assets/takes/${s.img}.png" alt=""></div>
${s.chip ? `<p id="${id}-chip" class="clip" data-start="0" data-duration="${s.d}"><i></i>${esc(s.chip)}</p>` : ''}`;
  const hold = 0.7, move = Math.max(1.2, s.d - hold - 0.9);
  const js = `tl.fromTo("#${id}-k", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 0);
${wordsIn(`#${id}-t .w`, 0.1, 0.07)}
tl.fromTo("#${id}-win", { opacity: 0, y: 80, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" }, 0.3);
tl.fromTo("#${id}-img", { x: ${a.x}, y: ${a.y}, scale: ${a.s}, transformOrigin: "0 0" }, { x: ${a.x}, y: ${a.y}, scale: ${a.s}, transformOrigin: "0 0", duration: 0.01 }, 0);
tl.to("#${id}-img", { x: ${b.x}, y: ${b.y}, scale: ${b.s}, transformOrigin: "0 0", duration: ${move.toFixed(2)}, ease: "power2.inOut" }, ${(0.3 + hold).toFixed(2)});
${s.chip ? `tl.fromTo("#${id}-chip", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, ${(0.3 + hold + 0.5).toFixed(2)});` : ''}
${exitJs(s.d)}`;
  return scene(id, s.d, inner, css, js);
}

function pains(id, s) {
  const rowH = 150, top0 = 470;
  const css = `#${id}-k{top:190px}
#${id}-t{top:250px;font-size:72px}
.row{position:absolute;left:60px;right:60px;height:${rowH - 20}px;border-radius:24px;background:${C.surface};border:1px solid ${C.line};padding:0 36px;display:flex;flex-direction:column;justify-content:center}
.row .p{position:relative;font-size:40px;font-weight:600;letter-spacing:-.02em;display:inline-block;align-self:flex-start;color:${C.paper}}
.row .strike{position:absolute;left:-6px;right:-6px;top:54%;height:4px;background:${C.peach};border-radius:2px;transform-origin:0 50%}
.row .s{font-size:32px;font-weight:500;color:${C.peach};letter-spacing:-.01em;margin-top:6px;height:40px}
.row .s span{display:inline-block}`;
  const rows = s.items.map((it, i) => `<div id="${id}-r${i}" class="row clip" data-start="0" data-duration="${s.d}" style="top:${top0 + i * rowH}px"><span class="p" id="${id}-p${i}">${esc(it[0])}<i class="strike" id="${id}-x${i}"></i></span><span class="s"><span id="${id}-s${i}">${esc(it[1])}</span></span></div>`).join('\n');
  const inner = `<p id="${id}-k" class="k clip" data-start="0" data-duration="${s.d}">${esc(s.kicker)}</p>
<h2 id="${id}-t" class="t clip" data-start="0" data-duration="${s.d}">${words(s.title, id)}</h2>
${rows}`;
  const n = s.items.length;
  const inAt = (i) => (0.7 + i * 0.4).toFixed(2);
  const strikeAt = (i) => (0.7 + n * 0.4 + 0.5 + i * 0.75).toFixed(2);
  const js = `tl.fromTo("#${id}-k", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 0);
${wordsIn(`#${id}-t .w`, 0.1, 0.07)}
${s.items.map((_, i) => `tl.fromTo("#${id}-r${i}", { opacity: 0, x: -50 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, ${inAt(i)});
tl.fromTo("#${id}-x${i}", { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.inOut" }, ${strikeAt(i)});
tl.to("#${id}-p${i}", { opacity: 0.45, duration: 0.3 }, ${strikeAt(i)});
tl.fromTo("#${id}-s${i}", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, ${(+strikeAt(i) + 0.2).toFixed(2)});`).join('\n')}
${exitJs(s.d)}`;
  return scene(id, s.d, inner, css, js);
}

function end(id, s) {
  const css = `#${id}-mark{position:absolute;left:${(W - 300) / 2}px;top:420px}
#${id}-mark .d{transform-box:fill-box;transform-origin:center}
#${id}-name{position:absolute;left:0;right:0;top:760px;text-align:center;font-weight:700;font-size:170px;letter-spacing:-.05em;line-height:1}
#${id}-tag{position:absolute;left:80px;right:80px;top:990px;text-align:center;font-weight:600;font-size:58px;letter-spacing:-.03em;line-height:1.1}
#${id}-url{position:absolute;left:0;right:0;top:1210px;text-align:center}
#${id}-url span{display:inline-block;padding:20px 44px;border-radius:999px;background:${C.peach};color:${C.bg};font-weight:700;font-size:40px;letter-spacing:-.01em}`;
  const inner = `<div id="${id}-mark" class="clip" data-start="0" data-duration="${s.d}">${markSvg(`${id}-svg`, 300)}</div>
<p id="${id}-name" class="clip" data-start="0" data-duration="${s.d}">ekoai</p>
<p id="${id}-tag" class="t clip" data-start="0" data-duration="${s.d}">${words(s.tag, id)}</p>
<p id="${id}-url" class="clip" data-start="0" data-duration="${s.d}"><span>${esc(s.cta)}</span></p>`;
  const js = `tl.fromTo("#${id}-mark .d0", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2)", stagger: 0.06 }, 0.1);
tl.fromTo("#${id}-mark .d1", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2)", stagger: 0.06 }, 0.3);
tl.fromTo("#${id}-mark .d2", { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(2.4)" }, 0.5);
tl.fromTo("#${id}-name", { opacity: 0, y: 40, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "power3.out" }, 0.7);
${wordsIn(`#${id}-tag .w`, 1.1, 0.06)}
tl.fromTo("#${id}-url", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 1.8);`;
  return scene(id, s.d, inner, css, js);
}

const KIND = { hook, shot, pains, end };

// ---------- projeto ----------
function buildVideo(v) {
  const dir = path.join(OUT, v.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'compositions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets/takes'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'src/assets'), path.join(dir, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'hyperframes.json'), path.join(dir, 'hyperframes.json'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: v.id, private: true, type: 'module' }, null, 2));

  let t = 0;
  const hosts = v.scenes.map((s, i) => {
    const id = `s${String(i + 1).padStart(2, '0')}`;
    fs.writeFileSync(path.join(dir, 'compositions', `${id}.html`), KIND[s.type](id, s));
    if (s.img) fs.copyFileSync(path.join(TAKES, `${s.img}.png`), path.join(dir, 'assets/takes', `${s.img}.png`));
    const host = `<div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${t.toFixed(2)}" data-duration="${s.d}" data-track-index="1" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`;
    t += s.d;
    return host;
  });
  const total = +t.toFixed(2);
  const endStart = +(total - v.scenes.at(-1).d).toFixed(2);

  const html = `<!doctype html>
<html lang="pt-BR" data-resolution="portrait">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="assets/gsap.min.js"></script>
<style>
@font-face{font-family:"Sora";src:url("assets/fonts/sora-400-700-latin.woff2") format("woff2");font-weight:400 700}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:${C.bg}}
#bg{position:absolute;inset:0;background:radial-gradient(900px 700px at 85% 8%,rgba(255,138,101,.16),transparent 70%),radial-gradient(1000px 800px at 10% 95%,rgba(120,60,140,.30),transparent 70%),${C.bg}}
#glow{position:absolute;left:-200px;top:300px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(255,138,101,.10),transparent 65%)}
#foot{position:absolute;left:0;right:0;top:1500px;display:flex;align-items:center;justify-content:center;gap:18px;font-family:"Sora",sans-serif;font-weight:700;font-size:44px;letter-spacing:-.04em;color:${C.paper};opacity:.55}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
<div id="bg"></div>
<div id="glow"></div>
<div id="foot" class="clip" data-start="0" data-duration="${endStart}" data-track-index="2">${markSvg('foot-mark', 44)}<span>ekoai</span></div>
${hosts.join('\n')}
<audio id="music" src="assets/music.mp3" data-start="0" data-duration="${total}" data-track-index="3" data-volume="0.5" data-fade-in="0.8" data-fade-out="1.6"></audio>
</div>
<script>
const tl = gsap.timeline({ paused: true });
tl.fromTo("#glow", { x: 0, y: 0 }, { x: 700, y: 500, duration: ${total}, ease: "none" }, 0);
window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`${v.id}: ${v.scenes.length} cenas, ${total}s`);
}

const { VIDEOS } = await import('./videos.mjs');
const only = process.argv.slice(2);
for (const v of VIDEOS) if (!only.length || only.includes(v.id)) buildVideo(v);

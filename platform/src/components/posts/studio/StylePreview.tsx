// StylePreview.tsx: a prévia de cada estilo da vitrine (SPEC 030, protótipo v26). Desenhada em CSS com as cores da marca, só para
// dar a ideia da direção; não é o post. Estilo sem prévia própria mostra o nome sobre um fundo liso.

import type { CSSProperties } from 'react';
import { contrast } from '@/lib/design/color';

const PAPER = '#F7F1EF';
const ink = (bg: string): string => (contrast(bg, '#FFFFFF') >= contrast(bg, '#111111') ? '#FFFFFF' : '#111111');
const abs = (extra: CSSProperties): CSSProperties => ({ position: 'absolute', display: 'block', ...extra });

export default function StylePreview({ id, name, primary, accent }: { id: string; name: string; primary: string; accent: string }) {
  const onPrimary = ink(primary);
  const onAccent = ink(accent);
  const base: CSSProperties = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontSize: 11 };
  const strong: CSSProperties = { fontWeight: 800, lineHeight: 0.95, letterSpacing: '-0.02em' };
  switch (id) {
    case 'cartaz-tipografico':
      return (
        <div style={{ ...base, background: primary }}>
          <b style={abs({ left: '10%', top: '16%', width: '80%', color: onPrimary, fontSize: '2.1em', ...strong })}>Frase que vira imagem.</b>
        </div>
      );
    case 'numero-gigante':
      return (
        <div style={{ ...base, background: accent }}>
          <b style={abs({ left: '8%', bottom: '22%', color: onAccent, fontSize: '4.4em', ...strong })}>24h</b>
          <span style={abs({ left: '10%', bottom: '10%', color: onAccent, fontSize: '0.8em' })}>um número de verdade</span>
        </div>
      );
    case 'citacao-grande':
      return (
        <div style={{ ...base, background: PAPER }}>
          <b style={abs({ left: '8%', top: '10%', color: accent, fontSize: '5em', lineHeight: 0.7 })}>“</b>
          <span style={abs({ left: '10%', top: '42%', width: '80%', color: primary, fontSize: '1.25em', fontWeight: 700, lineHeight: 1.05 })}>Uma frase que vale guardar.</span>
        </div>
      );
    case 'mockup-anotado':
      return (
        <div style={{ ...base, background: PAPER }}>
          <i style={abs({ left: '14%', top: '26%', width: '66%', height: '44%', background: '#FFFFFF', borderRadius: 6, boxShadow: '0 3px 10px #0002', transform: 'rotate(-3deg)' })} />
          <i style={abs({ left: '24%', top: '38%', width: '40%', height: 5, background: '#D8CFCB', borderRadius: 3, transform: 'rotate(-3deg)' })} />
          <i style={abs({ left: '24%', top: '50%', width: '32%', height: 5, background: '#D8CFCB', borderRadius: 3, transform: 'rotate(-3deg)' })} />
          <em style={abs({ left: '12%', top: '8%', color: accent, font: 'italic 1.1em Georgia, serif' })}>uma nota à mão</em>
        </div>
      );
    case 'surreal-fotografico':
      return (
        <div style={{ ...base, background: `radial-gradient(circle at 72% 58%, ${accent} 0, ${primary} 70%, #111111 100%)` }}>
          <i style={abs({ right: '16%', bottom: '14%', width: '22%', height: '34%', background: '#111111', borderRadius: '50% 50% 8% 8%' })} />
          <b style={abs({ left: '9%', top: '9%', color: '#FFFFFF', fontSize: '1.25em', lineHeight: 1 })}>A ideia vira cena</b>
        </div>
      );
    case 'objeto-heroi':
      return (
        <div style={{ ...base, background: primary }}>
          <i style={abs({ left: '28%', top: '30%', width: '44%', height: '36%', borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, #FFFFFF, ${accent} 70%)`, boxShadow: '0 14px 16px #0004' })} />
          <span style={abs({ left: '10%', bottom: '9%', color: onPrimary, fontSize: '0.95em', fontWeight: 700 })}>Um objeto só</span>
        </div>
      );
    case 'cena-cotidiana':
      return (
        <div style={{ ...base, background: `linear-gradient(160deg, ${accent}, ${primary})` }}>
          <i style={abs({ left: '-6%', bottom: '-8%', width: '70%', height: '46%', borderRadius: '50%', background: '#FFFFFF33' })} />
          <span style={abs({ left: '9%', top: '10%', color: '#FFFFFF', fontSize: '1em', fontWeight: 600, width: '60%', lineHeight: 1.1 })}>Um dia como outro qualquer</span>
        </div>
      );
    case 'capa-de-revista':
      return (
        <div style={{ ...base, background: `linear-gradient(180deg, #111111 0 22%, ${primary} 22%)` }}>
          <b style={abs({ left: '8%', top: '5%', color: '#FFFFFF', fontSize: '0.9em', letterSpacing: '0.12em' })}>MANCHETE</b>
          <b style={abs({ left: '8%', top: '28%', width: '78%', color: onPrimary, fontSize: '1.7em', lineHeight: 0.95 })}>A grande história</b>
        </div>
      );
    default:
      return (
        <div style={{ ...base, background: PAPER }}>
          <b style={abs({ left: '10%', top: '14%', width: '80%', color: primary, fontSize: '1.25em', lineHeight: 1 })}>{name}</b>
          <i style={abs({ left: '10%', bottom: '12%', width: '30%', height: 6, borderRadius: 3, background: accent, opacity: 0.6 })} />
        </div>
      );
  }
}

import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from '../platform/src/lib/svg-sanitize.ts';

const wrap = (inner, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg>`;
const ok = (src) => {
  const r = sanitizeSvg(src);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.svg;
};
const refused = (src) => {
  const r = sanitizeSvg(src);
  expect(r.ok, `deveria recusar: ${src.slice(0, 120)}`).toBe(false);
  return r.error;
};

describe('SVG de logo legítimo', () => {
  it('formas, cores e gradientes passam e saem reescritos', () => {
    const svg = ok(`<?xml version="1.0" encoding="UTF-8"?>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="40" viewBox="0 0 100 40">
        <defs><linearGradient id="g"><stop offset="0" stop-color="#B83262"/><stop offset="1" stop-color="#4A2C2A"/></linearGradient></defs>
        <!-- comentário some -->
        <g fill="url(#g)" transform="translate(2 2)"><path d="M0 0L10 10Z"/><circle cx="5" cy="5" r="3"/></g>
        <text x="1" y="2">doce &amp; ponto</text>
        <use xlink:href="#g"/>
      </svg>`);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"')).toBe(true);
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toContain('<text x="1" y="2">doce &amp; ponto</text>');
    expect(svg).not.toContain('comentário');
    expect(svg).not.toContain('<?xml');
  });

  it('o resultado é estável: sanitizar de novo não muda nada', () => {
    const once = ok(wrap('<rect x="1" y="1" width="8" height="8" fill="#FF8A65"/><text>a &lt; b</text>'));
    expect(ok(once)).toBe(once);
  });

  it('atributo e elemento fora da lista caem sem recusar (editores de vetor)', () => {
    const svg = ok(wrap('<sodipodi:namedview id="x"/><metadata><rdf:RDF/></metadata><path d="M0 0" inkscape:label="a" data-x="1" fill="red"/>', ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"').replace('xmlns:inkscape', 'foo'));
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><path d="M0 0" fill="red"/></svg>');
  });

  it('<style> com seletor simples passa e é reescrito', () => {
    const svg = ok(wrap('<style>.a{fill:#fff} .b > path{stroke:#000}</style><path class="a" d="M0 0"/>'));
    expect(svg).toContain('<style>.a{fill:#fff} .b &gt; path{stroke:#000}</style>');
  });
});

describe('SVG hostil é recusado', () => {
  const cases = {
    'script': wrap('<script>alert(1)</script>'),
    'script com namespace': wrap('<svg:script xmlns:svg="x"/>').replace('<svg:script xmlns:svg="x"/>', '<script/>'),
    'foreignObject': wrap('<foreignObject><div>x</div></foreignObject>'),
    'iframe': wrap('<iframe src="x"/>'),
    'object e embed': wrap('<object data="x"/>'),
    'animação que muda href': wrap('<a href="#x"><animate attributeName="href" values="javascript:alert(1)"/></a>'),
    'set': wrap('<set attributeName="onmouseover" to="alert(1)"/>'),
    'image externa': wrap('<image href="https://evil.example/x.png"/>'),
    'image com data': wrap('<image href="data:image/png;base64,AAAA"/>'),
    'feImage': wrap('<filter id="f"><feImage href="https://evil.example/x"/></filter>'),
    'link': wrap('<a href="https://evil.example"><rect/></a>'),
    'manipulador de evento': wrap('<rect onload="alert(1)"/>'),
    'manipulador em maiúsculas': wrap('<rect ONCLICK="alert(1)"/>'),
    'manipulador em elemento descartado': wrap('<foo onclick="x"/>'),
    'href javascript': wrap('<use href="javascript:alert(1)"/>'),
    'xlink:href externo': wrap('<use xlink:href="https://evil.example/x.svg#a" xmlns:xlink="http://www.w3.org/1999/xlink"/>'),
    'href de dado': wrap('<use href="data:image/svg+xml;base64,AAAA"/>'),
    'url externa no fill': wrap('<rect fill="url(https://evil.example/a.svg#x)"/>'),
    'url com aspas externa': wrap('<rect fill="url(\'//evil.example/a\')"/>'),
    'url escondida por entidade': wrap('<rect fill="ur&#108;(https://evil.example)"/>'),
    'javascript escondido por entidade': wrap('<rect style="x:&#106;avascript:alert(1)"/>'),
    'url no style': wrap('<rect style="fill:url(http://evil.example/x)"/>'),
    '@import no style': wrap('<style>@import url(https://evil.example/x.css);</style>'),
    'font externa no style': wrap('<style>@font-face{src:url(https://evil.example/f.woff)}</style>'),
    'expression no CSS': wrap('<rect style="width:expression(alert(1))"/>'),
    'escape CSS escondendo url': wrap('<style>.a{background:\\75rl(https://evil.example)}</style>'),
    'escape CSS de um dígito': wrap('<style>.a{x:\\6a avascript:alert(1)}</style>'),
    'DOCTYPE': '<!DOCTYPE svg SYSTEM "http://evil.example/x.dtd">' + wrap('<rect/>'),
    'entidade própria (XXE)': '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + wrap('<text>&x;</text>'),
    'entidade desconhecida no texto': wrap('<text>&lol;</text>'),
    'entidade sem ponto e vírgula': wrap('<text>a &amp b</text>'),
    'caractere de controle por entidade': wrap('<text>&#1;</text>'),
    'CDATA': wrap('<style><![CDATA[a{}]]></style>'),
    'instrução de processamento': '<?xml-stylesheet href="x.css"?>' + wrap('<rect/>'),
    'xmlns estranho': wrap('<rect/>', ' xmlns:evil="http://evil.example"').replace('xmlns:evil="http://evil.example"', 'xmlns="http://evil.example"'),
    'raiz que não é svg': '<html><body><svg/></body></html>',
    'duas raízes': wrap('') + wrap(''),
    'texto fora do desenho': wrap('') + 'x',
    'tag mal fechada': '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    'tag sem fechar': '<svg xmlns="http://www.w3.org/2000/svg"><g>',
    'atributo repetido': wrap('<rect x="1" x="2"/>'),
    'atributo sem aspas': wrap('<rect x=1/>'),
    'byte nulo': wrap('<rect/>') + '\0',
    'comentário sem fim': wrap('<rect/>') + '<!-- x',
    'vazio': '',
    'não é XML': 'isto não é um SVG',
  };
  for (const [name, src] of Object.entries(cases)) {
    it(name, () => {
      refused(src);
    });
  }

  it('a mensagem diz o que trocar', () => {
    expect(refused(wrap('<script/>'))).toMatch(/<script>.*Exporte o logo/);
    expect(refused(wrap('<rect fill="url(https://x.test/a)"/>'))).toMatch(/fora do arquivo/);
    expect(refused('<!DOCTYPE svg>' + wrap(''))).toMatch(/DOCTYPE/);
  });
});

describe('limites', () => {
  it('elementos demais, aninhamento demais e use demais', () => {
    expect(refused(wrap('<rect/>'.repeat(5001)))).toMatch(/elementos demais/);
    expect(refused(wrap('<g>'.repeat(40) + '</g>'.repeat(40)))).toMatch(/aninhado/);
    expect(refused(wrap('<use href="#a"/>'.repeat(201)))).toMatch(/repete/);
  });

  it('valor gigante é recusado', () => {
    expect(refused(wrap(`<path d="${'M0 0 '.repeat(50000)}"/>`))).toMatch(/valor grande/);
  });
});

describe('saída segura por construção', () => {
  it('nada fora da lista sobrevive na saída, mesmo com lixo misturado', () => {
    const svg = ok(wrap('<g id="a" foo="bar" class="c"><path d="M0 0" xpto="1" fill="red" bar="1"/></g><unknown><rect id="dentro"/></unknown>'));
    expect(svg).not.toMatch(/foo|bar|xpto|unknown|dentro/);
    expect(svg).toContain('<g id="a" class="c"><path d="M0 0" fill="red"/></g>');
  });

  it('o valor de atributo sai escapado', () => {
    const svg = ok(wrap('<text id="a&quot;b&lt;c">x</text>'));
    expect(svg).toContain('id="a&quot;b&lt;c"');
    expect(svg).not.toMatch(/id="a"b/);
  });

  it('o xmlns da saída é sempre o do SVG, mesmo se o arquivo não declarar', () => {
    expect(ok('<svg viewBox="0 0 1 1"><rect/></svg>')).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><rect/></svg>');
  });
});

// PostSummary.tsx: o resumo do post e a estimativa (SPEC 030). Mostra o que a pessoa escolheu e, com SHOW_PRICE_IN_FLOW ligado,
// quanto custa; o preço é o do nível (mais a imagem), cobrado ao aprovar.

import { IMAGE_QUALITY, SHOW_PRICE_IN_FLOW, STYLES, brl, estimate, levelOf, type Effort, type ImageQuality } from '@/lib/studio/levels';

function styleName(style: string): string {
  if (style === 'auto') return 'A Ekoai escolhe';
  if (style === 'auto-minimalista') return 'A Ekoai escolhe, entre os minimalistas';
  if (style === 'auto-imagem') return 'A Ekoai escolhe, entre os com imagem';
  return STYLES.find((s) => s.id === style)?.name ?? 'A Ekoai escolhe';
}

export default function PostSummary({ effort, style, imageQuality }: { effort: Effort; style: string; imageQuality: ImageQuality }) {
  const level = levelOf(effort);
  const est = estimate({ effort, style, imageQuality });
  return (
    <section className="card space-y-3" aria-label="Resumo do post">
      <h2 className="text-lg font-semibold">Resumo do post</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Estilo</dt>
        <dd>{styleName(style)}</dd>
        <dt className="text-muted">Tipo</dt>
        <dd>{est.image === 'maybe' ? 'Definido pelo estilo' : est.image === 'yes' ? 'Com imagem de fundo' : 'Minimalista, sem imagem de IA'}</dd>
        {est.image !== 'no' && (
          <>
            <dt className="text-muted">Imagem</dt>
            <dd>{IMAGE_QUALITY[imageQuality].name}</dd>
          </>
        )}
        <dt className="text-muted">Esforço</dt>
        <dd>{level.name}</dd>
        <dt className="text-muted">Tempo</dt>
        <dd>{level.time}</dd>
      </dl>
      {SHOW_PRICE_IN_FLOW && (
        <div className="space-y-0.5 rounded-lg bg-accent/10 p-3">
          <small className="block text-xs text-muted">Estimativa deste post</small>
          <b className="block text-2xl tabular-nums text-accent-text">{brl(est.priceCents)}</b>
          {est.maxCents !== null && <small className="block text-xs text-muted">até {brl(est.maxCents)} se o estilo usar imagem</small>}
          <small className="block text-xs text-muted">{effort === 'instantaneo' ? 'Pronto na hora.' : 'Cobrado quando você aprovar.'}</small>
        </div>
      )}
    </section>
  );
}

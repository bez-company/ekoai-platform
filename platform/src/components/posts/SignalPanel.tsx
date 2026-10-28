import { criticFromStored, type Band, type Critic, type Score } from '@/lib/signal-critic';

// O potencial do post na rede (SPEC 028, BEZ-425): faixa e checklist, nunca uma nota que pareça da rede. Cada critério mostra o
// trecho do post que o prova (entre aspas) ou o que falta, e a sugestão de quem avaliou. Sem avaliação guardada, não aparece.
const BAND: Record<Band, { label: string; tone: string }> = {
  forte: { label: 'Forte', tone: 'border-success/40 text-success' },
  medio: { label: 'Médio', tone: 'border-warning/40 text-warning' },
  fraco: { label: 'Fraco', tone: 'border-danger/40 text-danger' },
};
const SCORE_BAND: Record<Score, Band> = { 2: 'forte', 1: 'medio', 0: 'fraco' };
const NAME = { instagram: 'Instagram', linkedin: 'LinkedIn' } as const;

export default function SignalPanel({ stored }: { stored: unknown }) {
  const critic: Critic | null = criticFromStored(stored);
  if (!critic) return null;
  const name = NAME[critic.channel];
  const weak = critic.criteria.filter((c) => c.score < 2).length;
  return (
    <section className="card space-y-3" aria-label={`Potencial no ${name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Potencial no {name}</h2>
        <span className={`chip ${BAND[critic.band].tone}`}>{BAND[critic.band].label}</span>
        <span className="text-sm text-muted">{weak ? `${weak} ${weak === 1 ? 'ponto' : 'pontos'} para melhorar` : 'Nenhum ponto fraco'}</span>
      </div>
      <p className="text-xs text-muted">Estimativa da Ekoai a partir do que o {name} diz medir. Não é a nota da rede.</p>
      {critic.fixed && <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">A Ekoai já ajustou o texto para melhorar este ponto antes de mostrar o post.</p>}
      <ul className="divide-y divide-line">
        {critic.criteria.map((c) => {
          const band = BAND[SCORE_BAND[c.score]];
          return (
            <li key={c.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{c.label}</strong>
                <span className={`chip ${band.tone}`}>{band.label}</span>
              </div>
              {c.evidence && <p className="text-sm text-muted">{c.score > 0 ? `"${c.evidence}"` : c.evidence}</p>}
              {c.suggestion && c.score < 2 && (
                <p className="rounded-md border border-line bg-inset px-3 py-2 text-sm">
                  <strong>Sugestão:</strong> {c.suggestion}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

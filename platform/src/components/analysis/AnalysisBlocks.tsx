import Link from 'next/link';
import { recommendationText, suggestionHref, type AudienceCardView, type ContentView, type HoursView } from '@/lib/analysis-view';
import { MIN_GROUP, type Group } from '@/lib/content-analysis-model';

// Os blocos da aba Analytics (SPEC 022). Sem JavaScript no cliente: as barras são largura e altura em
// porcentagem, e o texto de cada gráfico diz o mesmo que ele mostra (a cor nunca é a única pista).

const pct = (v: number) => `${Math.round(v * 100)}%`;
const rate = (v: number) => `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const posts = (n: number) => (n === 1 ? '1 post' : `${n} posts`);

function Progress({ have, need, label }: { have: number; need: number; label: string }) {
  return (
    <>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={have} aria-label={label} className="mt-3 h-2 max-w-sm overflow-hidden rounded-full bg-inset">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.round((have / need) * 100))}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </>
  );
}

function Wait({ title, text, have, need, label }: { title: string; text: string; have: number; need: number; label: string }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
      <Progress have={have} need={need} label={label} />
    </div>
  );
}

function GroupBars({ title, groups }: { title: string; groups: Group[] }) {
  if (!groups.length) return null;
  const max = Math.max(...groups.map((g) => g.avg), 0.0001);
  const best = Math.max(...groups.filter((g) => !g.low).map((g) => g.avg), -1);
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold text-muted">{title}</h3>
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={g.key} aria-label={`${g.label}: engajamento ${rate(g.avg)}, ${posts(g.n)}${g.low ? ', poucos posts para concluir' : ''}`}>
            <div className={`flex items-baseline justify-between gap-2 text-sm ${g.low ? 'text-muted' : ''}`}>
              <span className="truncate">{g.label}</span>
              <span className={g.low ? '' : 'font-semibold'}>{rate(g.avg)}</span>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-inset" aria-hidden="true">
              <div className={`h-full rounded-full ${g.low ? 'bg-line-strong' : g.avg === best ? 'bg-accent' : 'bg-accent/45'}`} style={{ width: `${Math.max(3, Math.round((g.avg / max) * 100))}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {posts(g.n)}
              {g.low ? ' · poucos' : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ContentBlock({ view, windowDays, bestTitle }: { view: ContentView; windowDays: number; bestTitle: string | null }) {
  return (
    <section className="card" aria-labelledby="an-content">
      <h2 id="an-content" className="text-lg font-semibold">
        O que funciona nos seus posts
      </h2>
      {view.state === 'wait' ? (
        <div className="mt-3">
          <Wait
            title={`Faltam ${view.need - view.have} posts para comparar`}
            text={`A Ekoai compara tipo, formato e objetivo quando há ${view.need} posts com alcance. Cada post publicado entra na conta sozinho.`}
            have={view.have}
            need={view.need}
            label={`${view.have} de ${view.need} posts`}
          />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            Engajamento médio (interações sobre alcance) dos {view.breakdown.counted} posts dos últimos {windowDays} dias.
          </p>
          {view.insight && (
            <p className="mt-3 rounded-lg bg-accent/10 px-3.5 py-3 text-sm">
              <strong>{view.insight.text}</strong>
              {bestTitle ? ` Melhor post: "${bestTitle}".` : ''}
            </p>
          )}
          <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <GroupBars title="Por tipo" groups={view.breakdown.kind} />
            <GroupBars title="Por formato" groups={view.breakdown.format} />
            <GroupBars title="Por objetivo" groups={view.breakdown.goal} />
          </div>
          <p className="mt-4 text-xs text-muted">
            Compara os seus posts entre si e não prova que o tipo causa o resultado. Grupos com menos de {MIN_GROUP} posts ficam em cinza e não entram na conclusão.
          </p>
        </>
      )}
    </section>
  );
}

export function AudienceBlock({ view }: { view: AudienceCardView }) {
  return (
    <section className="card" aria-labelledby="an-audience">
      <h2 id="an-audience" className="text-lg font-semibold">
        Seu público
      </h2>
      {view.state === 'ok' && (
        <>
          <p className="text-sm text-muted">Seguidores da conta, últimos 30 dias. A Meta atrasa até 48 h.</p>
          {view.age && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-muted">Faixa etária</h3>
              <ul className="flex h-36 items-end gap-2" aria-label={`Faixa etária: ${view.age.map((a) => `${a.label} anos, ${pct(a.value)}`).join('; ')}`}>
                {view.age.map((a) => {
                  const max = Math.max(...view.age!.map((x) => x.value), 0.0001);
                  return (
                    <li key={a.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <b className="text-xs">{pct(a.value)}</b>
                      <div className={`w-full max-w-11 rounded-t-md ${a.top ? 'bg-accent' : 'bg-accent/45'}`} style={{ height: `${Math.max(4, Math.round((a.value / max) * 100))}%` }} aria-hidden="true" />
                      <span className="text-center text-[11px] leading-tight text-muted">{a.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {view.gender && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-muted">Gênero</h3>
              <div className="flex h-3.5 overflow-hidden rounded-full bg-inset" role="img" aria-label={`Gênero: ${view.gender.map((g) => `${g.label} ${pct(g.value)}`).join('; ')}`}>
                {view.gender.map((g) => (
                  <div key={g.key} className={g.key === 'F' ? 'bg-accent' : g.key === 'M' ? 'bg-accent/50' : 'bg-line-strong'} style={{ width: `${g.value * 100}%` }} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {view.gender.map((g) => (
                  <li key={g.key} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${g.key === 'F' ? 'bg-accent' : g.key === 'M' ? 'bg-accent/50' : 'bg-line-strong'}`} />
                    {g.label} <b>{pct(g.value)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {view.state === 'too_few' && (
        <div className="mt-3">
          <Wait
            title={`Faltam ${Math.max(0, view.need - (view.followers ?? 0))} seguidores para ver o público`}
            text={`A Meta só entrega faixa etária e gênero a partir de ${view.need} seguidores.${view.followers !== null ? ` A conta tem ${view.followers}.` : ''}`}
            have={view.followers ?? 0}
            need={view.need}
            label={`${view.followers ?? 0} de ${view.need} seguidores`}
          />
        </div>
      )}
      {view.state === 'unavailable' && <p className="mt-2 text-sm text-muted">A Meta não devolveu o público desta conta na última leitura. A Ekoai tenta de novo a cada 6 horas.</p>}
      {view.state === 'none' && <p className="mt-2 text-sm text-muted">Ainda sem leitura do público. A primeira leitura sai em até 6 horas depois de conectar o Instagram.</p>}
    </section>
  );
}

export function HoursBlock({ view }: { view: HoursView }) {
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const max = Math.max(...view.values.map((v) => v ?? 0), 0.0001);
  const rec = view.recommendation;
  return (
    <section className="card" aria-labelledby="an-hours">
      <h2 id="an-hours" className="text-lg font-semibold">
        Quando seu público está ativo
      </h2>
      {view.mode === 'none' ? (
        <p className="mt-2 text-sm text-muted">Ainda sem dado de horário. Quando a Meta devolver o horário dos seguidores, ou depois dos primeiros posts com alcance, o gráfico aparece aqui.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {view.mode === 'online'
              ? 'Quando os seus seguidores estão no Instagram, nos últimos 30 dias. Horário de Brasília.'
              : 'Engajamento médio dos seus posts por horário em que saíram. Só aparecem as horas em que você já publicou.'}
          </p>
          <ul className="mt-4 flex h-32 items-end gap-1" aria-label={`${view.mode === 'online' ? 'Seguidores online' : 'Engajamento dos posts'} por horário. ${view.peaks}`}>
            {hours.map((h) => {
              const v = view.values[h] ?? 0;
              return (
                <li key={h} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <div className={`w-full rounded-t ${v === max && v > 0 ? 'bg-accent' : v > 0 ? 'bg-accent/45' : 'bg-line'}`} style={{ height: `${v > 0 ? Math.max(6, Math.round((v / max) * 100)) : 3}%` }} aria-hidden="true" />
                  <span className="h-3 text-[10px] leading-none text-muted">{h % 3 === 0 ? `${h}h` : ''}</span>
                </li>
              );
            })}
          </ul>
          {view.peaks && <p className="mt-3 text-sm text-muted">{view.peaks}</p>}
        </>
      )}
      <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-3 ${rec.ok ? 'border-accent/35 bg-accent/10' : 'border-line bg-inset'}`}>
        <div className="min-w-0 flex-1 basis-56">
          <strong className="block text-sm">{rec.ok ? 'Poste nos horários em que seu público está mais ativo' : recommendationText(rec)}</strong>
          {rec.ok && (
            <p className="mt-0.5 text-sm text-muted">
              {recommendationText(rec)}. Baseado em {rec.basedOn} posts{rec.usedOnline ? ' e no horário online dos seguidores' : ''}.
            </p>
          )}
          {!rec.ok && <p className="mt-0.5 text-sm text-muted">A recomendação usa o desempenho dos seus posts e precisa de 12 com alcance.</p>}
        </div>
        {rec.ok && (
          <Link href={suggestionHref()} className="btn-ghost">
            Ver horários sugeridos
          </Link>
        )}
      </div>
    </section>
  );
}

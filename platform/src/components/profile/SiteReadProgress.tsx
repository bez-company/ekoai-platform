'use client';

// SiteReadProgress.tsx: a tela de "lendo a marca" em tempo real (SPEC 034, BEZ-533; protótipo v30, Fase 13). À esquerda, o que o servidor está
// fazendo agora (a frase e a página, as páginas lidas, o tempo e o histórico); à direita, um cartão por resultado que aparece assim que existe:
// logo, cores e fontes primeiro, depois negócio, jeito de falar e fatos. Tudo vem do estado puro de progress-view.ts: nenhuma frase aqui é inventada.
// Sem o fluxo (`mode="plain"`), mostra a espera de sempre.

import type { ReactNode } from 'react';
import { Spinner } from '@/components/auth/ui';
import { formatElapsed, formatStamp, type CardStatus, type ReadView } from '@/lib/site-read/progress-view';

// `stack`: uma coluna só, para caber no cartão "Ler minha marca" do perfil; o padrão usa duas colunas a partir da largura de tablet.
type Props = { view: ReadView; mode: 'stream' | 'plain'; reconnecting: boolean; site: string; stack?: boolean };

const TAG: Record<CardStatus, string> = { wait: 'Aguardando', load: 'Lendo', done: 'Pronto', warn: 'Com aviso' };
const TONE = { info: '', warn: 'text-warning', bad: 'text-danger' } as const;

const origin = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function Skeleton() {
  return (
    <div aria-hidden="true" className="space-y-1.5">
      <div className="h-2.5 w-4/5 animate-pulse rounded-full bg-inset motion-reduce:animate-none" />
      <div className="h-2.5 w-3/5 animate-pulse rounded-full bg-inset motion-reduce:animate-none" />
    </div>
  );
}

function ResultCard({ title, status, children, source, note, more }: { title: string; status: CardStatus; children?: ReactNode; source?: string; note?: string | null; more?: string }) {
  const waiting = status === 'wait';
  return (
    <div className={`rounded-lg border p-3.5 ${waiting ? 'border-dashed border-line text-muted' : status === 'warn' ? 'border-warning bg-raised' : 'border-line bg-raised'}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{title}</span>
        <span className={`inline-flex items-center gap-1.5 text-xs ${status === 'done' ? 'text-success' : status === 'warn' ? 'text-warning' : 'text-muted'}`}>
          {status === 'load' && <Spinner />}
          {status === 'done' && <span aria-hidden="true">✓</span>}
          {TAG[status]}
        </span>
      </div>
      {status === 'load' && <div className="mt-2.5"><Skeleton /></div>}
      {status === 'done' && <div className="mt-2 text-sm leading-relaxed">{children}</div>}
      {status === 'warn' && note && <p className="mt-2 text-sm text-warning">{note}</p>}
      {status !== 'wait' && status !== 'load' && source && <p className="mt-1.5 text-xs text-muted">{source}</p>}
      {more && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Spinner />{more}</p>}
    </div>
  );
}

export default function SiteReadProgress({ view, mode, reconnecting, site, stack }: Props) {
  if (mode === 'plain') {
    return (
      <div role="status" aria-live="polite" className="card flex max-w-xl items-start gap-3">
        <span className="mt-1"><Spinner /></span>
        <div>
          <p className="font-semibold">Lendo o site inteiro</p>
          <p className="mt-1 text-sm text-muted">Mostramos tudo de uma vez quando terminar. A conexão desta rede não deixa acompanhar etapa por etapa.</p>
        </div>
      </div>
    );
  }

  const { pages, now } = view;
  const done = view.phase === 'done';
  const pct = done ? 100 : pages.chosen > 0 ? Math.min(100, Math.round((pages.read / pages.chosen) * 100)) : 4;
  const u = view.result?.understanding ?? null;
  const facts = u?.facts ?? [];
  const about = u?.about;
  const meta = done ? `${pages.read} ${pages.read === 1 ? 'página lida' : 'páginas lidas'}` : pages.chosen > 0 ? `${pages.read} de ${pages.chosen} páginas lidas` : 'Abrindo o site…';
  // A frase de agora já está no alto do painel: o histórico começa na anterior.
  const current = !done && now && view.log[0]?.tone === 'info' && view.log[0].text.startsWith(now.label);
  const lines = (current ? view.log.slice(1) : view.log).slice(0, 6);

  return (
    <div className="space-y-4">
      {reconnecting && (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-info bg-raised p-3 text-sm">
          <span className="mt-0.5"><Spinner /></span>
          <p><strong>A conexão oscilou.</strong> Estamos lendo de novo. O que já chegou continua aqui.</p>
        </div>
      )}
      {view.skipped > 0 && (
        <div role="status" className="rounded-lg border border-warning bg-raised p-3 text-sm">
          <strong>{view.skipped === 1 ? '1 página ficou de fora.' : `${view.skipped} páginas ficaram de fora.`}</strong> A leitura segue com o resto. Você vê quais no histórico.
        </div>
      )}
      <div className={`grid items-start gap-5 ${stack ? '' : 'md:grid-cols-[5fr_6fr]'}`}>
        <section aria-label="O que a Ekoai está fazendo" className={`space-y-3 rounded-xl border p-4 ${stack ? '' : 'md:sticky md:top-4'} ${done ? 'border-success bg-raised' : 'border-line bg-raised'}`}>
          <div className="flex items-start gap-2.5" aria-live="polite">
            <span className="mt-1 shrink-0">{done ? <span aria-hidden="true" className="text-success">✓</span> : <Spinner />}</span>
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{done ? `Pronto: lemos ${site} em ${formatElapsed(view.doneMs ?? view.elapsedMs)}` : now?.label ?? `Abrindo ${site}`}</p>
              {!done && now?.path && <p className="mt-0.5 break-all text-xs text-muted">{now.path}</p>}
            </div>
          </div>
          <div role="progressbar" aria-label="Páginas lidas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-inset">
            <div className={`h-full rounded-full ${done ? 'bg-success' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between gap-2 text-xs text-muted">
            <span>{meta}</span>
            <span>{formatElapsed(done ? view.doneMs ?? view.elapsedMs : view.elapsedMs)}</span>
          </div>
          {lines.length > 0 && (
            <ol role="log" aria-label="O que a Ekoai já fez" className="space-y-1.5 border-t border-line pt-3">
              {lines.map((l, i) => (
                <li key={l.seq} className={`grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2 text-sm leading-snug ${TONE[l.tone] || (i === 0 && !done ? 'text-fg' : 'text-muted')}`}>
                  <span className="text-right text-xs tabular-nums text-muted">{formatStamp(l.t)}</span>
                  <span className="[overflow-wrap:anywhere]">{l.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="space-y-2.5" aria-live="polite">
          <ResultCard title="Logo" status={view.logo.status} note={view.logo.note} source={view.logo.logoUrl ? origin(view.logo.logoUrl) : undefined}>
            {view.logo.logoUrl && <>Logo achada em {origin(view.logo.logoUrl)}.</>}
          </ResultCard>
          <ResultCard title="Cores e fontes" status={view.colors.status} note={view.colors.note} source="folha de estilo do site">
            <div className="flex flex-wrap items-center gap-2">
              {view.colors.colors.map((hex) => (
                <span key={hex} className="inline-flex items-center gap-1.5 text-xs">
                  <span aria-hidden="true" className="h-5 w-5 rounded-full border border-line-strong" style={{ background: hex }} />
                  <span className="font-mono">{hex}</span>
                </span>
              ))}
            </div>
            {(view.colors.fonts.heading || view.colors.fonts.body) && <p className="mt-1.5">{[view.colors.fonts.heading, view.colors.fonts.body].filter((f, i, all) => f && all.indexOf(f) === i).join(' e ')}</p>}
          </ResultCard>
          <ResultCard title="Negócio" status={view.identity.status} note={view.identity.note} source={about?.offering ? 'texto do site' : 'página inicial'}>
            {view.identity.name && <strong>{view.identity.name}</strong>}
            {view.identity.name && view.identity.description ? ' · ' : ''}
            {view.identity.description}
            {about?.offering && <p className="mt-1.5">{about.offering}</p>}
          </ResultCard>
          <ResultCard title="Jeito de falar" status={view.voice.status} note={view.voice.note} source="textos do site e do Instagram">
            {u && (
              <>
                Tom e palavras da marca lidos. Você ajusta na próxima tela.
                {u.differentiators.length > 0 && <span className="mt-1.5 flex flex-wrap gap-1.5">{u.differentiators.slice(0, 3).map((d) => <span key={d} className="rounded-full bg-inset px-2.5 py-0.5 text-xs">{d}</span>)}</span>}
              </>
            )}
          </ResultCard>
          <ResultCard title="Fatos (rascunho)" status={view.facts.status} note={view.facts.note} source="páginas de onde saíram">
            {facts.length > 0 && (
              <ul className="space-y-1">
                {facts.slice(0, 5).map((f) => (
                  <li key={f.text} className="flex gap-1.5"><span aria-hidden="true" className="text-success">✓</span>{f.text}</li>
                ))}
              </ul>
            )}
          </ResultCard>
          {view.instagram && (
            <ResultCard title="Instagram" status={view.instagram.status} note={view.instagram.note} source="legendas da sua conta">
              {view.instagram.count > 0 ? `Lemos ${view.instagram.count} ${view.instagram.count === 1 ? 'legenda' : 'legendas'}.` : 'Sem legendas para ler.'}
            </ResultCard>
          )}
        </div>
      </div>
    </div>
  );
}

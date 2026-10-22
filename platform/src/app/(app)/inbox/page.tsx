import Link from 'next/link';
import { getPendings } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { groupIdeas, roleOf } from '@/lib/ideas-model';
import type { PendingApproval } from '@/lib/types';
import { can, pageTenant } from '@/lib/session';
import { pageError } from '@/lib/api';

export const dynamic = 'force-dynamic';

function DbHint({ message }: { message: string }) {
  return (
    <div className="card border-warning/30 bg-warning/10 text-sm text-warning">
      <p className="font-medium">Banco não acessível ainda</p>
      <p className="mt-1 text-warning">{message}</p>
      <p className="mt-2 text-warning">
        Aplique a migration <code>supabase/migrations/0002_platform_scheduling.sql</code> e confira{' '}
        <code>SUPABASE_URL</code> / <code>SUPABASE_SERVICE_KEY</code>.
      </p>
    </div>
  );
}

const KIND_LABEL = { informativo: 'Informativo', atmosfera: 'Atmosfera' } as const;

export default async function InboxPage() {
  const t = await pageTenant();
  const canCreate = await can('content.create');
  let pendings: PendingApproval[] = [];
  let err = '';
  try {
    pendings = await getPendings(t);
  } catch (e) {
    err = pageError(e, 'page/inbox');
  }

  // Redes da mesma rodada viram um cartão só (SPEC 003 R3); pendência avulsa abre a tela antiga.
  const ideas = groupIdeas(pendings);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Aprovar</h1>
          <p className="text-sm text-muted">Posts prontos para você revisar, ajustar e aprovar.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">
            {pendings.length} {pendings.length === 1 ? 'post' : 'posts'}
          </span>
          {canCreate && (
            <Link href="/create" className="btn-primary">
              Criar post
            </Link>
          )}
        </div>
      </div>

      {err && <DbHint message={err} />}

      {!err && pendings.length === 0 && (
        <div className="card space-y-3 py-8 text-center">
          <h2 className="text-lg font-semibold">Nada para aprovar</h2>
          <p className="mx-auto max-w-md text-sm text-muted">Os posts criados pela Ekoai chegam aqui para você revisar e aprovar.</p>
          {canCreate && (
            <Link href="/create" className="btn-primary">
              Criar o primeiro post
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {ideas.map((idea) => {
          const lead = idea.pendings[0];
          const top = lead.generation?.variations?.find((v) => v.id === lead.top_id) || lead.generation?.variations?.[0];
          const cover = idea.pendings.flatMap((p) => p.images || []).find((i) => i.url)?.url || null;
          const href = idea.briefId
            ? `/inbox/idea/${encodeURIComponent(idea.briefId)}`
            : `/inbox/${encodeURIComponent(lead.pending_id)}`;
          return (
            <Link key={idea.key} href={href} className="card flex gap-4 hover:border-line-strong">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-line text-muted">
                  s/ arte
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {lead.post_kind && <span className="chip">{KIND_LABEL[lead.post_kind]}</span>}
                  {lead.post_kind && <span className="chip">Retrato 4:5</span>}
                  {!lead.post_kind && idea.pendings.map((p) => (
                    <span key={p.pending_id} className="chip uppercase" title={roleOf(p)}>
                      {p.channel}
                      {roleOf(p) === 'reuse' ? ' (reaproveitado)' : ''}
                    </span>
                  ))}
                  {!lead.post_kind && lead.generation?.pillar && <span className="chip">{lead.generation.pillar}</span>}
                  {!lead.post_kind && lead.generation?.angle && <span className="chip">{lead.generation.angle}</span>}
                  {lead.generation?.guardrail_flags?.length ? <span className="chip border-warning/40 text-warning">Com aviso do revisor</span> : null}
                </div>
                <p className="mt-2 line-clamp-2 font-medium">{top?.hook || '(sem título)'}</p>
                {lead.post_kind && <p className="mt-1 line-clamp-2 text-sm text-muted">{top?.body}</p>}
                <p className="mt-1 text-xs text-muted">recebido {fmtDateTime(lead.saved_at)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

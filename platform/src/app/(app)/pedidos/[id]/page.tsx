import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CampaignTag } from '@/components/campaigns/Badge';
import Icon from '@/components/home/Icon';
import ConfirmRequest from '@/components/requests/ConfirmRequest';
import PhotoRequest from '@/components/requests/PhotoRequest';
import { pageError } from '@/lib/api';
import { ROUTES } from '@/lib/app-routes';
import { shortCampaignName } from '@/lib/campaign-view';
import { getCampaign } from '@/lib/campaigns';
import { listFacts } from '@/lib/company-facts';
import { addDays, todayLocal } from '@/lib/company-facts-model';
import { TAG_LABEL } from '@/lib/media-asset-model';
import { isRequestId, type MaterialRequest } from '@/lib/material-request-model';
import { getRequest } from '@/lib/material-requests';
import { requestView, type RequestPost } from '@/lib/material-request-view';
import { GOALS, isPostGoal } from '@/lib/post-goals';
import { can, pageTenant, requireSession } from '@/lib/session';
import { tzOffsetHours } from '@/lib/slots';

export const dynamic = 'force-dynamic';

const DONE: Record<string, { title: string; body: string }> = {
  photo: { title: 'Fotos recebidas', body: 'As fotos estão no banco de imagens com a etiqueta pedida. Quando podem entrar em post, a sugestão ligada já usa a primeira.' },
  kept: { title: 'Fato confirmado', body: 'O post segue com este fato. A Ekoai pergunta de novo quando estiver perto de vencer.' },
  edited: { title: 'Fato corrigido e confirmado', body: 'As próximas sugestões usam o texto novo. Post já aprovado com o texto antigo fica segurado até ser atualizado.' },
  off: { title: 'Fato desligado', body: 'As próximas sugestões não usam mais este fato. Post já aprovado que o usa fica segurado para você revisar.' },
  dismissed: { title: 'Tudo certo, sem foto desta vez', body: 'O post sai com o layout da marca. A Ekoai não pede a mesma coisa pelos próximos 14 dias.' },
  expired: { title: 'Este pedido venceu', body: 'O post saiu sem o material. Se tiver as fotos, mande pelo banco de imagens: a Ekoai usa nos próximos posts.' },
};

async function postOf(t: Awaited<ReturnType<typeof pageTenant>>, r: MaterialRequest): Promise<RequestPost | null> {
  if (!r.suggestionId) return null;
  const { data } = await t.select('content_suggestions', 'idea,goal,slot_at').eq('id', r.suggestionId).maybeSingle();
  if (!data || !isPostGoal(data.goal)) return null;
  return { idea: String(data.idea), goalLabel: GOALS[data.goal].label, slotAt: new Date(data.slot_at as string).toISOString() };
}

// Pedido de material (SPEC 036; protótipo v31): enviar fotos ou confirmar um fato, com o motivo e o post que ele destrava.
// Quem só acompanha não vê pedidos. Confirmar fato pede quem gerencia a marca; quem cria vê o pedido e quem pode responder.
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await pageTenant();
  const { id } = await params;
  if (!isRequestId(id)) notFound();
  const [create, brand] = await Promise.all([can('content.create'), can('brand.manage')]);
  const { user } = await requireSession();
  if (!create) notFound();
  const nowMs = Date.now();
  const tz = tzOffsetHours();

  let req: MaterialRequest | null;
  try {
    req = await getRequest(t, id);
  } catch (e) {
    return <div className="card border-danger/30 bg-danger/10 text-sm text-danger">{pageError(e, 'page/requests')}</div>;
  }
  if (!req) notFound();

  const [post, campaign, facts] = await Promise.all([
    postOf(t, req).catch(() => null),
    req.campaignId ? getCampaign(t, req.campaignId).catch(() => null) : Promise.resolve(null),
    req.kind === 'confirm' ? listFacts(t).catch(() => []) : Promise.resolve([]),
  ]);
  const view = requestView(req, { now: nowMs, tz, post, campaignName: campaign ? shortCampaignName(campaign.name) : null });
  const fact = req.factId ? facts.find((f) => f.id === req.factId) ?? null : null;
  const today = todayLocal(new Date(nowMs));
  const suggestedUntil = campaign?.endDate && campaign.endDate >= today ? campaign.endDate : addDays(today, 30);
  const done = !view.open ? DONE[req.outcome ?? (req.status === 'open' ? 'expired' : req.status)] ?? DONE.expired : null;

  return (
    <div className="max-w-2xl space-y-3">
      <Link href={ROUTES.home} className="link text-sm">
        ← Voltar para o Início
      </Link>
      <section className="card">
        {done ? (
          <div className="py-4 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-accent/15 text-accent-text">
              <Icon name={req.status === 'expired' || (req.status === 'open' && !view.open) ? 'clock' : 'check'} size={22} />
            </span>
            <h1 className="mt-3 text-xl font-semibold">{done.title}</h1>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{done.body}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href={ROUTES.home} className="btn-primary">
                Voltar para o Início
              </Link>
              {req.kind === 'photo' ? (
                <Link href={ROUTES.media} className="btn-ghost">
                  Abrir o banco de imagens
                </Link>
              ) : (
                <Link href={ROUTES.facts} className="btn-ghost">
                  Ver os fatos
                </Link>
              )}
            </div>
          </div>
        ) : (
          <>
            <span className="chip border-accent/30 bg-accent/15 text-accent-text">{req.kind === 'photo' ? 'Foto' : 'Confirmar'}</span>
            <h1 className="mt-2 text-xl font-semibold">{req.title}</h1>
            <p className="mt-1 text-sm text-muted">{req.reason}</p>
            {req.kind === 'confirm' && fact && (
              <div className="mt-3 rounded-lg border border-line bg-surface p-3">
                <span className="text-xs text-muted">Fato da empresa</span>
                <p className="text-sm font-semibold">&quot;{fact.text}&quot;</p>
                {fact.validUntil && <span className="text-xs text-muted">Vale até {fact.validUntil.slice(8, 10)}/{fact.validUntil.slice(5, 7)}</span>}
              </div>
            )}
            {(view.post || view.campaignName) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
                <div className="min-w-0 flex-1">
                  {view.post ? (
                    <>
                      <strong className="block">{view.post.idea}</strong>
                      <span className="text-muted">
                        {view.post.goalLabel} · {view.post.when}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">Post da campanha</span>
                  )}
                </div>
                {view.campaignName && <CampaignTag name={view.campaignName} />}
              </div>
            )}
            <p className="mt-3 inline-flex items-center gap-1 text-sm text-muted">
              <Icon name="clock" size={12} />
              {view.dueLabel}
            </p>
            {req.kind === 'photo' && user ? (
              <PhotoRequest id={req.id} tagLabel={req.needTag ? TAG_LABEL[req.needTag] : 'Foto'} postWhen={view.post?.when ?? null} />
            ) : req.kind === 'confirm' && fact && brand && user ? (
              <ConfirmRequest id={req.id} factText={fact.text} suggestedUntil={suggestedUntil} />
            ) : req.kind === 'photo' ? (
              <div role="status" className="mt-4 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
                <strong>Entre com a sua conta para responder.</strong> A resposta fica registrada com o nome de quem enviou as fotos.
              </div>
            ) : req.kind === 'confirm' && !fact ? (
              <div role="status" className="mt-4 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
                <strong>O fato deste pedido não está mais na lista.</strong> Nada a responder aqui. Os fatos ficam em Configurações.
              </div>
            ) : (
              <div role="status" className="mt-4 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
                <strong>Quem confirma fatos é quem gerencia a marca.</strong> Essa pessoa recebeu o aviso no app. Enquanto isso, a sugestão continua no Início.
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

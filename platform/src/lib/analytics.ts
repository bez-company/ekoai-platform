// analytics.ts: eventos de produto enviados pelo servidor ao PostHog (projeto da Ekoai), ADR 0017.
// Só liga com POSTHOG_KEY (Secret Manager); sem ela, ou em branco, tudo aqui é no-op, como no
// desenvolvimento, nos testes e no staging.
//
// O evento é da CONTA, não da pessoa: distinct_id = `tenant:<id>`. Nenhum e-mail, nome ou id de
// pessoa sai daqui; o navegador não recebe cookie nem script. Falha no envio nunca derruba a rota:
// vira aviso no log.

import { PostHog } from 'posthog-node';
import { log } from './log';

export type ProductEvent =
  | 'signed_in'
  | 'invitation_sent'
  | 'invitation_accepted'
  | 'onboarding_item_updated'
  | 'onboarding_answered'
  | 'idea_approved'
  | 'idea_rejected'
  | 'idea_rework_requested'
  | 'post_approved'
  | 'post_rejected'
  | 'post_archived'
  | 'published_success'
  | 'published_failure'
  | 'photo_post_created'
  | 'engagement_published'
  | 'instagram_connected'
  | 'instagram_disconnected'
  | 'instagram_reauth_required'
  | 'linkedin_connected'
  | 'linkedin_disconnected'
  | 'linkedin_publish_as_changed'
  | 'linkedin_reauth_required'
  | 'data_exported'
  | 'account_deleted'
  // Scorecard (BEZ-260): ativação, qualidade e custo do post.
  | 'account_created'
  | 'post_requested'
  | 'ideas_suggested'
  | 'plan_upgraded'
  | 'plan_agency_requested'
  | 'post_ready'
  | 'post_generation_failed'
  | 'suggestion_viewed'
  | 'suggestion_accepted'
  | 'suggestion_replaced'
  | 'suggestion_skipped'
  | 'rework'
  | 'cost_by_step'
  // Ajuste rápido do post (SPEC 019, BEZ-269): custo e tempo de corrigir um detalhe sem regenerar.
  | 'design_revision_saved'
  | 'design_revision_restored'
  | 'design_edit_discarded'
  | 'design_edit_wish'
  | 'design_ask'
  | 'design_format_switched'
  | 'studio_scene_saved'
  | 'design_rule_proposed'
  | 'design_rule_accepted'
  | 'design_rule_dismissed'
  | 'design_rule_disabled';

// `published_success` (channel, attempts, recorded, latency_ms) e `published_failure` (channel, attempts, reason:
// classe do erro, nunca a mensagem) saem de publish.ts desde o BEZ-258. Substituem `post_published` e
// `post_publish_failed`, que nunca chegaram ao PostHog (a chave só entrou no staging em 23/10/2026).

type Props = Record<string, string | number | boolean | null | undefined>;

// Última barreira contra dado pessoal: texto que parece e-mail, token ou post sai do evento, mesmo que
// algum chamador mande por engano. Número e booleano passam; só string é filtrada.
const FORBIDDEN_KEY = /e-?mail|token|secret|password|senha|caption|legenda|text|idea|ideia|name|nome|body|hashtag|phone|telefone|cpf|cnpj/i;
const MAX_STRING = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // id de pedido não é segredo
const LOOKS_LIKE_SECRET = /[A-Za-z0-9_-]{32,}/;

export function sanitizeProps(props: Props): { safe: Props; dropped: string[] } {
  const safe: Props = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' && (FORBIDDEN_KEY.test(key) || value.length > MAX_STRING || value.includes('@') || (!UUID.test(value) && LOOKS_LIKE_SECRET.test(value)))) {
      dropped.push(key);
      continue;
    }
    safe[key] = value;
  }
  return { safe, dropped };
}

export function analyticsEnabled(): boolean {
  return posthog() !== null;
}

let client: PostHog | null | undefined;

function posthog(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.POSTHOG_KEY?.trim();
  client = key
    ? new PostHog(key, {
        host: 'https://us.i.posthog.com',
        flushAt: 1,
        flushInterval: 0,
        // Sem nova tentativa: perder um evento é aceitável, segurar a aprovação de um post não é.
        requestTimeout: 2000,
        fetchRetryCount: 0,
        disableGeoip: true,
      })
    : null;
  return client;
}

// Espera o envio (até 2 s) dentro da própria requisição: no Cloud Run a CPU some quando a resposta
// sai, então mandar "depois" poderia nunca chegar.
export async function track(tenantId: string, event: ProductEvent, props: Props = {}): Promise<void> {
  const ph = posthog();
  if (!ph) return;
  const { safe, dropped } = sanitizeProps(props);
  if (dropped.length) log('warn', 'analytics', 'propriedade removida do evento', { event, keys: dropped.join(',') });
  try {
    await ph.captureImmediate({
      distinctId: `tenant:${tenantId}`,
      event,
      properties: {
        ...safe,
        tenant_id: tenantId,
        environment: process.env.SENTRY_ENVIRONMENT || 'local',
        $process_person_profile: true,
      },
    });
  } catch (e) {
    log('warn', 'analytics', 'evento não enviado', { event, reason: e instanceof Error ? e.message : String(e) });
  }
}

// Só para os testes: volta ao estado de antes de ler POSTHOG_KEY.
export function resetAnalyticsForTests(): void {
  client = undefined;
}

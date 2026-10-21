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
  | 'idea_approved'
  | 'idea_rejected'
  | 'idea_rework_requested'
  | 'post_approved'
  | 'post_rejected'
  | 'post_published'
  | 'post_publish_failed'
  | 'engagement_published'
  | 'data_exported'
  | 'account_deleted';

type Props = Record<string, string | number | boolean | null | undefined>;

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
  try {
    await ph.captureImmediate({
      distinctId: `tenant:${tenantId}`,
      event,
      properties: {
        ...props,
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

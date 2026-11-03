// run.ts: uma leitura da marca de ponta a ponta para uma conta (SPEC 033, 034). Junta o que as duas rotas (a de resposta única e a do fluxo em
// tempo real) fazem igual: a leitura do Instagram conectado ao mesmo tempo que a do site, a chamada ao modelo e o registro de quanto cada
// passo levou (BEZ-532). Server-only.

import type { TenantDb } from '../tenant-db';
import { log } from '../log';
import { vertexClient } from '../vertex';
import { readInstagramPosts, type InstagramPosts } from './instagram';
import { fanOut, noProbe, stepTimer, type Probe, type TimingSummary } from './progress-model';
import { understandSite, type Understood } from './understand';

const INSTAGRAM_FAILED: Record<'expired' | 'failed', string> = {
  expired: 'A conexão com o Instagram venceu. A leitura segue só com o site; reconecte em Configurações > Canais.',
  failed: 'Não deu para ler o Instagram agora. A leitura segue só com o site.',
};

export type SiteReadRun = { result: Understood; timing: TimingSummary };

export async function runSiteRead(t: TenantDb, site: string, probe: Probe = noProbe): Promise<SiteReadRun> {
  const timer = stepTimer();
  const emit = fanOut(timer.probe, probe);
  // As legendas do Instagram que a conta conectou entram na leitura (mais precisão); sem conexão, a leitura segue só com o site e nada
  // aparece na tela sobre o Instagram. Rodam ao mesmo tempo que o site: o modelo só espera as duas.
  const instagram: Promise<InstagramPosts> = readInstagramPosts(t, { onReading: () => emit({ type: 'started', kind: 'instagram', label: 'Lendo as legendas do Instagram' }) })
    .then((ig) => {
      if (ig.state === 'ok') emit({ type: 'result', kind: 'instagram', state: ig.state, count: ig.pages.length });
      else if (ig.state === 'expired' || ig.state === 'failed') emit({ type: 'failed', kind: 'instagram', message: INSTAGRAM_FAILED[ig.state] });
      return ig;
    })
    .catch(() => ({ state: 'failed' as const, pages: [] }));
  try {
    const result = await understandSite(site, { model: vertexClient(), tenantId: t.tenantId, instagram, probe: emit });
    return { result, timing: timer.summary() };
  } finally {
    // Quanto cada passo levou: é com isso que se escolhem os limites da leitura do site inteiro. Também quando a leitura falha.
    log('info', 'site-read', 'tempo por etapa', { ...timer.summary() });
  }
}

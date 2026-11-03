import { requirePermission } from '@/lib/session';
import { apiError, badRequest } from '@/lib/api';
import { UserError, userMessage } from '@/lib/errors';
import { getProfile } from '@/lib/company-profile';
import { logError } from '@/lib/log';
import { RULES } from '@/lib/rate-limit-model';
import { hit, tooMany } from '@/lib/rate-limit';
import { HEARTBEAT, encodeEvent, eventSequencer } from '@/lib/site-read/events';
import { runSiteRead } from '@/lib/site-read/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BEAT_MS = 10_000;

// Ler a marca do site em tempo real (SPEC 034, ADR 0031): a mesma leitura de /site-read, mas devolvida como fluxo de eventos
// (`text/event-stream`), um por passo, para a tela mostrar o que está sendo lido agora e cada resultado assim que existe. Mesma permissão e mesmo teto
// por hora da leitura de resposta única; o que dá errado ANTES de o fluxo abrir (sessão, teto, endereço) volta como JSON, como nas outras rotas. Depois
// de aberto, a falha vira o evento `read.failed`. Nada é gravado: a pessoa confirma por /apply. Sem reenvio: se a conexão cai, a tela lê de novo.
export async function POST(req: Request) {
  try {
    const t = await requirePermission('brand.manage');
    const limited = await hit(RULES.siteRead, t.tenantId);
    if (!limited.allowed) return tooMany(limited, 'api/profile/site-read/stream', RULES.siteRead.bucket);
    const body = (await req.json().catch(() => null)) as { site_url?: unknown } | null;
    const typed = typeof body?.site_url === 'string' ? body.site_url.trim() : '';
    const site = typed || (await getProfile(t))?.siteUrl || '';
    if (!site) return badRequest('Informe o site da empresa para a Ekoai ler.');

    const enc = new TextEncoder();
    const events = eventSequencer();
    let open = true;
    let beat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (chunk: string) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            open = false;
          }
        };
        req.signal.addEventListener('abort', () => {
          open = false;
        });
        beat = setInterval(() => write(HEARTBEAT), BEAT_MS);
        write(encodeEvent(events.started(site)));
        try {
          const run = await runSiteRead(t, site, (e) => write(encodeEvent(events.step(e))));
          write(encodeEvent(events.done(run.result, run.timing)));
        } catch (e) {
          if (!(e instanceof UserError)) logError('api/profile/site-read/stream', e);
          write(encodeEvent(events.failed(userMessage(e))));
        } finally {
          clearInterval(beat);
          open = false;
          try {
            controller.close();
          } catch {
            // a conexão já tinha caído
          }
        }
      },
      cancel() {
        open = false;
        clearInterval(beat);
      },
    });
    // `no-transform` e `X-Accel-Buffering` pedem a quem está no caminho (Firebase Hosting, proxy) que não segure o fluxo.
    return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive' } });
  } catch (e) {
    return apiError(e, 'api/profile/site-read/stream');
  }
}

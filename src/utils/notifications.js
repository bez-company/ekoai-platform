// notifications.js: avisos da conta (SPEC 007), gravados em `notifications` e lidos pela
// plataforma. Substitui o Telegram. Best-effort: falha ao gravar vai para o log e nunca derruba
// o job. Sem banco (STATE_BACKEND=yaml) ou em DRY_RUN, o aviso só sai no log.

import { usingDb, getDb } from './db.js';
import { currentTenantId } from '../tenant.js';

const LEVELS = new Set(['info', 'warning', 'error']);
const AUDIENCES = new Set(['admin', 'team', 'all']);
const TITLE_MAX = 200;
const CHANNEL_NAMES = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

export function channelName(channel) {
  return CHANNEL_NAMES[channel] ?? channel;
}

// Aviso malformado é erro de código, não de runtime: falha alto no teste.
export function buildNotice({ kind, level = 'info', title, body = null, link = null, audience }) {
  if (!kind || !title) throw new Error('aviso precisa de kind e title');
  if (!LEVELS.has(level)) throw new Error(`nível de aviso inválido: ${level}`);
  if (link && !link.startsWith('/')) throw new Error(`link de aviso precisa ser um caminho da plataforma: ${link}`);
  if (audience !== undefined && !AUDIENCES.has(audience)) throw new Error(`público de aviso inválido: ${audience}`);
  // `audience` só entra quando informado: sem ele vale o padrão do banco (admin).
  return { kind, level, title: String(title).slice(0, TITLE_MAX), body: body ?? null, link, ...(audience ? { audience } : {}) };
}

export async function notify(notice, { dryRun = false, tenantId } = {}) {
  const row = buildNotice(notice);
  if (dryRun || !usingDb()) {
    console.log(`[aviso] ${row.level} ${row.kind}: ${row.title}`);
    return { stored: false };
  }
  // Fora do try: conta não definida é erro de configuração, não falha de gravação a engolir.
  const tenant = tenantId ?? currentTenantId();
  try {
    const { error } = await getDb().from('notifications').insert({ ...row, tenant_id: tenant });
    if (error) throw new Error(error.message);
    return { stored: true };
  } catch (e) {
    console.error(`[aviso] não gravado (${row.kind}): ${e.message}`);
    return { stored: false, error: e.message };
  }
}

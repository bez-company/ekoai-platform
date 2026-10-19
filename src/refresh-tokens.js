// refresh-tokens.js — renova tokens IG + LinkedIn antes do vencimento.
// Chamado pelos jobs `refresh-tokens` (mensal) e `token-health` (diário, alerta); src/jobs.js.

import 'dotenv/config';
import * as instagram from './channels/instagram.js';
import * as linkedin from './channels/linkedin.js';
import { notify } from './utils/notifications.js';
import { updateSecret, canUpdateSecrets } from './utils/secret-store.js';
import { assertStateBackend } from './utils/db.js';

const MODE = process.argv[2] || 'refresh'; // refresh | check

async function main() {
  assertStateBackend();
  const results = {};

  results.instagram = await runStep('Instagram', async () => {
    if (MODE === 'check') return instagram.checkTokenHealth();
    return instagram.refreshToken();
  });

  results.linkedin = await runStep('LinkedIn', async () => {
    if (MODE === 'check') return linkedin.checkTokenHealth();
    return linkedin.refreshToken();
  });

  // Fecha o loop: grava os tokens novos como versão nova no Secret Manager.
  let persistNote = '';
  if (MODE === 'refresh') {
    persistNote = await persistTokens(results);
  }

  const summary = formatSummary(results) + (persistNote ? `\n\n${persistNote}` : '');
  console.log(summary);

  const needsAlert = MODE === 'check' && hasUrgency(results);
  const failed = Object.values(results).some(r => r.error);

  // Em refresh, sempre avisa (rotação mensal, baixo ruído, confirma que rodou).
  if (needsAlert || failed || MODE === 'refresh') {
    await notify({
      kind: 'tokens.health',
      level: failed ? 'error' : needsAlert ? 'warning' : 'info',
      title: tokenTitle({ failed, needsAlert }),
      body: summary,
      link: '/settings',
    });
  }

  if (failed) process.exit(1);
}

// Atualiza os segredos com os tokens renovados. Fora do Cloud Run (sem GOOGLE_CLOUD_PROJECT),
// degrada com aviso (você atualiza à mão) em vez de quebrar.
async function persistTokens(results) {
  const updates = [];
  const ig = results.instagram;
  if (ig?.ok && ig.access_token) updates.push(['IG_ACCESS_TOKEN', ig.access_token]);
  const li = results.linkedin;
  if (li?.ok && li.access_token) updates.push(['LINKEDIN_ACCESS_TOKEN', li.access_token]);
  if (li?.ok && li.refresh_token) updates.push(['LINKEDIN_REFRESH_TOKEN', li.refresh_token]);

  if (updates.length === 0) return '';
  if (!canUpdateSecrets()) {
    return `${updates.length} token(s) renovado(s), mas o Secret Manager não está configurado (GOOGLE_CLOUD_PROJECT): atualize os segredos à mão (${updates.map(u => u[0]).join(', ')}).`;
  }

  const done = [];
  for (const [name, value] of updates) {
    try {
      await updateSecret(name, value);
      done.push(name);
    } catch (e) {
      console.error(`[refresh-tokens] falha ao atualizar ${name}: ${e.message}`);
      return `Segredos atualizados: ${done.join(', ') || 'nenhum'}. Falhou ${name}: ${e.message}`;
    }
  }
  return `Segredos atualizados automaticamente: ${done.join(', ')}.`;
}

function tokenTitle({ failed, needsAlert }) {
  if (MODE === 'check') return failed ? 'Falha ao checar os tokens das redes' : 'Token de rede perto de vencer: reconecte';
  return failed ? 'Falha ao renovar os tokens das redes' : 'Tokens das redes renovados';
}

async function runStep(name, fn) {
  try {
    const out = await fn();
    return { name, ok: true, ...out };
  } catch (e) {
    return { name, ok: false, error: e.message };
  }
}

function hasUrgency(results) {
  return Object.values(results).some(r => {
    if (typeof r.daysLeft === 'number' && r.daysLeft <= 10) return true;
    if (r.valid === false) return true;
    return false;
  });
}

function formatSummary(results) {
  const lines = [`Tokens (${MODE}) em ${new Date().toISOString().slice(0, 10)}`];
  for (const r of Object.values(results)) {
    if (r.error) {
      lines.push(`${r.name}: falhou (${r.error})`);
    } else {
      const days = r.daysLeft != null ? ` (${r.daysLeft} dias restantes)` : '';
      lines.push(`${r.name}: ok${days}`);
    }
  }
  return lines.join('\n');
}

main().catch(err => {
  console.error('[refresh-tokens] ERRO:', err);
  process.exit(1);
});

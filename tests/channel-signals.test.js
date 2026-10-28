import { describe, it, expect } from 'vitest';
import { CHANNEL_SIGNALS, MAX_AGE_DAYS, signalAgeDays, signalPromptLines, staleChannels } from '../platform/src/lib/channel-signals.ts';
import { GOALS, POST_GOALS, SIGNALS, asksToShare, isSignal } from '../platform/src/lib/post-goals.ts';
import { buildCopyPrompt, cleanShareReason, parseCopy, signalOfGoal } from '../platform/src/lib/agents.ts';
import { profileFromRow } from '../platform/src/lib/company-profile-model.ts';
import { CHANNELS } from '../platform/src/lib/types.ts';

const DAY = 86_400_000;
const profile = profileFromRow({ niche: 'Alimentação', offering: 'Bolos', audience: 'Famílias', voice_formal: 3, voice_technical: 3, voice_serious: 3, banned_words: [], differentiators: [], pains: [] });
const input = { idea: 'sinais de que o bolo está pronto', kind: 'informativo', profile, facts: [], never: [], rules: [] };
const REASON = 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno';
const raw = (over = {}) => ({ kind: 'informativo', angle: 'dica', texts: { title: 'Seu bolo está pronto?' }, caption: 'Legenda', hashtags: ['bolo'], signal: 'salvar', share_reason: REASON, ...over });

describe('perfil de sinais por rede (SPEC 028, BEZ-414)', () => {
  it('toda rede do sistema tem perfil completo, com data e fonte', () => {
    for (const channel of CHANNELS) {
      const s = CHANNEL_SIGNALS[channel];
      expect(s, channel).toBeTruthy();
      expect(s.measures.length, channel).toBeGreaterThan(0);
      expect(s.content_must.length, channel).toBeGreaterThan(0);
      expect(s.avoid.length, channel).toBeGreaterThan(0);
      expect(s.sources.length, channel).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(s.confidence);
      expect(Number.isFinite(Date.parse(s.reviewed_at)), channel).toBe(true);
    }
  });

  it('nenhuma rede passa do prazo de revisão: o algoritmo muda e o perfil precisa ser revisado', () => {
    expect(staleChannels(), `Revise channel-signals.json (reviewed_at passou de ${MAX_AGE_DAYS} dias): ${staleChannels().join(', ')}`).toEqual([]);
  });

  it('a conta de dias e o prazo funcionam', () => {
    const at = Date.parse(CHANNEL_SIGNALS.instagram.reviewed_at);
    expect(signalAgeDays('instagram', at + 10 * DAY)).toBe(10);
    expect(staleChannels(at + (MAX_AGE_DAYS + 1) * DAY)).toContain('instagram');
    expect(staleChannels(at + MAX_AGE_DAYS * DAY)).not.toContain('instagram');
    expect(signalAgeDays('rede-que-nao-existe')).toBeNaN();
    expect(staleChannels()).not.toContain('rede-que-nao-existe');
  });

  it('as linhas do prompt trazem o que a rede mede e o que o post faz; rede desconhecida não traz nada', () => {
    const lines = signalPromptLines('instagram').join('\n');
    expect(lines).toContain('## O que o Instagram pesa');
    expect(lines).toContain('envio do post a alguém');
    expect(lines).toContain('O post serve a isso quando:');
    expect(lines).toContain('Evite:');
    expect(signalPromptLines('tiktok')).toEqual([]);
  });

  it('nada do perfil usa travessão', () => {
    expect(JSON.stringify(CHANNEL_SIGNALS)).not.toMatch(/[–—]/);
  });
});

describe('sinal do post (SPEC 028, BEZ-415)', () => {
  it('todo objetivo tem sinal válido, e só o auto deixa o estrategista escolher', () => {
    for (const goal of POST_GOALS) {
      const s = GOALS[goal].signal;
      if (goal === 'auto') expect(s).toBeNull();
      else expect(isSignal(s), goal).toBe(true);
    }
    expect(signalOfGoal('ensinar')).toBe('salvar');
    expect(signalOfGoal('conversa')).toBe('responder');
    expect(signalOfGoal('auto')).toBeNull();
    expect(signalOfGoal(null)).toBeNull();
    expect(signalOfGoal('qualquer coisa')).toBeNull();
    expect(SIGNALS).toHaveLength(4);
  });

  it('só enviar e salvar pedem a chamada na legenda', () => {
    expect(asksToShare('salvar')).toBe(true);
    expect(asksToShare('enviar')).toBe(true);
    expect(asksToShare('responder')).toBe(false);
    expect(asksToShare('assistir')).toBe(false);
    expect(asksToShare(null)).toBe(false);
  });

  it('o prompt traz os sinais do Instagram e os campos novos da resposta', () => {
    const p = buildCopyPrompt(input);
    expect(p).toContain('## O que o Instagram pesa');
    expect(p).toContain('- signal:');
    expect(p).toContain('- share_reason:');
    expect(p).toContain('"signal":"enviar|salvar|responder|assistir","share_reason":"..."');
    expect(buildCopyPrompt({ ...input, format: 'carousel' })).toContain('"signal":"enviar|salvar|responder|assistir","share_reason":"..."');
  });

  it('a chamada de salvar ou enviar só aparece nos objetivos que pedem', () => {
    const salvar = buildCopyPrompt({ ...input, signal: 'salvar' });
    expect(salvar).toContain('Para este objetivo, use "salvar"');
    expect(salvar).toContain('Chamada de salvar');
    const enviar = buildCopyPrompt({ ...input, signal: 'enviar' });
    expect(enviar).toContain('Chamada de enviar');
    for (const signal of ['responder', 'assistir']) {
      const p = buildCopyPrompt({ ...input, signal });
      expect(p).toContain('Não peça para salvar nem enviar o post');
      expect(p).not.toContain('Chamada de salvar');
      expect(p).not.toContain('Chamada de enviar');
    }
    const auto = buildCopyPrompt(input);
    expect(auto).toContain('Escolha o que combina com o post');
    expect(auto).toContain('Só peça para salvar ou enviar quando o post serve a isso');
    expect(auto).not.toContain('Chamada de salvar');
  });

  it('o parser guarda o sinal e a razão, e o objetivo manda no sinal', () => {
    const r = parseCopy(raw({ signal: 'assistir' }), null);
    expect(r.ok).toBe(true);
    expect(r.value.signal).toBe('assistir');
    expect(r.value.shareReason).toBe(REASON);
    expect(parseCopy(raw({ signal: 'assistir' }), null, 'single', null, 'enviar').value.signal).toBe('enviar');
    expect(parseCopy(raw({ signal: undefined }), null, 'single', null, 'salvar').value.signal).toBe('salvar');
  });

  it('sem sinal válido e sem objetivo, a resposta volta ao modelo com o motivo', () => {
    for (const signal of [undefined, 'curtir', '', 3]) {
      const r = parseCopy(raw({ signal }), null);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('signal');
    }
  });

  it('razão ausente, curta demais ou que não é texto volta ao modelo', () => {
    for (const share_reason of [undefined, '', 'para compartilhar', '   ', 42, null]) {
      const r = parseCopy(raw({ share_reason }), null);
      expect(r.ok, String(share_reason)).toBe(false);
      expect(r.error).toContain('share_reason');
    }
  });

  it('a razão sai limpa: sem travessão, em uma linha, cortada no teto', () => {
    expect(cleanShareReason('Quem organiza a festa — manda para o grupo\ndo bolo')).toBe('Quem organiza a festa, manda para o grupo do bolo');
    const long = cleanShareReason('palavra '.repeat(80));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(cleanShareReason('três palavras só')).toBeNull();
  });
});

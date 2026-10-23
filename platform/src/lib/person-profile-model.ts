// person-profile-model.ts: o que a tela "Seu perfil" aceita e mostra (BEZ-304). Puro, sem I/O: o
// parser valida o corpo na entrada da rota e o estado da verificação em duas etapas vira texto e
// botão sem a tela decidir regra.

export const NAME_MAX = 80;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Nome de exibição: texto curto e limpo, sem quebra de linha nem caractere de controle.
export function parsePersonName(body: unknown): Parsed<{ name: string }> {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).name : undefined;
  if (typeof raw !== 'string') return { ok: false, error: 'Digite o seu nome.' };
  const name = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Digite o seu nome.' };
  if (name.length > NAME_MAX) return { ok: false, error: `Use até ${NAME_MAX} caracteres no nome.` };
  return { ok: true, value: { name } };
}

// `unknown`: o provedor de login não respondeu; a tela não finge saber.
export type MfaState = 'on' | 'off' | 'unknown';

export type MfaView = {
  state: MfaState;
  description: string;
  // Ligar só existe quando está desligada; desligar quando ligada e a regra do ambiente deixa.
  action: 'enable' | 'disable' | null;
  actionLabel: string | null;
};

// `required`: a pessoa é administradora de alguma conta e o ambiente exige o segundo fator no login
// (login-policy.ts). Nesse caso desligar trancaria a própria pessoa fora.
export function mfaView(state: MfaState, required: boolean): MfaView {
  if (state === 'unknown') {
    return { state, description: 'Não deu para ler o estado agora. Recarregue a página em instantes.', action: null, actionLabel: null };
  }
  if (state === 'off') {
    return {
      state,
      description: required
        ? 'Desligada. Administradores precisam dela para entrar: ative agora para não perder o acesso.'
        : 'Desligada. Recomendamos ligar: protege a conta mesmo se a senha vazar.',
      action: 'enable',
      actionLabel: 'Ativar verificação',
    };
  }
  if (required) {
    return { state, description: 'Ligada com app autenticador. Administradores entram sempre com ela, então não dá para desligar.', action: null, actionLabel: null };
  }
  return { state, description: 'Ligada com app autenticador. Opcional: dá para desligar.', action: 'disable', actionLabel: 'Desligar verificação' };
}

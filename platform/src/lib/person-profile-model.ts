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

// Celular de contato: aceita "(11) 91234-5678", "11912345678" ou "+55 11 91234-5678" e guarda em E.164
// (+5511912345678). Só celular brasileiro: DDD de dois dígitos e o 9 na frente. Vazio vira null.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const national = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  return /^[1-9][1-9]9\d{8}$/.test(national) ? `+55${national}` : null;
}

// Máscara de digitação: "11912345678" vira "(11) 91234-5678" enquanto a pessoa escreve. Tira o +55 do começo e corta em 11 dígitos.
export function maskPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const PHONE_ERROR = 'Digite o celular com DDD, como (11) 91234-5678.';

// "+5511912345678" para "(11) 91234-5678".
export function formatPhone(e164: string | null | undefined): string {
  const m = /^\+55(\d{2})(\d{5})(\d{4})$/.exec(e164 ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : '';
}

// Campo opcional de um corpo de rota: ausente ou vazio vale null; preenchido e inválido é erro.
export function parseOptionalPhone(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: PHONE_ERROR };
  if (!raw.trim()) return { ok: true, value: null };
  const phone = normalizePhone(raw);
  return phone ? { ok: true, value: phone } : { ok: false, error: PHONE_ERROR };
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

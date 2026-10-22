'use client';

// WakeScreen.tsx: a tela "Ligar o ambiente" do staging sob demanda (SPEC 016). Aparece no lugar do
// app quando o banco está dormindo. Pergunta o estado a cada 10 segundos enquanto o banco liga e
// abre o app sozinho quando ele responde. Protótipo aprovado: BEZ-160.

import { useCallback, useEffect, useRef, useState } from 'react';
import Logo from '@/components/Logo';
import { Spinner } from '@/components/auth/ui';
import type { EnvStatus } from '@/lib/env-power';

const POLL_MS = 10_000;
const REDIRECT_S = 3;

function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

type ViewProps = {
  status: EnvStatus | null;
  elapsedS: number | null;
  busy: boolean;
  redirectIn: number;
  onWake: () => void;
  onCheck: () => void;
  onEnter: () => void;
};

// A parte visual, sem estado nem rede: dá para renderizar cada estado direto, em teste e em captura de tela.
export function WakeView({ status, elapsedS, busy, redirectIn, onWake, onCheck, onEnter }: ViewProps) {
  const state = status?.state ?? 'checking';
  const estimateS = status?.estimateS ?? 900;
  const percent = elapsedS === null ? 8 : Math.min(95, Math.round((elapsedS / estimateS) * 100));
  const late = elapsedS !== null && elapsedS > estimateS;

  return (
    <main className="grid min-h-screen place-items-center bg-page px-4 py-10 text-fg">
      <div className="card w-full max-w-md space-y-4 p-7">
        <div className="flex items-center gap-3">
          <Logo className="text-xl" />
          <span className="chip">Staging</span>
        </div>

        {state === 'checking' && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Verificando o ambiente
          </div>
        )}

        {state === 'sleeping' && (
          <>
            <h1 className="text-[22px] font-semibold leading-tight">O ambiente de teste está desligado</h1>
            <p className="text-sm leading-relaxed text-muted">O banco do staging dorme quando ninguém usa, para não gastar. Ligar leva cerca de {minutes(estimateS)} minutos.</p>
            <button type="button" className="btn-primary w-full sm:w-auto" onClick={onWake} disabled={busy}>
              {busy ? 'Enviando o pedido…' : 'Ligar o ambiente'}
            </button>
            <p className="text-xs text-muted">Ligar não apaga nenhum dado.</p>
          </>
        )}

        {state === 'starting' && (
          <>
            <h1 className="text-[22px] font-semibold leading-tight">Ligando o ambiente</h1>
            <p className="text-sm leading-relaxed text-muted">Deixe esta aba aberta: o app abre sozinho quando terminar. Se fechar, é só voltar depois.</p>
            <div>
              <div className="h-2 overflow-hidden rounded-full border border-line bg-inset" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Progresso estimado">
                <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs tabular-nums text-muted">
                <span>{elapsedS === null ? 'Pedido recebido' : `Passaram ${minutes(elapsedS)} min`}</span>
                <span>{late ? 'Está demorando mais que o normal' : elapsedS === null ? `Cerca de ${minutes(estimateS)} min` : `Faltam cerca de ${minutes(estimateS - elapsedS)} min`}</span>
              </div>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full border border-success bg-success/10 text-xs text-success">
                  ✓
                </span>
                Pedido enviado ao Google Cloud
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full border border-accent-text text-accent-text">
                  <Spinner />
                </span>
                Banco de dados ligando
              </li>
              <li className="flex items-center gap-2 text-muted">
                <span aria-hidden="true" className="h-5 w-5 rounded-full border border-line" />
                Plataforma conferindo a conexão
              </li>
            </ul>
            <button type="button" className="btn-ghost" onClick={onCheck} disabled={busy}>
              {busy ? 'Verificando…' : 'Verificar agora'}
            </button>
          </>
        )}

        {state === 'ready' && (
          <>
            <h1 className="text-[22px] font-semibold leading-tight">Ambiente no ar</h1>
            <p role="status" className="text-sm leading-relaxed text-muted">
              Abrindo o app em {redirectIn} s.
            </p>
            <button type="button" className="btn-primary" onClick={onEnter}>
              Entrar agora
            </button>
            <p className="text-xs text-muted">Ele desliga sozinho depois de 1 hora sem uso.</p>
          </>
        )}

        {state === 'error' && (
          <>
            <h1 className="text-[22px] font-semibold leading-tight">Não deu para ligar o ambiente</h1>
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
              {status?.message ?? 'Algo deu errado.'}
            </p>
            <p className="text-sm leading-relaxed text-muted">Tente de novo. Se repetir, veja o estado do banco no Cloud SQL do projeto de staging.</p>
            <button type="button" className="btn-primary" onClick={onWake} disabled={busy}>
              {busy ? 'Enviando o pedido…' : 'Tentar de novo'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export default function WakeScreen() {
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [redirectIn, setRedirectIn] = useState(REDIRECT_S);
  const enteredRef = useRef(false);

  const apply = useCallback((next: EnvStatus) => {
    setStatus(next);
    setReceivedAt(Date.now());
  }, []);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/ambiente', { cache: 'no-store' });
      if (res.ok) apply(await res.json());
    } catch {
      // Sem rede por um instante: a próxima volta tenta de novo.
    }
  }, [apply]);

  const wake = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/ambiente/ligar', { method: 'POST' });
      const next = (await res.json().catch(() => null)) as EnvStatus | null;
      if (next?.state) apply(next);
    } finally {
      setBusy(false);
    }
  }, [apply]);

  const enter = useCallback(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    window.location.reload();
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const state = status?.state;
  useEffect(() => {
    if (state !== 'starting') return;
    const poll = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(poll);
  }, [state, check]);

  useEffect(() => {
    if (state !== 'starting') return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [state]);

  useEffect(() => {
    if (state !== 'ready') return;
    setRedirectIn(REDIRECT_S);
    const countdown = setInterval(() => {
      setRedirectIn((n) => {
        if (n <= 1) {
          clearInterval(countdown);
          enter();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(countdown);
  }, [state, enter]);

  // O tempo corrido: o que o servidor mediu mais os segundos desde que a resposta chegou.
  const elapsedS = status?.elapsedS == null ? null : status.elapsedS + Math.max(0, Math.floor((now - receivedAt) / 1000));

  return <WakeView status={status} elapsedS={elapsedS} busy={busy} redirectIn={redirectIn} onWake={() => void wake()} onCheck={() => void check()} onEnter={enter} />;
}

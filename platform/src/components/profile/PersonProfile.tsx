'use client';

// PersonProfile.tsx: a tela "Seu perfil" (BEZ-304). É da pessoa, vale para todas as contas dela:
// nome, atalho para avisos, verificação em duas etapas e "sair de todos os dispositivos".

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import Modal from '../Modal';
import { ErrorLine, Field, Spinner } from '../auth/ui';
import MfaCard from './MfaCard';
import NotificationPrefs from './NotificationPrefs';
import { firebaseAuth, type FirebaseWebConfig } from '@/lib/firebase-client';
import { NAME_MAX, PHONE_ERROR, formatPhone, normalizePhone, type MfaState } from '@/lib/person-profile-model';
import type { CategoryPref } from '@/lib/notification-prefs-model';

type Props = {
  name: string;
  email: string;
  phone: string | null;
  prefs: CategoryPref[];
  mailReady: boolean;
  mfa: { state: MfaState; required: boolean };
  config: FirebaseWebConfig;
};

export default function PersonProfile({ name, email, phone, prefs, mailReady, mfa, config }: Props) {
  const router = useRouter();
  const auth = useMemo(() => firebaseAuth(config), [config]);
  const [draft, setDraft] = useState(name);
  const [phoneDraft, setPhoneDraft] = useState(formatPhone(phone));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nameError, setNameError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  const phoneFilled = phoneDraft.trim() !== '';
  const phoneOk = !phoneFilled || normalizePhone(phoneDraft) !== null;
  const dirty = draft.trim() !== name.trim() || (phoneFilled ? normalizePhone(phoneDraft) : null) !== phone;

  async function saveName() {
    setSaving(true);
    setSaved(false);
    setNameError('');
    try {
      const res = await fetch('/api/me', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: draft, phone: phoneDraft }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; name?: string; phone?: string | null };
      if (!res.ok) {
        setNameError(body.error ?? 'Não deu para salvar o nome agora. Tente de novo em instantes.');
        return;
      }
      setDraft(body.name ?? draft.trim());
      setPhoneDraft(formatPhone(body.phone) || '');
      setSaved(true);
      router.refresh();
    } catch {
      setNameError('Sem conexão. Confira a internet e tente salvar de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function leaveEverywhere() {
    setLeaveBusy(true);
    setLeaveError('');
    try {
      const res = await fetch('/api/auth/logout-all', { method: 'POST' });
      if (!res.ok) {
        setLeaveError('Não deu para encerrar as sessões agora. Tente de novo em instantes.');
        return;
      }
      await signOut(auth).catch(() => undefined);
      router.push('/entrar');
      router.refresh();
    } catch {
      setLeaveError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setLeaveBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Seu perfil</h1>
        <p className="text-sm text-muted">Vale para todas as contas de que você faz parte.</p>
      </div>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <section className="card space-y-4" aria-labelledby="perfil-dados">
            <h2 id="perfil-dados" className="text-lg font-semibold">
              Dados
            </h2>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty && draft.trim() && phoneOk && !saving) void saveName();
              }}
            >
              <Field
                label="Nome"
                value={draft}
                onChange={(v) => {
                  setDraft(v.slice(0, NAME_MAX));
                  setSaved(false);
                }}
                autoComplete="name"
                error={nameError}
                disabled={saving}
              />
              <Field
                label="Celular"
                type="tel"
                value={phoneDraft}
                onChange={(v) => {
                  setPhoneDraft(v.slice(0, 20));
                  setSaved(false);
                }}
                autoComplete="tel-national"
                placeholder="(11) 91234-5678"
                help="Só para contato da equipe da Ekoai."
                error={phoneOk ? '' : PHONE_ERROR}
                disabled={saving}
              />
              <Field label="E-mail" value={email} onChange={() => undefined} readOnly help="O e-mail é o do seu login e não muda por aqui." />
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className="btn-primary" disabled={!dirty || !draft.trim() || !phoneOk || saving}>
                  {saving && <Spinner />}
                  Salvar
                </button>
                {saved && !dirty && (
                  <span role="status" className="text-sm text-success">
                    Dados salvos.
                  </span>
                )}
              </div>
            </form>
          </section>

          <section className="card space-y-3" aria-labelledby="perfil-avisos">
            <div>
              <h2 id="perfil-avisos" className="text-lg font-semibold">
                Notificações
              </h2>
              <p className="text-sm text-muted">Escolha o que chega no app e por e-mail, por categoria. Vale para todas as suas contas.</p>
            </div>
            <NotificationPrefs initial={prefs} mailReady={mailReady} />
            <Link href="/notificacoes" className="btn-ghost">
              Ver avisos
            </Link>
          </section>
        </div>

        <div className="space-y-5">
          <MfaCard email={email} state={mfa.state} required={mfa.required} config={config} />

          <section className="card space-y-3" aria-labelledby="perfil-sessoes">
            <div>
              <h2 id="perfil-sessoes" className="text-lg font-semibold">
                Sessões
              </h2>
              <p className="text-sm text-muted">Encerra o seu acesso em todos os navegadores e aparelhos, inclusive neste. Depois você entra de novo.</p>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setLeaving(true)}>
              Sair de todos os dispositivos
            </button>
          </section>
        </div>
      </div>

      {leaving && (
        <Modal
          title="Sair de todos os dispositivos?"
          onClose={() => {
            if (leaveBusy) return;
            setLeaving(false);
            setLeaveError('');
          }}
        >
          <p className="text-sm text-muted">Você sai deste navegador e de qualquer outro em que esteja conectado. Para voltar, entre de novo com o seu e-mail.</p>
          {leaveError && <ErrorLine>{leaveError}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={leaveBusy}
              onClick={() => {
                setLeaving(false);
                setLeaveError('');
              }}
            >
              Cancelar
            </button>
            <button type="button" className="btn-primary" disabled={leaveBusy} onClick={() => void leaveEverywhere()}>
              {leaveBusy && <Spinner />}
              Sair de todos
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

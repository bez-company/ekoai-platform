'use client';

// TeamManager.tsx: Configurações › Equipe (SPEC 011 R4). Lista quem está na conta, convida, muda
// papel e remove. Toda ação passa pelas rotas /api/team/*: a tela só mostra o que o servidor
// permite e repete a mensagem dele quando recusa (último administrador, limite de vagas...).

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Modal from './Modal';
import RowMenu, { type MenuItem } from './RowMenu';
import { ErrorLine, Field, Spinner } from './auth/ui';
import { ROLE_COPY } from '@/lib/auth-flow';
import { adminCount, initials, inviteExpiry, isSoleAdmin, lastAccessLabel, type SeatUsage } from '@/lib/team-view';
import type { Role } from '@/lib/permissions';
import type { TeamInvitation, TeamMember } from '@/lib/team';

export type InvitationRow = TeamInvitation & { daysLeft: number };

type Props = {
  members: TeamMember[];
  invitations: InvitationRow[];
  meId: string;
  planName: string;
  seats: SeatUsage;
  canInvite: boolean;
  // Quem administra o plano (billing.manage) vê o caminho para o upgrade quando a conta é Individual.
  canManagePlan: boolean;
};

type Dialog =
  | { kind: 'invite' }
  | { kind: 'link'; email: string; link: string }
  | { kind: 'role'; member: TeamMember }
  | { kind: 'remove'; member: TeamMember }
  | { kind: 'leave'; member: TeamMember }
  | { kind: 'cancel'; invite: InvitationRow };

type Reply = { ok: true; data: Record<string, unknown> } | { ok: false; error: string; unauthorized: boolean };

async function send(url: string, method: string, body?: unknown): Promise<Reply> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data };
    const error = typeof data.error === 'string' ? data.error : 'Não deu para concluir. Tente de novo.';
    return { ok: false, error, unauthorized: res.status === 401 };
  } catch {
    return { ok: false, error: 'Sem conexão. Confira a rede e tente de novo.', unauthorized: false };
  }
}

const ROLES: Role[] = ['admin', 'creator', 'viewer'];

function RolePicker({ value, onChange, disabled }: { value: Role; onChange: (role: Role) => void; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold">Papel</legend>
      {ROLES.map((role) => (
        <label
          key={role}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3 has-[:checked]:border-accent-text has-[:checked]:bg-inset has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
        >
          <input type="radio" name="role" value={role} checked={value === role} onChange={() => onChange(role)} className="mt-1 accent-accent" />
          <span className="text-sm">
            <span className="block font-semibold">{ROLE_COPY[role].label}</span>
            <span className="block text-muted">{ROLE_COPY[role].what}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export default function TeamManager({ members, invitations, meId, planName, seats, canInvite, canManagePlan }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('creator');
  const [copied, setCopied] = useState(false);
  // Falha ao remover: o aviso fica na tela, com a saída "Tentar de novo" (SPEC 029, decisão 8).
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const admins = adminCount(members);

  function open(next: Dialog, initialRole: Role = 'creator') {
    setError('');
    setFailure(null);
    setCopied(false);
    setRole(initialRole);
    if (next.kind === 'invite') setEmail('');
    setModal(next);
  }

  function close() {
    setModal(null);
    setError('');
  }

  // Roda a ação; em sucesso atualiza a lista, em falha mostra a mensagem do servidor na janela.
  async function run(url: string, method: string, body: unknown, onDone: (data: Record<string, unknown>) => void) {
    setBusy(true);
    setError('');
    const reply = await send(url, method, body);
    setBusy(false);
    if (!reply.ok) {
      if (reply.unauthorized) {
        router.push('/entrar');
        return;
      }
      setError(reply.error);
      return;
    }
    onDone(reply.data);
    router.refresh();
  }

  function showLink(data: Record<string, unknown>, to: string) {
    if (typeof data.link === 'string') {
      setCopied(false);
      setModal({ kind: 'link', email: to, link: data.link });
      return;
    }
    setModal(null);
    setNotice(`Convite enviado para ${to}.`);
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      linkField.current?.select();
    }
  }

  function removeMember(m: TeamMember) {
    setFailure(null);
    void (async () => {
      setBusy(true);
      const reply = await send(`/api/team/members/${m.userId}`, 'DELETE');
      setBusy(false);
      if (reply.ok) {
        setModal(null);
        setNotice(`${m.name ?? m.email} saiu da empresa.`);
        router.refresh();
        return;
      }
      if (reply.unauthorized) {
        router.push('/entrar');
        return;
      }
      setModal(null);
      setFailure({ message: `Não deu para remover ${m.name ?? m.email} agora. ${reply.error} Nada mudou: a pessoa continua na equipe.`, retry: () => removeMember(m) });
    })();
  }

  const now = Date.now();
  const sole = (id: string) => isSoleAdmin(members, id);
  const nameOf = (m: TeamMember) => m.name ?? m.email;

  function resend(i: InvitationRow) {
    setNotice('');
    void run(`/api/team/invitations/${i.id}/resend`, 'POST', undefined, (d) => {
      if (typeof d.link === 'string') showLink(d, i.email);
      else setNotice(`Convite reenviado para ${i.email}. O link novo vale por 7 dias e o anterior deixou de funcionar.`);
    });
  }

  function copyLink(i: InvitationRow) {
    setNotice('');
    void run(`/api/team/invitations/${i.id}/resend?link=1`, 'POST', undefined, (d) => {
      if (typeof d.link !== 'string') return;
      const link = d.link;
      navigator.clipboard.writeText(link).then(
        () => setNotice(`Link novo copiado para ${i.email}. O anterior deixou de funcionar.`),
        () => showLink(d, i.email),
      );
    });
  }

  function memberItems(m: TeamMember): MenuItem[] {
    const me = m.userId === meId;
    if (me) {
      const locked = sole(m.userId);
      return [
        { key: 'role', label: 'Mudar meu papel', disabled: locked, onSelect: () => open({ kind: 'role', member: m }, m.role) },
        { key: 'leave', label: 'Sair da empresa', disabled: locked, danger: true, onSelect: () => open({ kind: 'leave', member: m }) },
      ];
    }
    return [
      { key: 'role', label: 'Mudar papel', onSelect: () => open({ kind: 'role', member: m }, m.role) },
      'separator',
      { key: 'remove', label: 'Remover da empresa', danger: true, onSelect: () => open({ kind: 'remove', member: m }) },
    ];
  }

  function inviteItems(i: InvitationRow): MenuItem[] {
    const expired = i.status === 'expired';
    return [
      { key: 'resend', label: expired ? 'Reenviar com novo prazo' : 'Reenviar convite', onSelect: () => resend(i) },
      ...(expired ? [] : [{ key: 'copy', label: 'Copiar link do convite', onSelect: () => copyLink(i) } as MenuItem]),
      'separator',
      { key: 'cancel', label: 'Cancelar convite', danger: true, onSelect: () => open({ kind: 'cancel', invite: i }) },
    ];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Equipe</h2>
          <p className="text-sm text-muted">
            {seats.label} no plano {planName}. {seats.unlimited ? 'Sem limite de pessoas na fase de teste.' : 'Convites pendentes ocupam vaga.'}
          </p>
        </div>
        {canInvite && (
          <button type="button" className="btn-primary" disabled={seats.full} onClick={() => open({ kind: 'invite' })}>
            Convidar pessoa
          </button>
        )}
      </div>

      {notice && (
        <p role="status" className="card border-success/30 bg-success/10 py-3 text-sm">
          {notice}
        </p>
      )}

      {failure && (
        <div role="alert" className="card flex flex-wrap items-center justify-between gap-3 border-danger/30 bg-danger/10 py-3 text-sm text-danger">
          <p>{failure.message}</p>
          <button type="button" className="btn-ghost" onClick={failure.retry}>
            Tentar de novo
          </button>
        </div>
      )}

      {canInvite && seats.full && (
        <p role="status" className="card border-warning/30 bg-warning/10 py-3 text-sm">
          O plano {planName} chegou ao limite de {seats.max} {seats.max === 1 ? 'pessoa' : 'pessoas'}. Cancele um convite ou remova alguém para abrir vaga.
        </p>
      )}

      {!canInvite && (
        <div className="card flex flex-wrap items-center justify-between gap-3 py-3">
          <p className="text-sm text-muted">
            {canManagePlan ? 'O plano Individual tem uma vaga, só para você. Mude para o plano Time para convidar pessoas.' : 'O plano Individual tem uma vaga, só para você. Peça a quem administra a conta para mudar para o plano Time.'}
          </p>
          {canManagePlan && (
            <Link href="/perfil/conta" className="btn-primary">
              Ver planos
            </Link>
          )}
        </div>
      )}

      <section aria-labelledby="members-title" className="space-y-2">
        <h3 id="members-title" className="label">
          Pessoas e convites ({members.length + (canInvite ? invitations.length : 0)})
        </h3>
        <ul className="card divide-y divide-line p-0">
          {members.map((m) => {
            const me = m.userId === meId;
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-inset text-xs font-semibold text-muted">
                  {initials(m.name, m.email)}
                </span>
                <div className="min-w-[10rem] flex-1">
                  <p className="break-words text-sm font-semibold">
                    {nameOf(m)}
                    {me && <span className="chip ml-2">Você</span>}
                  </p>
                  {m.name && <p className="break-all text-sm text-muted">{m.email}</p>}
                </div>
                <span className="chip">{ROLE_COPY[m.role].label}</span>
                <p className="min-w-[9rem] text-sm text-muted">{lastAccessLabel(m.lastLoginAt, now)}</p>
                <RowMenu
                  label={me ? 'Ações para você' : `Ações para ${nameOf(m)}`}
                  items={memberItems(m)}
                  note={me && sole(m.userId) ? 'Você é a única pessoa administradora. Promova outra pessoa antes de mudar o seu papel ou sair.' : undefined}
                />
              </li>
            );
          })}
          {canInvite &&
            invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-xs font-semibold text-muted">
                  {initials(null, i.email)}
                </span>
                <div className="min-w-[10rem] flex-1">
                  <p className="break-all text-sm font-semibold">{i.email}</p>
                </div>
                <span className="chip">{ROLE_COPY[i.role].label}</span>
                <p className="min-w-[9rem] text-sm text-muted">
                  <span className={`chip mr-2 ${i.status === 'expired' ? 'border-danger/40 text-danger' : 'border-warning/40 text-warning'}`}>{i.status === 'expired' ? 'Convite venceu' : 'Convite pendente'}</span>
                  {inviteExpiry(i.status, i.daysLeft)}
                </p>
                <RowMenu label={`Ações para o convite de ${i.email}`} items={inviteItems(i)} />
              </li>
            ))}
        </ul>
        {canInvite && invitations.length === 0 && members.length > 0 && <p className="text-sm text-muted">Convide quem cria os posts e quem revisa. Convite pendente só conta como pessoa depois de aceito.</p>}
        {!modal && error && <ErrorLine>{error}</ErrorLine>}
      </section>

      <section aria-labelledby="roles-title" className="card space-y-3">
        <h3 id="roles-title" className="text-sm font-semibold">
          O que cada papel faz
        </h3>
        <dl className="space-y-2 text-sm">
          {ROLES.map((r) => (
            <div key={r}>
              <dt className="inline font-semibold">{ROLE_COPY[r].label}: </dt>
              <dd className="inline text-muted">{ROLE_COPY[r].what}</dd>
            </div>
          ))}
        </dl>
      </section>

      {modal?.kind === 'invite' && (
        <Modal title="Convidar pessoa" onClose={close}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setNotice('');
              const to = email.trim().toLowerCase();
              void run('/api/team/invitations', 'POST', { email: to, role }, (d) => showLink(d, to));
            }}
          >
            <Field label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="off" autoFocus placeholder="ana@empresa.com.br" disabled={busy} />
            <RolePicker value={role} onChange={setRole} disabled={busy} />
            {error && <ErrorLine>{error}</ErrorLine>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>
                {busy && <Spinner />}
                Criar convite
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.kind === 'link' && (
        <Modal title="Convite criado" onClose={close}>
          <p className="text-sm text-muted">
            Ainda não enviamos e-mail. Copie o link e mande para {modal.email}. Ele vale por 7 dias e só funciona com esse e-mail.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="invite-link" className="text-sm font-semibold">
              Link do convite
            </label>
            <input id="invite-link" ref={linkField} readOnly value={modal.link} onFocus={(e) => e.currentTarget.select()} className="input font-mono text-xs" />
          </div>
          <p role="status" className="min-h-5 text-sm text-success">
            {copied ? 'Link copiado.' : ''}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>
              Fechar
            </button>
            <button type="button" className="btn-primary" onClick={() => void copy(modal.link)}>
              Copiar link
            </button>
          </div>
        </Modal>
      )}

      {modal?.kind === 'role' && (
        <Modal title={modal.member.userId === meId ? 'Mudar o meu papel' : `Mudar o papel de ${nameOf(modal.member)}`} onClose={close}>
          <p className="text-sm text-muted">A mudança vale na próxima ação da pessoa.</p>
          <RolePicker value={role} onChange={setRole} disabled={busy} />
          {modal.member.role === 'admin' && admins === 1 && role !== 'admin' && (
            <p className="text-sm text-muted">Esta é a única pessoa administradora. Promova outra antes de mudar este papel.</p>
          )}
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || role === modal.member.role}
              onClick={() => void run(`/api/team/members/${modal.member.userId}`, 'PATCH', { role }, () => setModal(null))}
            >
              {busy && <Spinner />}
              Salvar papel
            </button>
          </div>
        </Modal>
      )}

      {modal?.kind === 'remove' && (
        <Modal title={`Remover ${nameOf(modal.member)} da empresa?`} onClose={close}>
          <p className="text-sm text-muted">{nameOf(modal.member)} perde o acesso a esta conta na próxima ação.</p>
          <div className="rounded-lg border border-line bg-inset p-3 text-sm">
            <p className="font-semibold">O que acontece</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
              <li>Os posts que a pessoa criou continuam na conta.</li>
              <li>Os convites que ela enviou continuam valendo.</li>
              <li>O login dela não é apagado: se ela tem acesso a outra conta, continua entrando nela.</li>
            </ul>
          </div>
          <p className="text-sm text-muted">Para dar o acesso de volta, convide {modal.member.email} de novo.</p>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => removeMember(modal.member)}>
              {busy && <Spinner />}
              Remover da empresa
            </button>
          </div>
        </Modal>
      )}

      {modal?.kind === 'leave' && (
        <Modal title="Sair desta empresa?" onClose={close}>
          <p className="text-sm text-muted">Você perde o acesso a esta conta na próxima ação. Os posts que você criou continuam aqui, e o seu login continua valendo em outras contas. Para voltar, alguém precisa convidar você de novo.</p>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
              Ficar
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void run(`/api/team/members/${modal.member.userId}`, 'DELETE', undefined, () => window.location.assign('/entrar'))}>
              {busy && <Spinner />}
              Sair da empresa
            </button>
          </div>
        </Modal>
      )}

      {modal?.kind === 'cancel' && (
        <Modal title={`Cancelar o convite de ${modal.invite.email}?`} onClose={close}>
          <p className="text-sm text-muted">O link enviado deixa de funcionar e a vaga volta a ficar livre.</p>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
              Manter convite
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => void run(`/api/team/invitations/${modal.invite.id}`, 'DELETE', undefined, () => setModal(null))}
            >
              {busy && <Spinner />}
              Cancelar convite
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

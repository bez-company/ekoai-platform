// onboarding-data.ts: o lado com banco do onboarding da SPEC 017 (BEZ-234). As regras puras ficam em
// onboarding.ts; aqui só se lê e grava, sempre pelo tenantDb.

import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { accountOf, onboardingSkipped } from './accounts';
import { getProfile } from './company-profile';
import { isProfileComplete } from './company-profile-model';
import { getPauseState } from './pause';
import { listTeam } from './team';
import type { Role } from './permissions';
import {
  buildGuide,
  defaultSlots,
  pendingAge,
  type Goal,
  type Guide,
  type GuideInput,
  type OnboardingAnswers,
  type PostsPerWeek,
  type Source,
} from './onboarding';

export type StoredAnswers = OnboardingAnswers & { answeredAt: string };

export async function getOnboardingAnswers(t: TenantDb): Promise<StoredAnswers | null> {
  const { data, error } = await t.select('onboarding_answers', 'source,goal,posts_per_week,answered_at').limit(1);
  if (error) throw new Error(`onboarding_answers: ${error.message}`);
  const row = data?.[0] as { source: Source | null; goal: Goal | null; posts_per_week: PostsPerWeek | null; answered_at: string } | undefined;
  if (!row) return null;
  return { source: row.source, goal: row.goal, postsPerWeek: row.posts_per_week, answeredAt: row.answered_at };
}

// Grava as respostas (responder de novo sobrescreve) e, se veio "quantas vezes por semana" e a conta
// ainda não tem nenhum horário ativo do Instagram, cria os horários padrão. Horário que a pessoa já
// escolheu nunca é trocado.
export async function saveOnboardingAnswers(t: TenantDb, actor: SessionUser | null, answers: OnboardingAnswers): Promise<{ slotsCreated: number }> {
  const now = new Date().toISOString();
  const { error } = await t.upsert(
    'onboarding_answers',
    { source: answers.source, goal: answers.goal, posts_per_week: answers.postsPerWeek, answered_by: actor?.id ?? null, answered_at: now },
    { onConflict: 'tenant_id' },
  );
  if (error) throw new Error(`onboarding_answers: ${error.message}`);
  if (!answers.postsPerWeek) return { slotsCreated: 0 };

  const existing = await t.select('publish_slots', 'id').eq('channel', 'instagram').eq('active', true).limit(1);
  if (existing.error) throw new Error(`publish_slots: ${existing.error.message}`);
  if ((existing.data ?? []).length) return { slotsCreated: 0 };

  const slots = defaultSlots(answers.postsPerWeek).map((s) => ({ ...s, active: true }));
  const inserted = await t.insert('publish_slots', slots);
  if (inserted.error) throw new Error(`publish_slots: ${inserted.error.message}`);
  return { slotsCreated: slots.length };
}

async function exists(q: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, what: string): Promise<boolean> {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []).length > 0;
}

export type GuideFacts = Omit<GuideInput, 'role' | 'kind' | 'can' | 'hasProfile' | 'profileComplete' | 'teamStarted' | 'skipped'> & {
  pendingSavedAt: string[];
};

// Os passos novos do guia, cada um lido do dado real: pedido de post, aprovado (qualquer linha em
// scheduled_posts: agendado, na fila, publicado ou não publicado), horário ativo, pausa e publicado.
export async function guideFacts(t: TenantDb): Promise<GuideFacts> {
  const one = (table: string) => t.select(table, 'id').limit(1);
  const [instagramConnected, platformBrief, pending, postApproved, hasSlots, published, pause] = await Promise.all([
    exists(one('social_accounts').eq('status', 'active'), 'social_accounts'),
    exists(one('briefs').eq('source', 'platform'), 'briefs'),
    t.select('pending_approvals', 'saved_at').then(({ data, error }) => {
      if (error) throw new Error(`pending_approvals: ${error.message}`);
      return (data ?? []).map((r) => String((r as { saved_at: string }).saved_at));
    }),
    exists(one('scheduled_posts'), 'scheduled_posts'),
    exists(one('publish_slots').eq('channel', 'instagram').eq('active', true), 'publish_slots'),
    exists(one('scheduled_posts').eq('status', 'published'), 'scheduled_posts'),
    getPauseState(t),
  ]);
  return {
    instagramConnected,
    postCreated: platformBrief || pending.length > 0,
    postApproved,
    hasSlots,
    paused: pause.paused,
    published,
    pendingSavedAt: pending,
  };
}

export type GuideView = { guide: Guide | null; pending: ReturnType<typeof pendingAge> };

// Tudo o que o Início precisa para o guia. `can` vem da sessão (lib/session.ts, `can`), para cada
// passo mostrar a ação só a quem pode fazê-la.
export async function loadGuide(t: TenantDb, role: Role, can: GuideInput['can'], nowMs = Date.now()): Promise<GuideView> {
  const [account, profile, team, skipped, facts] = await Promise.all([
    accountOf(t.tenantId),
    getProfile(t),
    listTeam(t),
    onboardingSkipped(t.tenantId),
    guideFacts(t),
  ]);
  const { pendingSavedAt, ...rest } = facts;
  const guide = buildGuide({
    ...rest,
    role,
    kind: account?.kind ?? 'empresa',
    can,
    hasProfile: !!profile,
    profileComplete: isProfileComplete(profile),
    teamStarted: team.members.length > 1 || team.invitations.some((i) => i.status === 'pending'),
    skipped,
  });
  return { guide, pending: pendingAge(pendingSavedAt, nowMs) };
}

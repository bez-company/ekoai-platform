'use client';

// CompanyEditor.tsx: Configurações › Empresa (SPEC 011 R3). O mesmo perfil do cadastro em passos,
// agora por cartão: cada seção abre para editar e grava sozinha. Quem não tem brand.manage só lê.

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import {
  CTA_LABEL,
  aboutFromProfile,
  profileProgress,
  progressText,
  siteLabel,
  toneSummary,
  visualFromProfile,
  voiceFromProfile,
  type AboutForm,
  type VisualForm,
  type VoiceForm,
} from '@/lib/company-profile-form';
import type { CompanyProfile, FieldErrors, Section } from '@/lib/company-profile-model';
import LogoField from './LogoField';
import { AboutSection, VisualSection, VoiceSection, saveProfileSection } from './sections';

const NONE = <span className="text-muted">Não informado</span>;

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd>{value || NONE}</dd>
        </div>
      ))}
    </dl>
  );
}

function Card({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {sub && <p className="text-sm text-muted">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function CompanyEditor({ initial, canEdit }: { initial: CompanyProfile | null; canEdit: boolean }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [editing, setEditing] = useState<Section | null>(null);
  const [about, setAbout] = useState<AboutForm>(aboutFromProfile(initial));
  const [voice, setVoice] = useState<VoiceForm>(voiceFromProfile(initial));
  const [visual, setVisual] = useState<VisualForm>(visualFromProfile(initial));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const clearError = (field: string) => setErrors(({ [field]: _gone, ...rest }) => rest);
  const progress = profileProgress(profile);
  const complete = progress.percent === 100;

  function open(section: Section) {
    setAbout(aboutFromProfile(profile));
    setVoice(voiceFromProfile(profile));
    setVisual(visualFromProfile(profile));
    setErrors({});
    setError('');
    setEditing(section);
  }

  async function save(section: Section) {
    setBusy(true);
    setError('');
    const result = await saveProfileSection(section, section === 'about' ? about : section === 'voice' ? voice : visual);
    setBusy(false);
    if (result.ok) {
      setProfile(result.profile);
      setEditing(null);
      setErrors({});
      router.refresh();
      return;
    }
    if (result.unauthorized) {
      router.push('/entrar');
      return;
    }
    setErrors(result.fields);
    setError(Object.keys(result.fields).length ? '' : result.error);
  }

  const actions = (section: Section) => (
    <div className="space-y-3">
      {(error || Object.keys(errors).length > 0) && <ErrorLine>{Object.keys(errors).length ? 'Corrija os campos marcados para salvar.' : error}</ErrorLine>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setEditing(null)}>
          Descartar
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save(section)}>
          {busy && <Spinner />}
          Salvar alterações
        </button>
      </div>
    </div>
  );

  const editButton = (section: Section, label = 'Editar') =>
    canEdit && editing !== section ? (
      <button type="button" className="btn-ghost" disabled={editing !== null || (section !== 'about' && !profile)} onClick={() => open(section)}>
        {label}
      </button>
    ) : null;

  const tone = profile ? toneSummary(profile) : '';

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Perfil da empresa</h2>
            <p className="text-sm text-muted">{progressText(progress)}</p>
          </div>
          <span className={`chip ${complete ? 'border-success/40 text-success' : 'border-warning/40 text-warning'}`}>{complete ? 'Completo' : 'Incompleto'}</span>
        </div>
        <div role="progressbar" aria-label="Perfil completo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-2 overflow-hidden rounded-full bg-inset">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
      </section>

      {!canEdit && (
        <p role="status" className="card border-info/30 bg-info/10 py-3 text-sm">
          Só administradores editam o perfil da empresa. Peça a quem administra a conta se algo estiver desatualizado.
        </p>
      )}

      <Card title="Sobre o negócio" action={editButton('about', profile ? 'Editar' : 'Preencher')}>
        {editing === 'about' ? (
          <>
            <AboutSection value={about} onChange={setAbout} errors={errors} onClearError={clearError} disabled={busy} />
            {actions('about')}
          </>
        ) : profile ? (
          <Rows
            rows={[
              ['Nicho', profile.niche],
              ['O que vende', profile.offering],
              ['Para quem', profile.audience],
              ['Região', profile.region],
              ['Site', profile.siteUrl ? siteLabel(profile.siteUrl) : ''],
              ['Instagram', profile.instagramHandle ? `@${profile.instagramHandle}` : ''],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">{canEdit ? 'Comece por aqui: nicho, o que a empresa vende e para quem.' : 'A empresa ainda não preencheu este perfil.'}</p>
        )}
      </Card>

      <Card title="Jeito de falar" sub={profile && progress.missing.includes('voice') ? 'Ainda não preenchido.' : 'Ajuda a IA a acertar o tom.'} action={editButton('voice')}>
        {editing === 'voice' ? (
          <>
            <VoiceSection value={voice} onChange={setVoice} errors={errors} onClearError={clearError} disabled={busy} />
            {actions('voice')}
          </>
        ) : profile ? (
          <Rows
            rows={[
              ['Tom', tone],
              ['Nunca usa', profile.bannedWords.join(', ')],
              ['Diferenciais', profile.differentiators.join(' · ')],
              ['Dores do cliente', profile.pains.join(' · ')],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">Preencha antes o que a empresa vende.</p>
        )}
      </Card>

      <Card title="Visual" sub={profile && progress.missing.includes('visual') ? 'Sem logo, cores e fontes ainda.' : 'Usado nas artes da fase 2.'} action={editButton('visual')}>
        {profile && (
          <LogoField
            assetId={profile.logoAssetId}
            canEdit={canEdit}
            onChange={(logoAssetId) => {
              setProfile({ ...profile, logoAssetId });
              router.refresh();
            }}
          />
        )}
        {editing === 'visual' ? (
          <>
            <VisualSection value={visual} onChange={setVisual} errors={errors} onClearError={clearError} disabled={busy} />
            {actions('visual')}
          </>
        ) : profile ? (
          <Rows
            rows={[
              ['Cor principal', profile.colorPrimary ? <ColorValue key="p" hex={profile.colorPrimary} /> : ''],
              ['Cor de destaque', profile.colorAccent ? <ColorValue key="a" hex={profile.colorAccent} /> : ''],
              ['Fontes', [profile.fontHeading, profile.fontBody].filter(Boolean).join(' e ')],
              ['Chamada da legenda', profile.ctaDefault ? CTA_LABEL[profile.ctaDefault] : ''],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">Preencha antes o que a empresa vende.</p>
        )}
      </Card>
    </div>
  );
}

function ColorValue({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono">
      <span aria-hidden="true" className="h-4 w-4 rounded border border-line-strong" style={{ background: hex }} />
      {hex}
    </span>
  );
}

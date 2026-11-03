'use client';

// InstagramConnectCard.tsx: o passo "Conecte seu Instagram para a Ekoai ler suas coisas" do cadastro rápido (SPEC 034, BEZ-536; protótipo v30, Fase 13).
// Diz o que será lido e que nada é publicado em nome da pessoa, linka a política de privacidade e o caminho de remoção (os termos da Meta) ANTES
// do botão, e nunca trava o cadastro: "Agora não" segue com o site. A conexão em si é a de sempre (/api/instagram/connect), com a volta ao cadastro.

import type { OnboardingFlash } from '@/lib/instagram-onboarding';

type Props = {
  connected: boolean;
  handle: string | null;
  flash: OnboardingFlash | null;
  onConnect: () => void;
  onSkip: () => void;
};

const READS = [
  ['Legendas dos seus posts recentes', 'o jeito de falar da marca'],
  ['Hashtags e palavras que você repete', 'viram a voz dos posts novos'],
] as const;

export default function InstagramConnectCard({ connected, handle, flash, onConnect, onSkip }: Props) {
  if (connected) {
    return (
      <div role="status" className="space-y-2 rounded-xl border border-success bg-raised p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden="true" className="text-success">✓</span>
          Instagram conectado
        </h2>
        {handle && <p className="text-sm font-semibold">@{handle.replace(/^@/, '')}</p>}
        <p className="text-sm text-muted">Na leitura, a Ekoai inclui as legendas dos seus posts recentes junto com o site.</p>
      </div>
    );
  }
  const warn = flash?.tone === 'warn';
  return (
    <div className={`space-y-3 rounded-xl border p-4 ${warn ? 'border-warning' : 'border-line'} bg-raised`}>
      <h2 className="text-base font-semibold">Conecte seu Instagram para a Ekoai ler suas coisas</h2>
      {flash && (
        <p role="status" className={`rounded-lg border p-3 text-sm ${warn ? 'border-warning text-warning' : 'border-success text-success'}`}>
          {flash.text}
        </p>
      )}
      <ul className="space-y-1.5 text-sm">
        {READS.map(([title, detail]) => (
          <li key={title} className="flex gap-2">
            <span aria-hidden="true" className="text-success">✓</span>
            <span>
              <strong>{title}</strong> <span className="text-muted">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-muted">A Ekoai só lê. Nada é publicado, curtido ou comentado em seu nome, e você desconecta quando quiser em Configurações, Redes.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={onConnect}>
          {warn ? 'Tentar de novo' : 'Conectar Instagram'}
        </button>
        <button type="button" className="btn-ghost border-transparent bg-transparent" onClick={onSkip}>
          {warn ? 'Seguir só com o site' : 'Agora não'}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Ao conectar, você autoriza a Ekoai a ler o perfil e as publicações da conta do Instagram que escolher, para sugerir posts. Veja a{' '}
        <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="link">
          política de privacidade
        </a>{' '}
        e como{' '}
        <a href="/instagram/exclusao" target="_blank" rel="noopener noreferrer" className="link">
          remover o acesso e pedir a exclusão dos dados
        </a>
        .
      </p>
    </div>
  );
}

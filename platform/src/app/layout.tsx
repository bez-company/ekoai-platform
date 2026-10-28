import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import WakeScreen from '@/components/wake/WakeScreen';
import UpdateNotice from '@/components/UpdateNotice';
import { appVersion } from '@/lib/app-version';
import { environmentAsleep } from '@/lib/wake-gate';

// Fontes servidas pela própria plataforma (sem chamada ao Google em runtime): Sora e DM Mono.
const sora = localFont({
  src: '../fonts/sora-400-700-latin.woff2',
  weight: '400 700',
  variable: '--font-sora',
  display: 'swap',
});

const dmMono = localFont({
  src: [
    { path: '../fonts/dm-mono-400-latin.woff2', weight: '400' },
    { path: '../fonts/dm-mono-500-latin.woff2', weight: '500' },
  ],
  variable: '--font-dm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ekoai',
  description: 'O Instagram da sua empresa: você aprova, a Ekoai agenda e publica.',
};

// Dinâmico de propósito: no staging sob demanda (SPEC 016) cada pedido confere se o banco está de pé e,
// se não estiver, mostra a tela "Ligar o ambiente" no lugar do app. Fora do staging a conferência não faz nada.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const asleep = await environmentAsleep();
  return (
    <html lang="pt-BR" data-theme="light" className={`${sora.variable} ${dmMono.variable}`}>
      <body>
        {asleep ? <WakeScreen /> : children}
        <UpdateNotice version={appVersion()} />
      </body>
    </html>
  );
}

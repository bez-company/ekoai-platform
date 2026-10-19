import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light" className={`${sora.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

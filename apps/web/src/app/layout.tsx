import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Rota — Painel de Operacao Logistica',
  description:
    'Painel administrativo interno: acompanhamento de jornadas, rotas, visitas e alertas.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-ink-inverse"
        >
          Pular para o conteudo
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
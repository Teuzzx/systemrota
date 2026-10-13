'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { LoadingBlock } from '@/components/ui';

function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, nav } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base">
        <LoadingBlock label="Verificando sessao" />
      </main>
    );
  }
  if (!user) {
    // Sem sessao: o usuario vai para a tela de login.
    if (typeof window !== 'undefined' && !pathname.startsWith('/entrar')) {
      window.location.replace('/entrar');
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-base text-ink">
      <div className="flex">
        <aside className="w-56 shrink-0 border-r border-border-subtle bg-surface">
          <div className="border-b border-border-subtle px-4 py-4">
            <div className="text-body font-semibold uppercase tracking-widest text-accent">Rota</div>
            <div className="mt-1 text-label uppercase text-ink-muted">Painel operacional</div>
          </div>
          <nav aria-label="Navegacao principal" className="flex flex-col p-2">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-sm px-3 py-2 text-body transition-colors duration-DEFAULT ${
                    active
                      ? 'bg-status-progress-dim font-semibold text-status-progress'
                      : 'text-ink-secondary hover:bg-raised hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-border-subtle bg-surface px-6 py-3">
            <div className="text-table text-ink-secondary">
              {user.name} · <span className="uppercase">{user.roles.join(', ')}</span>
            </div>
            <button type="button" onClick={() => void logout()} className="text-body text-ink-secondary hover:text-accent">
              Sair
            </button>
          </header>
          <main id="conteudo" className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  // AuthProvider vive no layout raiz; aqui so o shell com navegacao.
  return <Shell>{children}</Shell>;
}

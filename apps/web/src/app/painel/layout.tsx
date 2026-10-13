'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { ConnectionPill, LoadingBlock, Skeleton } from '@/components/ui';
import {
  IconBell, IconChart, IconClock, IconGauge, IconLogout, IconMap,
  IconRoute, IconStore, IconUsers,
} from '@/components/icons';
import { groupNav, type NavIconName } from '@/lib/permissions';

const NAV_ICON: Record<NavIconName, (p: { className?: string }) => React.ReactElement> = {
  gauge: IconGauge,
  map: IconMap,
  users: IconUsers,
  route: IconRoute,
  store: IconStore,
  clock: IconClock,
  bell: IconBell,
  chart: IconChart,
};

/** Relogio da operacao. Fuso fixo: o painel e usado no Brasil. */
function useOperationalClock(): string {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const tick = () =>
      setNow(
        new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date()),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, nav } = useAuth();
  const pathname = usePathname();
  const clock = useOperationalClock();

  // O estado de rede vive no shell: um unico lugar para o operador olhar.
  const [netState, setNetState] = useState<'conectado' | 'reconectando' | 'offline'>('conectado');
  useEffect(() => {
    const online = () => setNetState('conectado');
    const offline = () => setNetState('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    if (!navigator.onLine) setNetState('offline');
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-base">
        <div className="w-60 shrink-0 border-r border-border-subtle bg-surface p-4">
          <Skeleton className="h-6 w-28" />
          <div className="mt-6 flex flex-col gap-3">
            {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </div>
        <div className="flex-1 p-6">
          <LoadingBlock label="Verificando sessao" />
        </div>
      </div>
    );
  }
  if (!user) {
    // Sem sessao: o usuario vai para a tela de login.
    if (typeof window !== 'undefined' && !pathname.startsWith('/entrar')) {
      window.location.replace('/entrar');
    }
    return null;
  }

  const groups = groupNav(nav);

  return (
    <div className="flex min-h-screen bg-base text-ink">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border-subtle bg-surface md:flex">
        <div className="border-b border-border-subtle px-4 py-4">
          <div className="text-body font-semibold uppercase tracking-widest text-accent">Rota</div>
          <div className="mt-1 text-label uppercase text-ink-muted">Painel operacional</div>
        </div>
        <nav aria-label="Navegacao principal" className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="px-3 pb-1 text-label font-semibold uppercase tracking-widest text-ink-muted">
                {group.label}
              </div>
              <ul className="flex flex-col">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  const Glyph = NAV_ICON[item.icon];
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-3 rounded-sm px-3 py-2 text-body transition-colors duration-DEFAULT ${
                          active
                            ? 'bg-status-progress-dim font-semibold text-status-progress'
                            : 'text-ink-secondary hover:bg-raised hover:text-ink'
                        }`}
                      >
                        <Glyph className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-border-subtle px-4 py-3 text-label uppercase text-ink-muted">
          Operacao de Picos · PI
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border-subtle bg-surface px-6 py-3">
          <div className="min-w-0">
            <div className="truncate text-body text-ink">{user.name}</div>
            <div className="text-label uppercase text-ink-muted">{user.roles.join(' · ')}</div>
          </div>
          <div className="flex items-center gap-3">
            <time
              aria-label="Hora local"
              className="tabular hidden text-body text-ink-secondary sm:block"
              suppressHydrationWarning
            >
              {clock || '--:--:--'}
            </time>
            <ConnectionPill state={netState} />
            <button
              type="button"
              onClick={() => void logout()}
              className="flex items-center gap-2 text-body text-ink-secondary transition-colors duration-DEFAULT hover:text-accent"
            >
              <IconLogout className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>
        <main id="conteudo" className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  // AuthProvider vive no layout raiz; aqui so o shell com navegacao.
  return <Shell>{children}</Shell>;
}
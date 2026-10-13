'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Banner, buttonClass, Field, inputClass } from '@/components/ui';

export default function LoginPage() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Entrar — Rota';
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      /* mensagem exibida via `error` */
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecovery(event: React.FormEvent) {
    event.preventDefault();
    const { api } = await import('@/lib/api');
    const result = await api.post<{ message: string }>('/auth/forgot-password', { email });
    setRecoveryMessage(result.message);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-body font-semibold uppercase tracking-widest text-accent">Rota</h1>
          <p className="mt-1 text-body text-ink-secondary">Painel administrativo de operacao logistica</p>
        </div>

        <div className="rounded-md border border-border-subtle bg-surface p-6">
          {showRecovery ? (
            <form onSubmit={handleRecovery} className="flex flex-col gap-4">
              <h2 className="text-body font-semibold text-ink">Recuperar senha</h2>
              <Field label="E-mail">
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              {recoveryMessage ? <Banner tone="ok">{recoveryMessage}</Banner> : null}
              <button type="submit" className={buttonClass}>Enviar instrucoes</button>
              <button type="button" className="text-body text-ink-secondary hover:text-accent" onClick={() => setShowRecovery(false)}>
                Voltar ao login
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <h2 className="text-body font-semibold text-ink">Entrar</h2>
              {error ? <Banner tone="critical">{error}</Banner> : null}
              <Field label="Usuario ou e-mail">
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label="Senha">
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <button type="submit" className={buttonClass} disabled={submitting}>
                {submitting ? 'Entrando...' : 'Entrar'}
              </button>
              <button
                type="button"
                className="text-left text-body text-ink-secondary hover:text-accent"
                onClick={() => setShowRecovery(true)}
              >
                Esqueci minha senha
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-table text-ink-muted">
          Acesso restrito a pessoal autorizado. Todas as acoes ficam registradas em auditoria.
        </p>
      </div>
    </main>
  );
}

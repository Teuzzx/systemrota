'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DriverRow, Paginated } from '@/lib/types';
import {
  buttonClass, ErrorBlock, Field, inputClass, LoadingBlock, Panel, StatusBadge, primaryButtonClass,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

/** TELA 4 — MOTORISTAS. */
export default function MotoristasPage() {
  const [data, setData] = useState<Paginated<DriverRow> | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = search ? `?search=${encodeURIComponent(search)}` : '';
      setData(await api.get<Paginated<DriverRow>>(`/drivers${query}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar motoristas.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  async function toggleActive(driver: DriverRow) {
    setMessage(null);
    try {
      await api.post(`/drivers/${driver.id}/active`, { active: driver.status !== 'ATIVO' });
      setMessage(`Cadastro de ${driver.user.name} atualizado.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao alterar cadastro.');
    }
  }

  if (loading && !data) return <LoadingBlock label="Carregando motoristas" />;
  if (error && !data) return <ErrorBlock message={error} onRetry={() => void load()} />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-body font-semibold text-ink">Motoristas</h1>
          <p className="text-table text-ink-secondary">{data?.total ?? 0} cadastrados</p>
        </div>
        <button type="button" className={primaryButtonClass} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Fechar formulario' : 'Cadastrar motorista'}
        </button>
      </header>

      {message ? <p className="text-body text-ink-secondary">{message}</p> : null}

      {showForm ? <CreateDriverForm onCreated={async () => { setShowForm(false); await load(); }} /> : null}

      <Panel title="Lista" actions={null}>
        <div className="flex items-end gap-3 border-b border-border-subtle px-4 py-3">
          <div className="w-64">
            <Field label="Buscar">
              <input
                className={inputClass}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nome ou e-mail"
              />
            </Field>
          </div>
          <button type="button" className={buttonClass} onClick={() => void load()}>Filtrar</button>
        </div>
        <ul className="divide-y divide-border-subtle">
          {(data?.data ?? []).length === 0 ? (
            <li className="px-4 py-6 text-body text-ink-secondary">Nenhum motorista cadastrado.</li>
          ) : null}
          {(data?.data ?? []).map((driver) => (
            <li key={driver.id} className="grid grid-cols-6 items-center gap-2 px-4 py-2 text-table">
              <div className="text-ink">
                {driver.user.name}
                {driver.isDemo ? <span className="ml-2 text-label uppercase text-status-warn">demo</span> : null}
              </div>
              <div className="tabular text-ink-secondary">{driver.code ?? '--'}</div>
              <div className="text-ink-secondary">{driver.homeCity ?? '--'}</div>
              <div className="tabular text-ink-secondary">{formatDateTime(driver.user.lastLoginAt)}</div>
              <div>
                <StatusBadge
                  label={driver.status === 'ATIVO' ? 'ATIVO' : 'INATIVO'}
                  tone={driver.status === 'ATIVO' ? 'ok' : 'neutral'}
                />
              </div>
              <div className="text-right">
                <button type="button" className={buttonClass} onClick={() => void toggleActive(driver)}>
                  {driver.status === 'ATIVO' ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function CreateDriverForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', email: '', code: '', homeCity: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ temporaryPassword: string | null }>('/drivers', {
        name: form.name,
        email: form.email,
        code: form.code || undefined,
        homeCity: form.homeCity || undefined,
      });
      setTemporaryPassword(created.temporaryPassword);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao cadastrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Novo motorista">
      <form onSubmit={submit} className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
        <Field label="Nome"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="E-mail"><input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
        <Field label="Codigo"><input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
        <Field label="Cidade base"><input className={inputClass} value={form.homeCity} onChange={(e) => setForm({ ...form, homeCity: e.target.value })} /></Field>
        <div className="col-span-4 flex items-center gap-3">
          <button type="submit" className={primaryButtonClass} disabled={busy}>{busy ? 'Salvando...' : 'Cadastrar'}</button>
          {error ? <span className="text-body text-status-critical">{error}</span> : null}
          {temporaryPassword ? (
            <span className="tabular text-body text-status-ok">
              Senha inicial: {temporaryPassword} (exibida uma vez; o motorista debera troca-la no primeiro acesso)
            </span>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

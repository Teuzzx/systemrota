import { describe, expect, it, vi } from 'vitest';

/**
 * Regressao real: em 13/10/2026 o painel na Vercel mostrou
 * "Falha na comunicacao com a API (HTTP 404)" com NEXT_PUBLIC_API_URL vazio.
 *
 * A causa era `??` no lugar de `||`: variavel vazia chega como string '', e
 * '' ?? '/api' devolve ''. O navegador passava a pedir /auth/me (sem /api),
 * o proxy do Next nao casava e a Vercel respondia 404 em HTML.
 *
 * Este teste fixa o comportamento do prefixo.
 */
async function carregarBase(variavel: string | undefined): Promise<string> {
  vi.resetModules();
  const original = process.env.NEXT_PUBLIC_API_URL;
  if (variavel === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = variavel;

  const chamadas: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    chamadas.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: { get: () => null },
    } as unknown as Response;
  }));

  const { api } = await import('./api');
  await api.get('/auth/me');
  const base = chamadas[0].replace('/auth/me', '');
  vi.unstubAllGlobals();
  if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = original;
  return base;
}

describe('Prefixo da API', () => {
  it('usa o proxy interno quando a variavel NAO existe', async () => {
    expect(await carregarBase(undefined)).toBe('/api');
  });

  it('usa o proxy interno quando a variavel esta VAZIA', async () => {
    // Este e o caso que quebrou: '' ?? '/api' devolve ''.
    expect(await carregarBase('')).toBe('/api');
  });

  it('usa a variavel quando ela tem valor', async () => {
    expect(await carregarBase('https://api.exemplo.com')).toBe('https://api.exemplo.com');
  });
});
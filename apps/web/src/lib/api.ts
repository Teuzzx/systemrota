/**
 * Cliente HTTP da API.
 *
 * Regras:
 *  - o access token vive em memoria + cookie httpOnly (a API define o cookie);
 *    nada de token em localStorage exposto a XSS;
 *  - 401 dispara uma unica renovacao e repete a requisicao;
 *  - mensagens de erro vem do backend (pt-BR), nunca texto generico.
 */
export interface ApiErrorShape {
  status: number;
  message: string;
  details?: unknown;
}

export class ApiError extends Error implements ApiErrorShape {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Prefixo das chamadas a API.
 *
 * `||` e obrigatorio, nao `??`. Variavel de ambiente declarada como vazia na
 * Vercel chega aqui como string '' â€” e `'' ?? '/api'` devolve '' (o `??` so
 * trata null/undefined). O resultado era o navegador pedir `/auth/me` em vez
 * de `/api/auth/me`: o proxy nao casava e a tela mostrava "Falha na
 * comunicacao com a API (HTTP 404)", servindo o HTML 404 da Vercel.
 *
 * Vazio significa "usar o proxy interno", que e o comportamento desejado
 * quando NEXT_PUBLIC_API_URL fica em branco.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Falha na comunicacao com a API (HTTP ${response.status}).`;
  let details: unknown;
  try {
    const body = (await response.json()) as {
      message?: string | string[];
      error?: string;
    };
    if (Array.isArray(body.message)) message = body.message.join(' ');
    else if (typeof body.message === 'string') message = body.message;
    else if (body.error) message = body.error;
    details = body;
  } catch {
    /* resposta sem JSON: mantem a mensagem padrao */
  }
  return new ApiError(response.status, message, details);
}

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const response = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: '{}',
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { accessToken: string };
        accessToken = body.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  raw?: boolean;
  retryOnUnauthorized?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, retryOnUnauthorized = true, headers, ...rest } = options;
  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined && !(body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(headers ?? {}),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });

  if (response.status === 401 && retryOnUnauthorized && !path.startsWith('/auth/')) {
    const renewed = await refreshSession();
    if (renewed) return apiFetch<T>(path, { ...options, retryOnUnauthorized: false });
  }

  if (!response.ok) throw await parseError(response);
  if (raw) return (await response.blob()) as T;
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

/**
 * Hash de senha com scrypt (node:crypto nativo).
 *
 * Decisao: scrypt evita dependencia nativa (bcrypt/argon2 compilam codigo C e
 * quebram em ambientes Windows/containers). scrypt e um KDF de uso geral
 * aprovado para armazenamento de senha. Ver docs/ADR-0003.md para a avaliacao
 * de argon2id e o criterio de migracao.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16_384, r: 8, p: 1 };
const KEY_LENGTH = 64;
// scrypt com N=16384/r=8 precisa de ~32 MB; doubling evita estouro em PGlite/WASM.
const MAX_MEM = 64 * 1024 * 1024;

/** Formato armazenado: scrypt$N$r$p$<saltHex>$<hashHex> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex as string, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltHex as string, 'hex'), expected.length, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Politica minima de senha. Aplicada no cadastro e na troca.
 * Bloqueia explicitamente as senhas que aparecem em listas deSenhas comuns.
 */
const COMMON = new Set([
  '123456', '12345678', '123456789', 'password', 'senha', 'admin', 'admin123',
  'qwerty', 'abc123', '123123', 'motorista', 'rota1234', 'changeme',
]);

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < 8) problems.push('A senha deve ter ao menos 8 caracteres.');
  if (password.length > 200) problems.push('A senha deve ter no maximo 200 caracteres.');
  if (!/[a-z]/.test(password)) problems.push('A senha deve conter ao menos uma letra minuscula.');
  if (!/[A-Z]/.test(password)) problems.push('A senha deve conter ao menos uma letra maiuscula.');
  if (!/\d/.test(password)) problems.push('A senha deve conter ao menos um digito.');
  if (COMMON.has(password.toLowerCase())) problems.push('Esta senha e comum demais e esta bloqueada.');
  return { ok: problems.length === 0, problems };
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function sha256(value: string): string {
  // Hash deterministico para armazenar tokens de refresh/reset sem guardar o token em claro.
  return createHash('sha256').update(value).digest('hex');
}

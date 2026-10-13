/**
 * Executa o CLI do Prisma sem depender do `npx` (que nao existe de forma
 * confiavel em spawnSync no Windows). Usado por global-setup e pelo script de
 * desenvolvimento local.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const API_ROOT = join(__dirname, '..', '..');

function prismaCliPath(): string {
  const candidates = [
    join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
    join(API_ROOT, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'CLI do Prisma nao encontrado. Rode `npm install` na raiz do workspace antes.',
  );
}

export function runPrisma(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(process.execPath, [prismaCliPath(), ...args], {
    cwd: API_ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

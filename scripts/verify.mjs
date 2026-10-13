#!/usr/bin/env node
/**
 * Verificacao completa do projeto. Executa de verdade e reporta o resultado real.
 *
 *   npm run verify
 *
 * Cada etapa imprime PASS/FAIL e o codigo de saida reflete qualquer falha.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  { name: 'build:shared', args: ['run', 'build:shared'] },
  { name: 'typecheck:api', args: ['run', 'typecheck', '-w', '@rota/api'] },
  { name: 'build:api', args: ['run', 'build:api'] },
  { name: 'lint:api', args: ['run', 'lint', '-w', '@rota/api'] },
  { name: 'test:api', args: ['run', 'test:api'] },
  { name: 'typecheck:web', args: ['run', 'typecheck', '-w', '@rota/web'] },
  { name: 'lint:web', args: ['run', 'lint', '-w', '@rota/web'] },
  { name: 'test:web', args: ['run', 'test:web'] },
  { name: 'build:web', args: ['run', 'build:web'] },
];

let failed = 0;
const summary = [];

for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const started = Date.now();
  const result = spawnSync('npm', step.args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const ok = result.status === 0;
  if (!ok) failed += 1;
  summary.push({ step: step.name, ok, seconds });
  process.stdout.write(`--- ${step.name}: ${ok ? 'PASS' : 'FAIL'} (${seconds}s)\n`);
}

process.stdout.write('\n================= RESUMO DA VERIFICACAO =================\n');
for (const item of summary) {
  const status = item.ok ? 'PASS' : 'FAIL';
  const name = item.step.padEnd(18);
  const time = item.seconds.toFixed(1) + 's';
  process.stdout.write(status + '  ' + name + ' ' + time + String.fromCharCode(10));
}
process.stdout.write('============================================================\n');
process.stdout.write(failed === 0
  ? 'TODAS AS ETAPAS PASSARAM.\n'
  : `${failed} ETAPA(S) FALHARAM.\n`);

process.exit(failed === 0 ? 0 : 1);

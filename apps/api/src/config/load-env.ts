/**
 * Carregamento do arquivo .env sem dependencia externa.
 *
 * Por que nao usar `dotenv`: `process.env` precisa continuar soberano.
 * Em Docker, Railway, Vercel ou CI as variaveis chegam pelo ambiente; se o
 * .env sobrescrevesse isso, a implantacao passaria a usar a senha de
 * desenvolvimento sem ninguem perceber. Aqui o .env so preenche o que falta.
 *
 * Por que nao usar `node --env-file`: o sinalizador `--env-file-if-exists`
 * exige Node 22, e o projeto declara suporte a partir de Node 20.
 *
 * Regras:
 *  - arquivo ausente nao e erro (deploy so tem variavel de ambiente);
 *  - valor ja presente em process.env nunca e sobrescrito;
 *  - o conteudo do arquivo nunca e registrado em log.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Interpreta uma linha KEY=VALUE, aceitando aspas simples e duplas. */
function parseLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(eq + 1).trim();

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    // Valor entre aspas precisa FECHAR. Sem fechar, descartar a linha inteira:
    // gravar `"sem fechamento` em process.env seria pior que nao ter variavel.
    if (value.length < 2 || value[value.length - 1] !== quote) return null;
    value = value.slice(1, -1);
    // So aspas duplas interpretam \n; as simples sao literais.
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  } else {
    // Sem aspas, '#' inicia comentario — desde que nao seja o primeiro caractere,
    // para nao cortar um valor vazio seguido de comentario.
    const hash = value.indexOf(' #');
    if (hash >= 0) value = value.slice(0, hash).trim();
  }
  return { key, value };
}

export function loadEnvFile(path: string): number {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return 0; // Arquivo ausente e o caso normal em deploy.
  }

  let applied = 0;
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) continue; // ambiente vence
    process.env[parsed.key] = parsed.value;
    applied += 1;
  }
  return applied;
}

/**
 * Procura o .env na raiz do monorepo e em apps/api.
 * A raiz primeiro: e onde esta o .env.example documentado.
 */
export function loadEnv(): void {
  const here = __dirname;
  const candidates = [
    join(here, '..', '..', '.env'),
    join(here, '..', '.env'),
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '..', '.env'),
  ];
  for (const candidate of candidates) {
    if (loadEnvFile(candidate) > 0) return;
  }
}
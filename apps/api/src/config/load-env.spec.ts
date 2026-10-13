import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from './load-env';

/**
 * O carregador escreve em process.env, que e global. Cada teste grava chaves
 * proprias e restaura o snapshot no final, para nao contaminar a suite.
 */
describe('loadEnvFile', () => {
  let dir: string;
  let snapshot: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rota-env-'));
    snapshot = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...snapshot };
    rmSync(dir, { recursive: true, force: true });
  });

  function write(content: string): string {
    const file = join(dir, '.env');
    writeFileSync(file, content, 'utf8');
    return file;
  }

  it('arquivo inexistente nao lanca e nao e erro', () => {
    expect(loadEnvFile(join(dir, 'nao-existe.env'))).toBe(0);
  });

  it('le chave e valor simples', () => {
    loadEnvFile(write('ROTA_TESTE_A=valor\n'));
    expect(process.env.ROTA_TESTE_A).toBe('valor');
  });

  it('ignora comentario, linha vazia e trecho antes do igual', () => {
    loadEnvFile(write('# comentario\n\n  \nnao-e-chave=1\n'));
    expect(process.env['nao-e-chave']).toBeUndefined();
  });

  it('remove aspas e aceita igual dentro do valor', () => {
    loadEnvFile(write('ROTA_TESTE_B="a=b"\nROTA_TESTE_C=\'texto literal\'\n'));
    expect(process.env.ROTA_TESTE_B).toBe('a=b');
    expect(process.env.ROTA_TESTE_C).toBe('texto literal');
  });

  it('aceita export no inicio da chave', () => {
    loadEnvFile(write('export ROTA_TESTE_D=ok\n'));
    expect(process.env.ROTA_TESTE_D).toBe('ok');
  });

  it('descarta aspa nao fechada em vez de gravar lixo', () => {
    loadEnvFile(write('ROTA_TESTE_E="sem fechamento\n'));
    expect(process.env.ROTA_TESTE_E).toBeUndefined();
  });

  it('NUNCA sobrescreve valor ja presente no ambiente', () => {
    // Este e o requisito que impede deploy de cair na senha de dev.
    process.env.ROTA_TESTE_F = 'do-ambiente';
    loadEnvFile(write('ROTA_TESTE_F=do-arquivo\n'));
    expect(process.env.ROTA_TESTE_F).toBe('do-ambiente');
  });

  it('preenche apenas o que falta', () => {
    process.env.ROTA_TESTE_G = 'presente';
    loadEnvFile(write('ROTA_TESTE_G=ignorado\nROTA_TESTE_H=novo\n'));
    expect(process.env.ROTA_TESTE_G).toBe('presente');
    expect(process.env.ROTA_TESTE_H).toBe('novo');
  });

  it('recusa chave com caractere invalido', () => {
    loadEnvFile(write('CHAVE COM ESPACO=1\nROTA-TRAVESSO=2\n'));
    expect(process.env['CHAVE COM ESPACO']).toBeUndefined();
    expect(process.env['ROTA-TRAVESSO']).toBeUndefined();
  });

  it('aceita arquivo sem newline final', () => {
    loadEnvFile(write('ROTA_TESTE_I=sem_newline'));
    expect(process.env.ROTA_TESTE_I).toBe('sem_newline');
  });

  it('cuida de CRLF', () => {
    loadEnvFile(write('ROTA_TESTE_J=crlf\r\nROTA_TESTE_K=outro\r\n'));
    expect(process.env.ROTA_TESTE_J).toBe('crlf');
    expect(process.env.ROTA_TESTE_K).toBe('outro');
  });

  it('conta quantas variaveis foram aplicadas', () => {
    const applied = loadEnvFile(write('ROTA_TESTE_L=1\nROTA_TESTE_M=2\ncomentario\n'));
    expect(applied).toBe(2);
  });
});
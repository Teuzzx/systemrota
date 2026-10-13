/**
 * Setup por arquivo de teste.
 *
 * O banco ja foi iniciado e migrado no globalSetup (processo separado), entao
 * aqui nao ha boot de banco. Este arquivo apenas amplia o timeout: os testes
 * de integracao talkam com um PostgreSQL real e demoram mais que o padrao.
 */
jest.setTimeout(120_000);

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL nao definida: o globalSetup nao rodou?');
  }
});

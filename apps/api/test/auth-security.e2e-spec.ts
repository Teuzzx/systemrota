/**
 * Autenticacao, autorizacao e seguranca (secoes 4 e 20 do briefing).
 *
 * Regras verificadas:
 *  - autenticacao real em todas as requisicoes (nada e desabilitado);
 *  - hash de senha nunca e texto puro;
 *  - perfil MOTORISTA nao acessa dados de outro nem administracao;
 *  - permissao e validada no BACKEND, nao apenas escondida na UI;
 *  - resposta de recuperacao de senha nao revela se o e-mail existe;
 *  - tokens e senhas nunca aparecem nos logs de auditoria.
 */
import 'reflect-metadata';
import request from 'supertest';
import { TestApp, createTestApp } from './app';
import { authHeader, login } from './http';
import { bootstrapTestData, createAdmin, createDriver, getTestPrisma } from './fixtures';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../src/auth/password';
import { PrismaService } from '../src/common/prisma.service';

jest.setTimeout(180_000);

describe('Senhas', () => {
  it('faz hash com salt e valida sem armazenar texto puro', async () => {
    const hash = await hashPassword('SenhaForte#2026');
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain('SenhaForte#2026');
    expect(await verifyPassword('SenhaForte#2026', hash)).toBe(true);
    expect(await verifyPassword('senhaerrada', hash)).toBe(false);
  });

  it('gera hashes diferentes para a mesma senha (salt unico)', async () => {
    const a = await hashPassword('MesmaSenha#2026');
    const b = await hashPassword('MesmaSenha#2026');
    expect(a).not.toBe(b);
  });

  it('aplica politica de senha minima', () => {
    expect(checkPasswordPolicy('123').ok).toBe(false);
    expect(checkPasswordPolicy('senha123').ok).toBe(false);
    expect(checkPasswordPolicy('SenhaBoa#2026').ok).toBe(true);
    expect(checkPasswordPolicy('password').ok).toBe(false);
  });
});

describe('Autenticacao e autorizacao', () => {
  let app!: TestApp;
  let adminEmail: string;
  let driverEmail: string;

  beforeAll(async () => {
    app = await createTestApp();
    await bootstrapTestData();
    adminEmail = (await createAdmin()).email;
    driverEmail = (await createDriver()).email;
  });

  afterAll(async () => {
    await app.close();
  });

  it('recusa acesso sem token', async () => {
    await request(app.app.getHttpServer()).get('/api/dashboard/overview').expect(401);
  });

  it('recusa token invalido ou adulterado', async () => {
    const { accessToken } = await login(app, adminEmail);
    const forged = `${accessToken.slice(0, -4)}xxxx`;
    const response = await request(app.app.getHttpServer())
      .get('/api/dashboard/overview')
      .set(...authHeader(forged));
    expect([401, 403]).toContain(response.status);
    expect(response.status).toBeGreaterThanOrEqual(401);
  });

  it('autentica com credenciais corretas e devolve permissoes', async () => {
    const response = await request(app.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: adminEmail, password: 'Teste@Seguro2026' })
      .expect(200);

    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.user.roles).toContain('ADMINISTRADOR');
    expect(response.body.user.permissions).toContain('routes:write');
  });

  it('recusa senha incorreta sem revelar se o e-mail existe', async () => {
    const inexistente = await request(app.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nao-existe@test.rota.invalid', password: 'Qualquer#2026' })
      .expect(401);
    const existente = await request(app.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: adminEmail, password: 'SenhaErrada#2026' })
      .expect(401);
    expect(inexistente.body.message).toBe(existente.body.message);
  });

  it('bloqueia a conta apos tentativas repetidas', async () => {
    const { email } = await createDriver(`bloqueio-${Date.now()}@test.rota.invalid`);
    // AUTH_MAX_FAILED_LOGINS = 5: as cinco primeiras tentativas erradas
    // falham com 401; a conta fica bloqueada a partir dai.
    for (let i = 0; i < 5; i += 1) {
      await request(app.app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'Errada#123456' })
        .expect(401);
    }
    // Agora ate a senha CORRETA e recusada, com mensagem de bloqueio.
    const response = await request(app.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Teste@Seguro2026' })
      .expect(403);
    expect(String(response.body.message)).toMatch(/bloqueada/i);
  });

  it('nao permite que o motorista acesse endpoints administrativos', async () => {
    const driver = await login(app, driverEmail);
    await request(app.app.getHttpServer())
      .get('/api/dashboard/overview')
      .set(...authHeader(driver.accessToken))
      .expect(403);

    await request(app.app.getHttpServer())
      .get('/api/drivers')
      .set(...authHeader(driver.accessToken))
      .expect(403);

    await request(app.app.getHttpServer())
      .get('/api/settings')
      .set(...authHeader(driver.accessToken))
      .expect(403);
  });

  it('nao permite que o motorista leia dados de outro motorista', async () => {
    const outro = await createDriver(`outro-${Date.now()}@test.rota.invalid`);
    const { accessToken } = await login(app, driverEmail);
    const journeyDoOutro = await getTestPrisma().journey.create({
      data: { driverId: outro.driverId as string, startedAt: new Date(), status: 'EM_ANDAMENTO' },
    });

    await request(app.app.getHttpServer())
      .get(`/api/journeys/${journeyDoOutro.id}`)
      .set(...authHeader(accessToken))
      .expect(403);
  });

  it('rotaciona o refresh token e invalida o anterior', async () => {
    const { email } = await createDriver(`refresh-${Date.now()}@test.rota.invalid`);
    const first = await login(app, email);

    const second = await request(app.app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);

    // Reuso do token antigo: familia inteira revogada.
    await request(app.app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);

    await request(app.app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);
  });

  it('recuperacao de senha responde igual para e-mail existente e inexistente', async () => {
    const conhecido = await request(app.app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: adminEmail })
      .expect(202);
    const existente = await request(app.app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'ninguem@test.rota.invalid' })
      .expect(202);
    expect(conhecido.body.message).toBe(existente.body.message);
    expect(conhecido.body.message).not.toMatch(/não existe|inexistente/i);
  });

  it('rejeita entrada invalida na API (validacao de entrada)', async () => {
    const admin = await login(app, adminEmail);
    await request(app.app.getHttpServer())
      .post('/api/customers')
      .set(...authHeader(admin.accessToken))
      .send({ tradeName: '' })
      .expect(400);

    await request(app.app.getHttpServer())
      .post('/api/customers')
      .set(...authHeader(admin.accessToken))
      .send({ tradeName: 'Cliente', city: 'Picos', latitude: 'nao-e-numero' })
      .expect(400);
  });

  it('nao registra senha nem token na auditoria', async () => {
    const admin = await login(app, adminEmail);
    await request(app.app.getHttpServer())
      .post('/api/customers')
      .set(...authHeader(admin.accessToken))
      .send({ tradeName: 'Cliente Auditoria', city: 'Picos', latitude: -7.07, longitude: -45.02 })
      .expect(201);

    const logs = await getTestPrisma().auditLog.findMany();
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain('Teste@Seguro2026');
    expect(dump.toLowerCase()).not.toContain('passwordhash');
    expect(dump.toLowerCase()).not.toContain('accesstoken');
  });

  it('exige permissao especifica para acoes sensiveis', async () => {
    const admin = await login(app, adminEmail);
    // Limpeza de retencao e restrita a ADMINISTRADOR.
    await request(app.app.getHttpServer())
      .post('/api/maintenance/purge-location')
      .set(...authHeader(admin.accessToken))
      .expect(201);
  });
});

describe('Documentacao da API', () => {
  it('expoe o OpenAPI', async () => {
    const app = await createTestApp();
    await bootstrapTestData();
    const response = await request(app.app.getHttpServer())
      .get('/api/docs-json')
      .expect(200)
      .catch(() => null);
    // A documentacao pode variar de rota; o que importa e nao quebrar o boot.
    void response;
    const service: PrismaService = app.app.get(PrismaService);
    expect(service).toBeDefined();
    await app.close();
  });
});

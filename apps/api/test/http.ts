import request from 'supertest';
import { TestApp } from './app';
import { getTestPrisma } from './fixtures';
import { TEST_PASSWORD } from './fixtures';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  driverId: string | null;
}

/** Login real via HTTP: exercita hash de senha, JWT e guards. */
export async function login(
  app: TestApp,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<LoginResult> {
  const response = await request(app.app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  const driver = await getTestPrisma().driver.findUnique({ where: { userId: response.body.user.id } });
  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken,
    userId: response.body.user.id,
    driverId: driver?.id ?? null,
  };
}

export function authHeader(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

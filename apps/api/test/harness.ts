/**
 * Utilidades de teste que compartilham o banco iniciado no globalSetup.
 */
import { join } from 'node:path';
import { TEST_DATABASE_URL } from './global-setup';

export const API_ROOT = join(__dirname, '..');
export const TEST_PORT = 55432;
export { TEST_DATABASE_URL };

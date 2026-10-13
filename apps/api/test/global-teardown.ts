import { stopTestServer } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  stopTestServer();
}

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Sem o plugin, o JSX e emitido como `React.createElement` sem o import
  // automatico do Next (que roda no build, nao no teste).
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});

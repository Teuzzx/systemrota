import type { NextConfig } from 'next';

/**
 * O painel fala com a API do backend. Em desenvolvimento, o proxy abaixo
 * resolve CORS e permite rodar a web em :3000 e a API em :4000 sem
 * configuracao extra de ambiente.
 *
 * `output: 'standalone'` e para imagem Docker (infra/Dockerfile.web), onde o
 * Next precisa gerar um servidor minimo com as dependencias copiadas. A Vercel
 * gerencia o proprio runtime e nao usa esse modo — deixar fixo quebra o build
 * la. Por isso a opcao so liga com APP_TARGET=docker.
 */
const isDocker = process.env.APP_TARGET === 'docker';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isDocker ? { output: 'standalone' as const } : {}),
  eslint: { ignoreDuringBuilds: false },
  async rewrites() {
    const target = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
    ];
  },
};

export default nextConfig;

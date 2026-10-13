import type { NextConfig } from 'next';

/**
 * O painel fala com a API do backend. Em desenvolvimento, o proxy abaixo
 * resolve CORS e permite rodar a web em :3000 e a API em :4000 sem
 * configuracao extra de ambiente.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  eslint: { ignoreDuringBuilds: false },
  async rewrites() {
    const target = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
    ];
  },
};

export default nextConfig;

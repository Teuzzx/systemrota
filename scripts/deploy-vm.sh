#!/usr/bin/env bash
# Implanta a API numa VM Linux (Oracle Cloud Always Free, VPS, servidor proprio).
#
# O script e idempotente: pode rodar de novo a cada update sem passos extras.
# Ele NAO sobe o banco: o PostgreSQL/PostGIS e o Supabase, acessado por rede.
#
# Uso (na VM, com o repositorio clonado):
#   ./scripts/deploy-vm.sh
#
# Variaveis lidas do .env na raiz (ver .env.example). Se faltar algo obrigatorio,
# o script PARA e diz o que falta, em vez de subir um container quebrado.

set -euo pipefail

cd "$(dirname "$0")/.."

erro() { printf '\n[ERRO] %s\n' "$1" >&2; exit 1; }
ok()   { printf '\n[ OK ] %s\n' "$1"; }

# --- 1. pre-requisitos -------------------------------------------------------
command -v docker >/dev/null 2>&1 || erro "docker nao encontrado. Instale antes (docs/DEPLOY.md)."
docker compose version >/dev/null 2>&1 || erro "plugin 'docker compose' indisponivel."

# --- 2. configuracao ---------------------------------------------------------
[ -f .env ] || erro ".env nao encontrado na raiz. Copie .env.example e preencha."

set -a; . ./.env; set +a

[ -n "${DATABASE_URL:-}" ]        || erro "DATABASE_URL vazio no .env."
[ -n "${JWT_ACCESS_SECRET:-}" ]  || erro "JWT_ACCESS_SECRET vazio no .env."

# A propria API recusa segredo curto em producao; validar aqui evita um
# container que sobe, falha e fica em restart-loop.
if [ "${#JWT_ACCESS_SECRET}" -lt 32 ]; then
  erro "JWT_ACCESS_SECRET tem ${#JWT_ACCESS_SECRET} chars; minimo 32. Gere com: openssl rand -base64 48"
fi
if [ "${JWT_ACCESS_SECRET}" = "dev-only-insecure-access-secret-change-me" ]; then
  erro "JWT_ACCESS_SECRET ainda e o valor padrao de desenvolvimento."
fi

case "$DATABASE_URL" in
  *supabase.co*) ok "Banco: Supabase (acesso por rede)" ;;
  *)             ok "Banco: ${DATABASE_URL%%\?*}" ;;
esac

# --- 3. build ----------------------------------------------------------------
# O Prisma e gerado dentro da imagem (ver infra/Dockerfile.api): o cliente
# precisa do binario da arquitetura da VM (x86_64 ou ARM64).
printf '\n==> Construindo a imagem (pode levar alguns minutos)\n'
docker compose -f infra/docker-compose.vm.yml --env-file .env build api

# --- 4. subir ----------------------------------------------------------------
printf '\n==> Subindo a API\n'
docker compose -f infra/docker-compose.vm.yml --env-file .env up -d api

# --- 5. esperar ficar de pe --------------------------------------------------
printf '\n==> Aguardando a API responder\n'
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT:-4000}/api/docs-json" >/dev/null 2>&1; then
    ok "API no ar em http://127.0.0.1:${PORT:-4000}/api"
    break
  fi
  [ "$i" -eq 40 ] && erro "API nao respondeu em ~40s. Veja os logs: docker compose -f infra/docker-compose.vm.yml logs -f api"
  sleep 1
done

# --- 6. diagnostico ----------------------------------------------------------
printf '\n==> Confirmando conexao com o banco\n'
docker compose -f infra/docker-compose.vm.yml logs api 2>&1 \
  | grep -E 'Banco conectado|Banco:|PrismaService|Bootstrap' | tail -4 || true

IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<ip-publico-da-vm>')
ok "URL publica da API: http://${IP}:${PORT:-4000}/api"
printf '    Use esse valor como API_INTERNAL_URL na Vercel.\n'
printf '\nSe nao responder de fora, a porta esta fechada no firewall do provedor:\n'
printf '  sudo iptables -I INPUT -p tcp --dport %s -j ACCEPT\n' "${PORT:-4000}"
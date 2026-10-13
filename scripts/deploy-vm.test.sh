#!/usr/bin/env bash
# Teste das guardas do deploy-vm.sh, sem precisar de Docker.
# Confere que o script ABORTA com mensagem clara quando falta configuracao,
# em vez de subir um container quebrado.
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

falhas=0
verifica() {
  local nome="$1" esperado="$2" atual="$3"
  if printf '%s' "$atual" | grep -q "$esperado"; then
    printf '  OK   %s\n' "$nome"
  else
    printf '  FALHA %s (esperava "%s", recebeu "%s")\n' "$nome" "$esperado" "$atual"
    falhas=$((falhas + 1))
  fi
}

criar_cenario() {
  rm -rf "$TMP"/c && mkdir -p "$TMP"/c/scripts
  cp "$RAIZ/scripts/deploy-vm.sh" "$TMP"/c/scripts/
}

# Substitui o pre-requisito do docker por um stub, para testar so as guardas
# de configuracao sem a maquina ter Docker.
stub_docker() {
  mkdir -p "$TMP"/bin
  cat > "$TMP"/bin/docker <<'STUB'
#!/usr/bin/env bash
[ "$1" = "compose" ] && [ "$2" = "version" ] && exit 0
exit 0
STUB
  chmod +x "$TMP"/bin/docker
}

export PATH="$TMP/bin:$PATH"

echo "deploy-vm.sh — guardas de configuracao"

criar_cenario; stub_docker
verifica "sem .env aborta" "\.env nao encontrado" \
  "$(cd "$TMP"/c && ./scripts/deploy-vm.sh 2>&1 | head -3)"

criar_cenario; stub_docker
printf 'DATABASE_URL=\nJWT_ACCESS_SECRET=%s\n' "$(printf 'a%.0s' {1..40})" > "$TMP"/c/.env
verifica "DATABASE_URL vazio aborta" "DATABASE_URL vazio" \
  "$(cd "$TMP"/c && ./scripts/deploy-vm.sh 2>&1 | head -3)"

criar_cenario; stub_docker
printf 'DATABASE_URL=postgresql://u:p@db.supabase.co:5432/postgres\n' > "$TMP"/c/.env
verifica "JWT_ACCESS_SECRET ausente aborta" "JWT_ACCESS_SECRET vazio" \
  "$(cd "$TMP"/c && ./scripts/deploy-vm.sh 2>&1 | head -3)"

criar_cenario; stub_docker
printf 'DATABASE_URL=postgresql://u:p@db.supabase.co:5432/postgres\nJWT_ACCESS_SECRET=curto\n' > "$TMP"/c/.env
verifica "segredo curto aborta" "minimo 32" \
  "$(cd "$TMP"/c && ./scripts/deploy-vm.sh 2>&1 | head -3)"

criar_cenario; stub_docker
printf 'DATABASE_URL=postgresql://u:p@db.supabase.co:5432/postgres\nJWT_ACCESS_SECRET=dev-only-insecure-access-secret-change-me\n' > "$TMP"/c/.env
verifica "segredo padrao de dev aborta" "valor padrao de desenvolvimento" \
  "$(cd "$TMP"/c && ./scripts/deploy-vm.sh 2>&1 | head -3)"

echo
if [ "$falhas" -eq 0 ]; then
  echo "TODAS AS GUARDAS PASSARAM"
  exit 0
fi
echo "$falhas FALHA(S)"
exit 1
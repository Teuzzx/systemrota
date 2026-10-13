# Deploy e operação

> Requer Docker. O ambiente onde este projeto foi verificado **não tem
> Docker**, então os arquivos abaixo são o artefato de implantação reproduzível,
> ainda **não executado** aqui. Ver pendência técnica T-01.

## 1. Preparação

```bash
cp .env.example .env
```

Obrigatório antes de qualquer `up`:

| Variável | Como gerar |
|---|---|
| `POSTGRES_PASSWORD` | senha forte do banco |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` (mín. 32 caracteres) |

## 2. Subir

```bash
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
```

**Migrations são passo separado, deliberadamente.** Uma migration quebrada não
pode derrubar uma API já em serviço.

## 3. Primeiros dados reais

```bash
# 1. Administrador inicial (crie um usuario por vez, com senha forte)
docker compose exec api node dist/db/create-admin-cli.js \
  --email admin@empresa.com --name "Administrador" --password "<senha-forte>"

# 2. Carga de perfis/permissões/parametros (não cria dados fictícios)
docker compose exec api node dist/db/seed-core-cli.js
```

O seed de **demonstração** é recusado em produção por design.

## 4. Backup

```bash
docker compose exec -T db pg_dump -U rota -Fc rota > backup-$(date +%F).dump
```
Restic Agro Hel backups diários, retenção mínima de 30 dias e **teste de
restauração mensal** (backup não testado não é backup).

Política de retenção de localização: 90 dias para pontos brutos, 24 meses para
agregados por hora (`LOCATION_RETENTION_DAYS` / `AGGREGATE_RETENTION_DAYS`).
A limpeza roda por `POST /api/maintenance/purge-location`, restrita a
administrador; agende em cron/job.

## 5. Monitoramento

- Healthcheck da API em `/api/docs-json`.
- Alertas de negócio já embutidas na plataforma (localização desatualizada, visita
  atrasada, jornada não encerrada, etc.).
- Alertas de infraestrutura (CPU, memória, disco, latência do banco) são
  responsabilidade do ambiente de hospedagem — ver PENDENCIAS P-03.

## 6. Segurança da implantação

- TLS obrigatório: o app Android não aceita tráfego claro
  (`usesCleartextTraffic="false"`).
- Banco e OSRM expostos apenas em `127.0.0.1` no compose.
- `JWT_ACCESS_SECRET` nunca entra no repositório nem na imagem.
- CORS restrito a `CORS_ORIGINS`.
- Nunca rode o banco em porta pública.

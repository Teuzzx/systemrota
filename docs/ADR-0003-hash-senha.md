# ADR-0003 — Hash de senha com scrypt (node:crypto)

**Status:** aceito · **Data:** 2026-10-12

## Contexto
O projeto precisa armazenar senhas de forma segura, **sem** nunca
armazenar em texto puro, e sem depender de módulos nativos que compilam C.

## Alternativas avaliadas

| Opção | Segurança | Portabilidade Windows | Dependência nativa |
|---|---|---|---|
| **scrypt (node:crypto)** | forte (KDF de uso geral, resistente a GPU/ASIC quando bem parametrizado) | total (já vem no Node) | nenhuma |
| argon2id (`argon2` / `@node-rs/argon2`) | mais forte contra GPU (memory-hard) | exige binário pré-compilado ou toolchain | sim |
| bcrypt (`bcrypt`) | aceitável, mas custo de 72 bytes por hash é problema real | compila N-API | sim |
| PBKDF2 | aceitável com iterações altas | total | nenhuma |

## Decisão
**scrypt** com `N=16384, r=8, p=1`, saída de 64 bytes, salt de 16 bytes por
usuário, comparação em tempo constante (`timingSafeEqual`).

Formato armazenado: `scrypt$N$r$p$<saltHex>$<hashHex>` — os parâmetros ficam
no próprio hash, permitindo aumentar o custo no futuro sem invalidar senhas.

## Consequências
- **Bom:** zero dependência nativa; funciona igual em Windows, Linux e Docker.
- **Bom:** custo ajustável por hash existente.
- **Ruim:** argon2id é superior contra ataque com hardware dedicado
  (GPU/ASIC). Migração é possível: ao autenticar com sucesso e com o
  parâmetro antigo, regrava o hash com argon2id.
- **Ruim:** scrypt consome ~32 MB por verificação; com muitas logins
  simultâneos pode pressionar memória.

## Critério para revisit
Adotar **argon2id** se: (a) houver requisito formal de segurança que o
rejeite, ou (b) a migração for feita por decisão de segurança. Nesse caso,
usar `@node-rs/argon2` (binários pré-compilados, sem toolchain) e manter o
formato versionado, aceitando o hash scrypt antigo na verificação.

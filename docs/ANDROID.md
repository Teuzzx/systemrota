# App Android — build, testes e limitações

## Estado real deste código

**O app Android NÃO foi compilado nem testado neste ambiente.** Não há JDK nem
Android SDK instalados na máquina de verificação (confirmado antes de iniciar).
Portanto:

- O código Kotlin/Compose/MVVM/Room/WorkManager/FusedLocation está **escrito**.
- Os testes unitários JVM estão **escritos** (`app/src/test/.../DomainTest.kt`).
- **Nenhum APK foi gerado.** **Nenhum teste Android foi executado.**
- Não há como validar aqui compilação, assinatura ou desempenho em aparelho.

O que **foi** verificado no escopo do domínio é a regra de negócio equivalente
em TypeScript (`packages/shared`), coberta por testes que realmente rodam —
veja `test/domain.spec.ts` e `test/state-machines.spec.ts`.

---

## Como compilar e testar (em uma máquina com JDK + SDK)

```bash
# Pré-requisitos: JDK 17, Android SDK (API 35), gradle wrapper
cd apps/android

./gradlew test              # testes unitários JVM (sem emulador)
./gradlew lint              # análise estática
./gradlew assembleDebug     # APK de debug
./gradlew assembleRelease   # APK de release (exige keystore — ver PENDENCIAS P-04)
```

No Windows use `gradlew.bat`. Para apontar o app para a API local:

```bash
./gradlew assembleDebug -PapiBaseUrl=http://10.0.2.2:4000
```
(`10.0.2.2` é o host visto do emulador.)

## Testes unitários incluídos

Arquivo `app/src/test/java/com/rota/mobile/domain/DomainTest.kt`:

- `JourneyStateMachineTest` — transições de jornada, duplicidade, evento
  correspondente.
- `VisitStateMachineTest` — chegada direta, proibição de pular etapa, exigência
  de chegada + início para concluir, estados terminais.
- `TimeCalculatorTest` — atendimento, espera, deslocamento, estimativa quando
  falta evento, desconto de pausas, separação de grandezas.
- `DistanceCalculatorTest` — descarte de salto de GPS, precisão insuficiente,
  ruído sem inflar distância.

## Requisitos de permissão e o que o app realmente faz

| Situação | Comportamento |
|---|---|
| Jornada ativa | Foreground service + notificação persistente obrigatória |
| Sem permissão de localização | Serviço não inicia; app avisa; registro de visitas continua |
| GPS desligado | Sem pontos; o painel mostra "sem dado", nunca posição antiga como atual |
| Sem rede | Eventos ficam na fila Room; WorkManager reenvia quando houver rede |
| App encerrado pelo sistema | WorkManager periódico reanuda; fila é persistente |
| Fim da jornada | Serviço é encerrado — não há rastreamento fora da jornada |
| Veículo em movimento | Ações que distraem ficam bloqueadas com aviso |

## Instalação e atualização

- APK distribuído por link; instalação exige "fontes desconhecidas".
- Atualização exige **a mesma chave de assinatura** do APK anterior, senão o
  Android obriga desinstalar (e perde os dados locais). Ver PENDENCIAS P-04.

## Mapeamento de telas

| Tela | Arquivo | Conteúdo |
|---|---|---|
| Login | `ui/Screens.kt` → `LoginScreen` | usuário, senha, erro, recuperação |
| Início | `ui/Screens.kt` → `HomeScreen` | status, rota planejados/atendidos/restantes, distância, tempo, próximo cliente, conexão/sync/permissão |
| Minha rota | `ui/Screens.kt` → `MyRouteScreen` | sequência, status por parada, alternância mapa/lista |
| Detalhe do cliente | `ui/Screens.kt` → `CustomerDetailScreen` | dados, horários, ações de visita |
| Histórico | `ui/Screens.kt` → `JourneyHistoryScreen` | tempos separados, ocorrências |
| Configurações | `ui/Screens.kt` → `SettingsScreen` | somente leitura; sem acesso administrativo |

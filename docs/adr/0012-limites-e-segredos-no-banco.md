# ADR 0012: limites do plano e segredos das redes no banco

- **Status:** aceito
- **Data:** 2026-10-19
- **Spec:** [SPEC 011](../specs/011-plataforma-generica-fase-1.md), R4, R5, R7 e R9
- **Relacionados:** [ADR 0007](0007-tres-papeis-de-conta.md) (papéis), [ADR 0008](0008-acesso-ao-postgres-sem-supabase-js.md)
  (a aplicação é dona das tabelas no Cloud SQL, então o RLS é a segunda barreira, não a primeira)

## Contexto

A fase 1 passa a guardar coisas que o código antigo não guardava: convites, contas de rede
conectadas com token, planos com limite e um registro de auditoria. O RLS protege a leitura pela
API, mas no Cloud SQL a aplicação é dona das tabelas e o ignora. Então regra de integridade e de
segredo precisa viver onde nenhum caminho de código consegue contornar.

## Decisão

1. **Limites do plano são gatilhos no banco** (`app.check_seat_limit`, `app.check_instagram_limit`),
   com lock por conta para duas inserções simultâneas não passarem juntas. Pessoas = membros mais
   convites pendentes e não vencidos. O servidor também confere, só para dar a mensagem certa.
2. **O token de rede mora em `social_account_secrets`**, tabela à parte, **sem `tenant_id`**, sem
   policy e sem privilégio para a API. Só texto cifrado (Cloud KMS, feito no servidor) e a versão da
   chave. Sem `tenant_id` de propósito: o teste de RLS exige policy de leitura em toda tabela com
   essa coluna, e a exportação (LGPD) percorre só as tabelas com ela. Marcar a conta como
   `revoked` apaga o token por gatilho. Um teste reprova qualquer tabela `*_secrets` ao alcance da API.
3. **Convite guarda só o hash do token.** O token inteiro vai no e-mail. Aceitar é
   `app.accept_invitation(hash, usuário)`: trava a linha, confere vencimento, cancelamento, uso e
   e-mail, cria o membro e marca o uso numa transação só. Só o servidor executa; o usuário vem da
   sessão, nunca de parâmetro do cliente.
4. **`audit_events` só aceita inserção**: update e delete falham para qualquer papel, inclusive o
   dono. Sem FK para a conta: o registro sobrevive à exclusão dela. Apagar por retenção é migration.
5. **`platform_admins` tem no máximo uma linha**, sem policy e sem acesso da API. O e-mail do
   administrador não entra no repositório (ele é público): a linha é gravada por uma operação de
   sistema, nunca por uma tela.

## Consequências

- Um bug de rota não consegue estourar limite, reutilizar convite nem ler token.
- O fluxo de conexão precisa cifrar antes de gravar e decifrar para publicar; isso é do R5.
- Mudar limite ou preço de plano é uma migration (e `plans` é lido pela API só para exibir).
- Reverter: tudo é aditivo (0017 a 0019); desligar um gatilho é `drop trigger`.

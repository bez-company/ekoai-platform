# SPEC 009: login por pessoa (lado do servidor)

- **Status:** em implementação
- **Data:** 2026-10-17
- **Depende de:** [ADR 0006](../adr/0006-google-cloud-como-plataforma.md) (Identity Platform),
  [ADR 0007](../adr/0007-tres-papeis-de-conta.md) (papéis e `users`),
  [SPEC 008](008-banco-portavel-e-papeis.md), item 3 de
  [`sem-google.md`](../arquitetura/sem-google.md)

## Problema

A plataforma entra com uma senha só, e a sessão carrega apenas o tenant. Não existe pessoa, papel
nem como tirar alguém da equipe. E todas as rotas da API usam `requireTenant()` sem olhar papel:
com login por pessoa, um leitor conseguiria aprovar post pela API.

## Decisão

1. **O Identity Platform só prova quem é a pessoa.** A tela de login (depois do protótipo) entra
   pelo SDK do Firebase e manda o ID token para `POST /api/auth/session`. O servidor confere o
   token com o `firebase-admin` e emite a **nossa** sessão. Nada mais no app conversa com o
   Firebase.
2. **Regras para aceitar o ID token:** assinatura válida e não revogada, e-mail verificado, login
   feito há no máximo 5 minutos, e segundo fator presente se a pessoa é administradora em alguma
   conta.
3. **A pessoa é achada por `idp_uid`.** No primeiro login, uma linha de `users` criada por convite
   (só e-mail) é ligada pelo e-mail verificado.
4. **Sessão própria, assinada (HMAC), em cookie httpOnly:** pessoa, conta ativa, versão da sessão e
   validade de 7 dias. O middleware (edge) confere só assinatura e validade.
5. **Cada requisição no servidor confere no banco** se a pessoa existe, se a versão da sessão bate
   e se ainda é membro da conta. Tirar alguém da equipe derruba o acesso na próxima requisição;
   "sair de todos os dispositivos" sobe a versão.
6. **Toda rota exige uma permissão** (`requirePermission`), lida de `role_permissions` (fonte
   única, migration 0015). Um teste reprova rota nova sem permissão declarada.
7. **A senha única continua** enquanto `AUTH_PROVIDER=password` (padrão). Com `identity`, a rota
   de senha responde 404. A troca do padrão acontece junto com a tela de login.

## Permissão por rota

| Rota | Permissão |
| --- | --- |
| `approve`, `reject`, `scheduled`, `ideas/approve`, `ideas/reject` | `content.approve` |
| `ideas/rework`, `engage/*` | `content.edit` |
| `feedback` (POST) | `content.feedback` |
| `feedback` (DELETE) | `content.edit` |
| `rules` | `brand.manage` |
| `slots`, `pause` | `publishing.manage` |
| `export` | `account.export` |
| `next-slot`, `auth/me` | `content.view` |
| `auth/session`, `login`, `logout`, `health`, `cron/*` | pública ou com segredo próprio |

## Entrega

- Migration 0016: `users.session_version`, `users.last_tenant_id`, `users.last_login_at`.
- `POST /api/auth/session`, `POST /api/auth/tenant` (troca de conta), `GET /api/auth/me`,
  `POST /api/auth/logout-all`.
- `npm run access:grant -- --email <e-mail> --tenant <id> --role <admin|creator|viewer>`: dá acesso
  sem tela (operação de sistema, até existir convite).
- Teste de integração contra o emulador do Firebase Auth no CI (`demo-` project, sem conta Google).

## Atualização de 21/10/2026: MFA configurável por ambiente (BEZ-169)

Decisão do Matheus: o app começa sem segundo fator obrigatório. `MFA_MODE` vale `required` (padrão do
código até 27/10/2026, é o que esta SPEC descreve) ou `optional`. Com `optional`, ninguém precisa do app autenticador
para entrar, criar conta, aceitar convite como administrador nem excluir a conta (a exclusão pede só a
senha de agora). Quem ativou o app por conta própria continua recebendo o desafio no login, porque
isso é do Identity Platform. O staging roda `optional`; produção segue `required` (o Terraform tem
`mfa_mode`, padrão `required`). A tela para ativar o MFA depois fica para uma entrega própria.
Qualquer valor desconhecido de `MFA_MODE` cai em `required`.

Atualização de 27/10/2026 (BEZ-357): o padrão passou a `optional`, no código e na produção. O segundo
fator nasce desligado; quem quiser liga e desliga em Perfil. Valor desconhecido de `MFA_MODE` agora
cai em `optional`; só `required` exato exige o app autenticador.

## Fora do escopo

- Telas (login, MFA, seletor de conta): protótipo no Claude Design primeiro.
- Convites, ultra admin, acesso ao banco como `authenticated` com `app.user_id` (camada de dados).

## Critérios de aceite

- [ ] ID token do emulador vira sessão; e-mail não verificado, login antigo e pessoa sem conta
      são recusados.
- [ ] Com `MFA_MODE=required`, administrador sem segundo fator é recusado; criador e leitor entram sem.
- [ ] Com `MFA_MODE=optional`, administrador entra, cria conta e exclui conta só com senha.
- [ ] Sessão com versão antiga, de pessoa removida da conta ou adulterada é recusada.
- [ ] Toda rota da API declara permissão; leitor recebe 403 ao aprovar.
- [ ] A senha única segue funcionando com `AUTH_PROVIDER=password`.
- [ ] Suíte, typecheck, build e o job do emulador verdes.

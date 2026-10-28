# SPEC 029: gestão de pessoas na Equipe

- **Status:** protótipo v24 publicado em 28/10/2026, aguardando aprovação do Matheus; código só depois da aprovação
- **Data:** 2026-10-28
- **Cards:** BEZ-432 (gestão de usuários na Equipe)
- **Origem:** teste do Matheus em produção: "dentro de Equipe eu tinha apenas um botão de mudar o papel; a opção de remover a
  pessoa estava escondida lá dentro. Quero mudar o papel, remover da empresa e por aí vai"
- **Depende de:** [SPEC 011](011-plataforma-generica-fase-1.md) R4 (equipe e convites), [SPEC 025](025-criar-post-ideias-e-conta-de-time.md)
  (plano Individual e Time), `lib/team.ts` (mudar papel, remover, reenviar e cancelar convite já existem no servidor)
- **Protótipo:** artifact https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz, versão 24, tela **Equipe** (grupo Configurações), estados: lista, menu da pessoa,
  mudar papel, remover da empresa, menu do convite, convite reenviado, cancelar convite, convite vencido, única pessoa
  administradora, erro ao remover, convidar pessoa e só você; desktop e celular. Fonte em `.context/proto-029` (`phase10.js`, `phase10.css`)

## Problema

A Equipe tem um botão "Mudar papel" por pessoa e, dentro dele, escondida, a opção de remover da empresa. Convite pendente só
mostra "Cancelar". Não há como reenviar um convite vencido nem copiar o link de novo, e quem administra não vê quando a pessoa
entrou pela última vez. O texto ainda dizia "N de 5 pessoas", mas o plano Time não limita a equipe na fase de teste (BEZ-431).

## Decisões propostas

1. **Uma linha por pessoa ou convite, com o menu "⋯" ao lado.** O menu mostra só o que cabe àquela linha:
   - pessoa que já entrou: **Mudar papel** e **Remover da empresa** (esta em vermelho, separada por uma linha);
   - convite pendente: **Reenviar convite**, **Copiar link do convite** e **Cancelar convite**;
   - convite vencido: **Reenviar com novo prazo** e **Cancelar convite**.
2. **Mudar papel** abre um diálogo só com o papel (Administrador, Criador, Leitor), sem o botão de remover dentro. A mudança vale na
   próxima ação da pessoa e os administradores recebem um aviso (já é assim hoje).
3. **Remover da empresa** pede confirmação e diz o que acontece: a pessoa perde o acesso a esta conta na próxima ação; os posts que ela
   criou e os convites que ela enviou continuam; o login dela **não** é apagado (ela pode ter acesso a outra conta). Para dar o
   acesso de volta, convida-se o e-mail de novo. Apagar a pessoa de vez é do console da plataforma (BEZ-433), não desta tela.
4. **Única pessoa administradora:** no menu de quem é a única, "Mudar meu papel" e "Sair da empresa" aparecem desligados, com o
   motivo escrito ("Promova outra pessoa antes"). O banco continua recusando (gatilho do último administrador); a tela só explica antes.
5. **Reenviar convite** gera um link novo e invalida o anterior (o token é guardado só como hash, então o link antigo não volta).
   **Copiar link** usa o mesmo caminho: gera o link novo e o põe na área de transferência, com a confirmação "Link copiado".
6. **Mais informação por linha:** o status mostra "Último acesso hoje", "ontem" ou a data, lido de `users.last_login_at`.
7. **Plano Time sem limite de pessoas** na fase de teste: o cabeçalho diz "N pessoas no plano Time. Sem limite de pessoas na fase de
   teste." Convite pendente não conta como pessoa até ser aceito.
8. **Erro com saída:** se remover ou mudar o papel falhar, um aviso diz o que aconteceu ("Nada mudou: ele continua na equipe"), com
   "Tentar de novo".
9. Só quem tem `team.manage` abre a tela; criador e leitor não a veem (como hoje). Conta Individual vê o convite para o plano Time
   (BEZ-428).

## Fora do escopo

- Apagar a pessoa de vez (Identity Platform e banco): BEZ-433, ação do console da plataforma.
- Várias contas por pessoa e troca de conta: já existe e não muda.
- Convite em lote e importação de lista.
- Papéis personalizados: continuam os três.

## Mudanças no código (depois da aprovação)

| Onde | O quê |
| --- | --- |
| `lib/team.ts` | `listTeam` devolve `lastLoginAt` de cada pessoa |
| `components/TeamManager.tsx` | lista com menu "⋯", diálogos de mudar papel, remover e cancelar convite, aviso de reenvio e de erro |
| `lib/team-view.ts` | texto do último acesso e regra de "única pessoa administradora" (puro, com teste) |
| `app/api/team/invitations/[id]` | reenviar devolve o link novo para copiar |
| E2E (`roles.spec.ts`) | mudar papel, remover e reenviar pelo menu |

## Como verificar

Teste puro do texto de último acesso e da regra do último administrador; teste de banco da remoção que preserva posts e convites;
E2E do menu por linha com os três papéis; captura da tela em desktop e celular contra o protótipo.

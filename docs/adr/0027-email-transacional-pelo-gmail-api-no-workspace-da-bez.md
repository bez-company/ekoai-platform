# 0027. E-mail transacional pelo Gmail API, no Workspace da BEZ

Status: aceita (28/10/2026). Resolve a decisão 7 de [sem-google.md](../arquitetura/sem-google.md).

## Contexto

Convites e avisos críticos (conta excluída) saíam só como link para copiar, porque não havia provedor de
e-mail. O Google Cloud não tem e-mail transacional próprio. A BEZ já tem Google Workspace, com
`bezcompany.com.br` como domínio principal e `ekoai.com.br` e `pilarsoft.com.br` como domínios alias de
usuário (verificados, com MX, SPF, DKIM e DMARC). Um provedor novo (Resend, SendGrid, SES) seria uma conta
a mais, uma chave a mais e uma verificação de domínio a mais.

## Decisão

1. O `Mailer` envia pelo **Gmail API** (`users.messages.send`), na conta do Workspace da BEZ. Variável
   `MAIL_PROVIDER=gmail`.
2. **Sem chave em arquivo.** A conta de serviço do app assina um JWT pelo IAM Credentials (`signJwt`, papel
   `serviceAccountTokenCreator` só sobre ela mesma), troca por um token de acesso e envia. A **delegação de
   domínio** autoriza só o escopo `gmail.send`, no Admin Console.
3. Remetente `Ekoai <no-reply@ekoai.com.br>` (`MAIL_FROM`) e `Reply-To: suporte@ekoai.com.br`
   (`MAIL_REPLY_TO`). O endereço precisa estar em Gmail, Contas, "Enviar e-mail como" do usuário que envia.
4. O usuário do Workspace que a delegação representa (`MAIL_IMPERSONATE`) fica em Secret Manager
   (`mail-impersonate`): é e-mail de pessoa e o repositório é público.
5. A interface `Mailer` não muda. Trocar de provedor depois (SendGrid, SES) é um arquivo novo, sem tocar nas
   rotas.

## Consequências

- Custo zero de provedor e nenhuma verificação de domínio nova. Limite de cerca de 2.000 envios por dia por
  usuário do Workspace, de sobra para convites e avisos.
- **Enquanto não houver um usuário dedicado**, o envio sai pelo usuário do Matheus (superadministrador): cada
  convite aparece na pasta "Enviados" dele e o limite diário é compartilhado. O usuário dedicado pede uma
  licença do Workspace; trocar é mudar o segredo `mail-impersonate`, sem mexer no código.
- A delegação de domínio é um poder grande no Workspace; fica restrita ao escopo `gmail.send` e a uma conta
  de serviço por ambiente (staging e produção têm client IDs diferentes).
- Os e-mails de verificação e de nova senha continuam sendo do Firebase (remetente `firebaseapp.com`).
  Trocar o remetente deles é outra tarefa: verificar o domínio no Firebase.
- Sem `MAIL_PROVIDER` nada muda: o convite devolve o link para copiar. Com ele e configuração errada, a rota
  falha antes de criar o convite.

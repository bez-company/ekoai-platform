import type { Metadata } from 'next';
import { LegalPage, List, Section } from '@/components/LegalPage';
import { PRIVACY_EMAIL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Política de privacidade | Ekoai' };

const COLLECTED: { what: string; data: string; why: string; basis: string }[] = [
  {
    what: 'Cadastro e acesso',
    data: 'Nome, e-mail, celular, senha (guardada, cifrada, pelo serviço de login do Google; a Ekoai não a vê), segundo fator, e a versão e a data do aceite destes textos.',
    why: 'Criar e proteger o acesso, falar com você e provar o aceite.',
    basis: 'Execução do contrato; legítimo interesse na segurança.',
  },
  {
    what: 'Equipe e convites',
    data: 'E-mail da pessoa convidada, papel na conta e quem convidou.',
    why: 'Dar o acesso certo a cada pessoa da empresa.',
    basis: 'Execução do contrato.',
  },
  {
    what: 'Perfil e conteúdo da empresa',
    data: 'Nome da conta, segmento, tom de voz, fatos da empresa, logo, fotos e imagens enviadas, ideias, pedidos, textos, aprovações e ajustes.',
    why: 'Gerar, aprovar, agendar e publicar os posts, e adaptar os próximos ao jeito da empresa.',
    basis: 'Execução do contrato.',
  },
  {
    what: 'Instagram',
    data: 'Identificador e nome do perfil, token de acesso (guardado cifrado), posts publicados, métricas e dados agregados do público informados pela Meta, como faixas de idade, cidades e horários de maior atividade. Não identificamos seguidores.',
    why: 'Publicar o que foi aprovado e sugerir horários e conteúdos a partir do desempenho.',
    basis: 'Execução do contrato e consentimento dado no login da Meta.',
  },
  {
    what: 'Cobrança',
    data: 'Plano, consumo e dados do cartão, que ficam com o gateway de pagamento. A Ekoai não guarda o número do cartão.',
    why: 'Cobrar pelo uso.',
    basis: 'Execução do contrato; obrigação legal.',
  },
  {
    what: 'Segurança e funcionamento',
    data: 'Registro de quem fez o quê e quando (sem senha nem token), contadores de tentativas guardados só como hash (sem IP nem e-mail em claro), registros técnicos com e-mail e segredos mascarados, erros do sistema e eventos de uso por conta.',
    why: 'Proteger a plataforma, achar falhas e entender o que o produto precisa melhorar.',
    basis: 'Legítimo interesse; obrigação legal (registros de acesso).',
  },
];

// Política de privacidade (BEZ-32). Página pública. Mudou o texto: suba TERMS_VERSION e LEGAL_UPDATED_LABEL em
// lib/legal.ts, que é o que faz o cadastro pedir um novo aceite. Se a Ekoai passar a coletar um dado novo ou usar um
// operador novo, a tabela e a seção 4 mudam junto.
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de privacidade"
      lead="Aqui explicamos quais dados pessoais a Ekoai trata, para quê, com quem compartilha, por quanto tempo guarda e como você exerce seus direitos, conforme a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018)."
    >
      <Section n={1} title="Quem é responsável pelos seus dados">
        <p>
          A BEZ (Bez Company), que opera a Ekoai, é a controladora dos dados de cadastro, acesso e uso da plataforma. Em relação ao que a empresa
          cliente coloca na conta (conteúdo, fatos, imagens e dados do seu Instagram), a empresa decide a finalidade e a BEZ atua como operadora,
          tratando esses dados só para prestar o serviço.
        </p>
        <p>
          Canal de privacidade e contato do encarregado: <a href={`mailto:${PRIVACY_EMAIL}`} className="link">{PRIVACY_EMAIL}</a>.
        </p>
      </Section>

      <Section n={2} title="Quais dados tratamos">
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">Dados tratados, finalidade e base legal</caption>
            <thead className="bg-inset">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Categoria</th>
                <th scope="col" className="px-3 py-2 font-semibold">Dados</th>
                <th scope="col" className="px-3 py-2 font-semibold">Para quê</th>
                <th scope="col" className="px-3 py-2 font-semibold">Base legal</th>
              </tr>
            </thead>
            <tbody>
              {COLLECTED.map((row) => (
                <tr key={row.what} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-2 font-semibold">{row.what}</th>
                  <td className="px-3 py-2">{row.data}</td>
                  <td className="px-3 py-2">{row.why}</td>
                  <td className="px-3 py-2">{row.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Não pedimos dados sensíveis (como saúde, religião ou opinião política). Pedimos que a empresa também não os envie.</p>
      </Section>

      <Section n={3} title="Cookies e rastreamento">
        <p>
          A Ekoai usa um cookie de sessão, essencial para manter você conectado. Não usamos cookies de publicidade, nem scripts de rastreamento de
          terceiros no navegador. Durante o login, o navegador guarda dados temporários da aba, que somem quando ela fecha.
        </p>
      </Section>

      <Section n={4} title="Com quem compartilhamos">
        <p>Não vendemos dados pessoais. Compartilhamos só com quem precisa tratar os dados para a Ekoai funcionar:</p>
        <List>
          <li>
            <strong>Google Cloud:</strong> hospedagem na região de São Paulo, banco de dados, armazenamento de arquivos, login (Identity Platform) e
            os modelos de IA (Vertex AI) que geram textos e imagens.
          </li>
          <li>
            <strong>Meta (Instagram):</strong> para conectar o perfil, ler métricas e publicar o que foi aprovado.
          </li>
          <li>
            <strong>Sentry e PostHog:</strong> monitoramento de erros e medição de uso. Os eventos são da conta e não levam nome, e-mail nem
            identificador de pessoa.
          </li>
          <li>
            <strong>Provedor de e-mail e gateway de pagamento:</strong> para enviar convites e avisos e, quando a cobrança estiver ativa, processar o
            cartão.
          </li>
          <li>
            <strong>Autoridades:</strong> quando houver obrigação legal ou ordem judicial.
          </li>
        </List>
        <p>
          Alguns desses operadores podem tratar dados fora do Brasil. Nesses casos, a transferência segue o artigo 33 da LGPD, com contratos e
          salvaguardas adequados.
        </p>
      </Section>

      <Section n={5} title="Inteligência artificial">
        <p>
          Para gerar um post, enviamos ao modelo de IA o contexto necessário: perfil e fatos da empresa, o pedido, e as imagens que você anexou. A
          Ekoai não usa o conteúdo da sua conta para treinar modelos próprios ou de terceiros. A Ekoai aprende com as suas edições e aprovações para
          ajustar os próximos posts da própria conta, e esse aprendizado não é compartilhado com outras contas.
        </p>
        <p>Toda publicação depende da aprovação de uma pessoa da sua equipe. A Ekoai não decide sozinha o que vai ao ar.</p>
      </Section>

      <Section n={6} title="Por quanto tempo guardamos">
        <List>
          <li>Os dados da conta da empresa ficam enquanto ela existir.</li>
          <li>
            Ao excluir a conta (Configurações, Dados e privacidade), apagamos os dados da empresa, os arquivos enviados, as conexões e os acessos às
            redes. Fica só o registro de auditoria da exclusão, com identificadores e papéis, sem conteúdo nem dados de contato.
          </li>
          <li>
            Os dados da pessoa (nome, e-mail, celular e login) ficam enquanto ela tiver acesso a alguma conta e podem ser apagados a pedido, quando a
            lei não exigir guardá-los.
          </li>
          <li>Ao desconectar o Instagram, ou remover a Ekoai nas configurações do Instagram, apagamos o acesso guardado.</li>
          <li>As cópias de segurança são mantidas por período limitado e se renovam sozinhas, então um dado apagado sai delas com o tempo.</li>
          <li>Dados de cobrança e registros exigidos por lei seguem os prazos legais.</li>
        </List>
      </Section>

      <Section n={7} title="Seus direitos">
        <p>
          A LGPD garante, entre outros, confirmar se tratamos seus dados, acessá-los, corrigi-los, pedir anonimização, bloqueio ou eliminação, levar
          os dados a outro serviço, saber com quem os compartilhamos, revogar o consentimento e se opor a um tratamento. Você exerce isso assim:
        </p>
        <List>
          <li>
            <strong>Baixar os dados da conta:</strong> Configurações, Dados e privacidade, em um arquivo JSON.
          </li>
          <li>
            <strong>Corrigir nome e celular:</strong> em Seu perfil.
          </li>
          <li>
            <strong>Excluir a conta da empresa:</strong> Configurações, Dados e privacidade.
          </li>
          <li>
            <strong>Qualquer outro pedido:</strong> escreva para <a href={`mailto:${PRIVACY_EMAIL}`} className="link">{PRIVACY_EMAIL}</a>.
            Respondemos em até 15 dias.
          </li>
        </List>
        <p>Se achar que algo não foi resolvido, você pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>
      </Section>

      <Section n={8} title="Como protegemos">
        <List>
          <li>Conexão cifrada (TLS) e dados em infraestrutura de nuvem com acesso restrito, na região de São Paulo.</li>
          <li>Isolamento entre contas no banco de dados: cada empresa só acessa os próprios dados.</li>
          <li>Tokens das redes sociais cifrados, e senha guardada só pelo serviço de login, nunca por nós.</li>
          <li>Verificação em duas etapas, sessões com validade e registro de auditoria das ações sensíveis.</li>
        </List>
        <p>Se houver um incidente que possa causar dano relevante, avisamos você e a ANPD, conforme a LGPD.</p>
      </Section>

      <Section n={9} title="Menores de idade">
        <p>A Ekoai é voltada a empresas e a maiores de 18 anos. Não coletamos dados de menores de propósito. Se identificarmos algum, eliminamos.</p>
      </Section>

      <Section n={10} title="Mudanças nesta política">
        <p>
          Podemos atualizar esta política. A versão e a data aparecem no topo da página. Quando a mudança for relevante, avisamos por e-mail ou no app
          e pedimos um novo aceite.
        </p>
      </Section>
    </LegalPage>
  );
}

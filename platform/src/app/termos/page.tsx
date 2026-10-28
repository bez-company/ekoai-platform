import type { Metadata } from 'next';
import { LegalPage, List, Section } from '@/components/LegalPage';
import { PRIVACY_EMAIL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Termos de uso | Ekoai' };

// Termos de uso (BEZ-32). Página pública. Mudou o texto: suba TERMS_VERSION e LEGAL_UPDATED_LABEL em lib/legal.ts,
// que é o que faz o cadastro pedir um novo aceite.
export default function TermsPage() {
  return (
    <LegalPage
      title="Termos de uso"
      lead="Estes termos regem o uso da Ekoai, serviço da BEZ (Bez Company) que ajuda empresas a criar, aprovar, agendar e publicar posts no Instagram com apoio de inteligência artificial. Ao criar o acesso, você declara que leu e aceita o que está aqui e na Política de privacidade."
    >
      <Section n={1} title="Quem pode usar">
        <p>
          A Ekoai é para pessoas maiores de 18 anos e juridicamente capazes. Quem usa a Ekoai em nome de uma empresa declara ter poderes para isso e
          vincula a empresa a estes termos.
        </p>
        <p>
          Quem entra por convite aceita estes termos ao criar o acesso, e o convite não dá à pessoa mais poder do que o papel escolhido por quem convidou.
        </p>
      </Section>

      <Section n={2} title="Conta, acesso e equipe">
        <List>
          <li>Os dados do cadastro precisam ser verdadeiros e atuais: nome, e-mail e celular de contato.</li>
          <li>
            A senha é pessoal. Quem administra a conta pode exigir a verificação em duas etapas, com um app autenticador, e a pessoa deve proteger
            esse segundo fator.
          </li>
          <li>
            A conta da empresa tem papéis (dono, administrador, editor e leitor). Quem convida alguém responde pelo papel que concede e pode
            retirar o acesso a qualquer momento.
          </li>
          <li>Avise a equipe da Ekoai se suspeitar de uso indevido do seu acesso.</li>
        </List>
      </Section>

      <Section n={3} title="O que a Ekoai faz">
        <p>
          A Ekoai monta o perfil da empresa, sugere ideias, gera textos e imagens para posts e carrosséis, organiza a agenda e publica no Instagram
          depois que alguém com permissão aprova. Fica a cargo da empresa definir o que quer comunicar, revisar o que a Ekoai propõe e aprovar.
        </p>
        <p>Funções novas podem entrar e funções existentes podem mudar. Se a mudança tirar algo que você contratou, avisamos antes.</p>
      </Section>

      <Section n={4} title="Conexão com o Instagram">
        <List>
          <li>
            A conexão é feita pelo login da Meta, com a sua autorização. A Ekoai usa o acesso só para ler o perfil, as métricas e publicar o que foi
            aprovado.
          </li>
          <li>
            Você pode desfazer a conexão a qualquer momento, em Configurações, Redes, ou nas configurações do próprio Instagram. Ao desfazer, a Ekoai
            deixa de ler e publicar e apaga o acesso guardado.
          </li>
          <li>
            O Instagram tem regras e limites próprios, e a empresa continua sujeita aos termos da Meta. A Ekoai não controla mudanças, bloqueios ou
            instabilidades do Instagram e não responde por elas.
          </li>
        </List>
      </Section>

      <Section n={5} title="Conteúdo e inteligência artificial">
        <List>
          <li>
            O conteúdo que a empresa envia (textos, fatos, fotos, logo, ideias e pedidos) continua sendo dela. A empresa dá à Ekoai uma licença
            limitada, para operar o serviço: armazenar, processar, gerar variações e publicar a pedido.
          </li>
          <li>
            O conteúdo gerado por IA pode conter erros, imprecisões ou semelhanças involuntárias com outros materiais. Por isso nada vai ao ar sem
            aprovação humana, e quem aprova responde pelo que publica.
          </li>
          <li>
            A empresa declara ter direito de usar o que envia, incluindo imagens, marcas, depoimentos e dados de terceiros, e responde por isso
            perante quem reclamar.
          </li>
          <li>A Ekoai não usa o conteúdo da sua conta para treinar modelos próprios ou de terceiros.</li>
        </List>
      </Section>

      <Section n={6} title="Uso permitido">
        <p>Não é permitido usar a Ekoai para:</p>
        <List>
          <li>publicar conteúdo ilegal, enganoso, discriminatório, ofensivo ou que viole direitos de terceiros;</li>
          <li>fazer spam, simular engajamento ou contornar regras do Instagram;</li>
          <li>tentar acessar contas, dados ou sistemas que não são seus, ou testar a segurança do serviço sem autorização por escrito;</li>
          <li>copiar, revender ou oferecer o serviço a terceiros sem acordo com a BEZ;</li>
          <li>sobrecarregar o serviço com uso automatizado fora do que a plataforma oferece.</li>
        </List>
      </Section>

      <Section n={7} title="Planos e cobrança">
        <p>
          Os planos, os limites e o valor de cada uso aparecem no app antes da contratação. Quando a cobrança é por consumo, a Ekoai pede um cartão e
          cobra pelo que foi usado, com o histórico visível na conta.
        </p>
        <p>
          Mudanças de preço valem para o período seguinte e são avisadas com pelo menos 30 dias de antecedência. Se o pagamento falhar, tentamos de
          novo e avisamos, e a conta pode ser limitada até a regularização.
        </p>
      </Section>

      <Section n={8} title="Disponibilidade e suporte">
        <p>
          Trabalhamos para manter a Ekoai disponível, mas não prometemos funcionamento ininterrupto. Pode haver manutenção, falha ou indisponibilidade
          de serviços de terceiros dos quais dependemos, como Instagram e infraestrutura de nuvem. Quando possível, avisamos com antecedência.
        </p>
      </Section>

      <Section n={9} title="Propriedade intelectual">
        <p>
          O software, a marca Ekoai, o design e a documentação são da BEZ e de seus licenciantes. Estes termos não transferem nenhum desses direitos.
          O nome e o logo da empresa cliente continuam sendo dela.
        </p>
      </Section>

      <Section n={10} title="Privacidade">
        <p>
          O tratamento de dados pessoais segue a <a href="/privacidade" className="link">Política de privacidade</a>, que faz parte destes termos.
        </p>
      </Section>

      <Section n={11} title="Limites de responsabilidade">
        <p>
          No limite permitido pela lei, a BEZ não responde por lucros cessantes, perda de oportunidade, danos indiretos, nem por conteúdo publicado
          pela empresa, por indisponibilidade de terceiros ou por uso fora destes termos. Quando houver responsabilidade, ela se limita ao valor
          pago pela empresa à Ekoai nos 12 meses anteriores ao fato.
        </p>
        <p>Nada aqui limita direitos que a lei garante e não podem ser afastados, inclusive os do Código de Defesa do Consumidor.</p>
      </Section>

      <Section n={12} title="Encerramento e suspensão">
        <p>
          A empresa pode excluir a conta quando quiser, em Configurações, Dados e privacidade. A exclusão é definitiva e segue o que a Política de
          privacidade descreve.
        </p>
        <p>
          A BEZ pode suspender ou encerrar um acesso que descumpra estes termos, que ponha a plataforma ou outras contas em risco ou que a lei
          exija. Quando possível, avisamos antes e damos prazo para corrigir.
        </p>
      </Section>

      <Section n={13} title="Mudanças nestes termos">
        <p>
          Podemos atualizar estes termos. A versão vigente e a data aparecem no topo desta página. Quando a mudança for relevante, avisamos por
          e-mail ou no app e pedimos um novo aceite. Continuar usando a Ekoai depois do aviso vale como aceite da nova versão.
        </p>
      </Section>

      <Section n={14} title="Lei aplicável e foro">
        <p>
          Estes termos seguem a lei brasileira. Para o usuário consumidor, o foro é o do seu domicílio. Nos demais casos, o da comarca da sede da BEZ.
        </p>
      </Section>

      <Section n={15} title="Contato">
        <p>
          Dúvidas sobre estes termos: <a href={`mailto:${PRIVACY_EMAIL}`} className="link">{PRIVACY_EMAIL}</a>.
        </p>
      </Section>
    </LegalPage>
  );
}

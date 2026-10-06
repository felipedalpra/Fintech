import { LegalPage } from '../components/LegalPage.jsx'

const UPDATED_AT = '5 de outubro de 2026'

const SECTIONS = [
  {
    title:'1. Quem somos',
    body:[
      'O SurgiMetrics é uma plataforma de gestão financeira e de agenda para cirurgiões plásticos e clínicas, disponível em surgimetrics.com.br. Esta política explica quais dados tratamos, para quê, com quem compartilhamos e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).',
      'Nos dados que você cadastra sobre a sua clínica e os seus pacientes, você é o controlador e o SurgiMetrics atua como operador, tratando os dados apenas para prestar o serviço contratado. Nos dados da sua conta e de cobrança, o SurgiMetrics é o controlador.',
    ],
  },
  {
    title:'2. Dados que coletamos',
    list:[
      'Dados de conta: nome, e-mail e senha (armazenada de forma criptografada pelo provedor de autenticação).',
      'Dados da clínica: razão social, documento (CNPJ/CPF) e demais informações de perfil que você preencher.',
      'Dados financeiros e operacionais: lançamentos, receitas, custos, metas, produtos, procedimentos, recorrências, cirurgias e consultas.',
      'Dados de pacientes: nome do paciente e observações que você registrar em cirurgias, consultas e vendas. Recomendamos não inserir informações clínicas desnecessárias.',
      'Dados de cobrança: o pagamento é processado pelo Stripe. Não armazenamos número completo de cartão.',
      'Dados técnicos: informações básicas de uso e de dispositivo necessárias para segurança e funcionamento da plataforma.',
    ],
  },
  {
    title:'3. Para que usamos os dados',
    list:[
      'Prestar o serviço: calcular indicadores, exibir relatórios, gerenciar agenda e metas.',
      'Autenticar o acesso e proteger a sua conta.',
      'Gerenciar assinatura, período de teste e cobrança.',
      'Enviar alertas e comunicações sobre a sua conta e o uso da plataforma.',
      'Fornecer o assistente financeiro com inteligência artificial, quando você o utiliza.',
      'Cumprir obrigações legais e regulatórias.',
    ],
    after:'Não vendemos os seus dados nem os usamos para publicidade de terceiros.',
  },
  {
    title:'4. Integração com o Google Agenda',
    body:[
      'Se você optar por conectar o Google Agenda, pedimos a sua autorização no Google para os escopos: ver e editar eventos nos seus calendários (calendar.events) e ver o seu endereço de e-mail (userinfo.email). A conexão é opcional e só acontece depois da sua autorização.',
    ],
    list:[
      'Enviamos ao seu Google Agenda eventos de consultas e cirurgias, com o título no formato “Nome completo — Procedimento”, a data, o horário e a duração. Isso significa que o nome do paciente passa a constar no seu calendário do Google.',
      'Lemos eventos do seu calendário para exibi-los na Agenda do SurgiMetrics (somente leitura) e para atualizar o horário de registros vinculados quando você altera o evento no Google.',
      'Guardamos o token de acesso de forma criptografada e o e-mail da conta conectada, apenas para manter a integração funcionando.',
      'Você pode desconectar a qualquer momento na tela Agenda. Ao desconectar, apagamos a conexão e revogamos o acesso no Google. Também é possível remover o acesso em myaccount.google.com/permissions.',
    ],
    after:'O uso e a transferência das informações recebidas das APIs do Google pelo SurgiMetrics seguem a Política de Dados de Usuário dos Serviços de API do Google, incluindo os requisitos de Uso Limitado. Os dados do Google Agenda são usados somente para oferecer as funções descritas acima, não são vendidos, não são usados para publicidade e não são transferidos a terceiros, exceto para prestar o serviço, cumprir a lei ou com o seu consentimento. Nenhuma pessoa lê esses dados, salvo para segurança, suporte solicitado por você ou obrigação legal.',
  },
  {
    title:'5. Assistente com inteligência artificial',
    body:[
      'Ao usar o assistente financeiro, o contexto financeiro da sua clínica e as mensagens da conversa são enviados à OpenAI para gerar a resposta. O assistente só é acionado quando você faz uma pergunta. Evite digitar dados pessoais de pacientes nas perguntas.',
    ],
  },
  {
    title:'6. Com quem compartilhamos',
    body:['Usamos fornecedores que tratam dados em nosso nome, somente para as finalidades acima:'],
    list:[
      'Supabase: autenticação e banco de dados.',
      'Vercel: hospedagem da aplicação.',
      'Stripe: cobrança e assinaturas.',
      'OpenAI: assistente financeiro com IA.',
      'Google: integração opcional com o Google Agenda.',
    ],
    after:'Alguns desses fornecedores podem armazenar dados fora do Brasil. Nesses casos, adotamos as salvaguardas previstas na LGPD. Também podemos divulgar dados quando exigido por lei ou ordem de autoridade competente.',
  },
  {
    title:'7. Por quanto tempo guardamos',
    body:[
      'Mantemos os dados enquanto a sua conta estiver ativa. Após o encerramento, eliminamos ou anonimizamos os dados em prazo razoável, salvo quando a lei exigir a guarda por mais tempo (por exemplo, registros fiscais e de cobrança).',
    ],
  },
  {
    title:'8. Segurança',
    body:[
      'Adotamos medidas técnicas e organizacionais para proteger os dados, como comunicação criptografada (HTTPS), controle de acesso por usuário no banco de dados, criptografia de credenciais de integrações e processamento de operações sensíveis no servidor. Nenhum sistema é totalmente imune a falhas; se houver um incidente relevante, comunicaremos os afetados e a ANPD conforme a LGPD.',
    ],
  },
  {
    title:'9. Seus direitos',
    body:['Pela LGPD, você pode solicitar a qualquer momento:'],
    list:[
      'confirmação de que tratamos seus dados e acesso a eles;',
      'correção de dados incompletos, inexatos ou desatualizados;',
      'anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;',
      'portabilidade dos dados;',
      'eliminação dos dados tratados com base no seu consentimento;',
      'informação sobre com quem compartilhamos os dados;',
      'revogação do consentimento.',
    ],
    after:'Se você é paciente de uma clínica que usa o SurgiMetrics, o pedido deve ser feito primeiro à própria clínica, que é a controladora dos seus dados.',
  },
  {
    title:'10. Cookies e armazenamento local',
    body:[
      'Usamos armazenamento local do navegador apenas para manter a sessão, o tema (claro/escuro) e a última tela visitada. Não usamos cookies de publicidade.',
    ],
  },
  {
    title:'11. Alterações nesta política',
    body:[
      'Podemos atualizar esta política. A data da última atualização fica no topo da página e, em mudanças relevantes, avisaremos pela plataforma ou por e-mail.',
    ],
  },
]

export function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      updatedAt={UPDATED_AT}
      sections={SECTIONS}
      contactTitle="12. Contato"
      contactIntro="Para exercer seus direitos ou tirar dúvidas sobre privacidade, fale com a gente pelo"
    />
  )
}

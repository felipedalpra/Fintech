import { LegalPage } from '../components/LegalPage.jsx'

const UPDATED_AT = '5 de outubro de 2026'

const SECTIONS = [
  {
    title:'1. Aceitação',
    body:[
      'Estes Termos de Serviço regulam o uso do SurgiMetrics, plataforma de gestão financeira e de agenda para cirurgiões plásticos e clínicas, disponível em surgimetrics.com.br. Ao criar uma conta ou usar a plataforma, você declara que leu e concorda com estes termos e com a nossa Política de Privacidade (/privacidade).',
    ],
  },
  {
    title:'2. O serviço',
    body:[
      'O SurgiMetrics permite registrar lançamentos, receitas, custos, cirurgias, consultas, metas, produtos e procedimentos, acompanhar indicadores e relatórios, usar um assistente financeiro com inteligência artificial e, opcionalmente, sincronizar a agenda com o Google Agenda.',
      'Podemos melhorar, alterar ou descontinuar funcionalidades. Em mudanças que afetem de forma relevante o serviço contratado, avisaremos com antecedência razoável.',
    ],
  },
  {
    title:'3. Conta e acesso',
    list:[
      'Você deve ter capacidade legal para contratar e fornecer informações verdadeiras no cadastro.',
      'Você é responsável por manter a senha em sigilo e por tudo o que ocorrer na sua conta. Avise-nos se suspeitar de uso indevido.',
      'Cada conta é destinada ao uso do profissional ou da clínica contratante. Não é permitido revender ou compartilhar o acesso com terceiros sem autorização.',
    ],
  },
  {
    title:'4. Período de teste, planos e pagamento',
    body:[
      'Novas contas têm 30 dias de teste gratuito, sem necessidade de cartão. Depois do teste, o uso contínuo depende de uma assinatura paga.',
    ],
    list:[
      'Planos: mensal (R$ 197,00 por mês), semestral (R$ 1.062,00 a cada 6 meses) e anual (R$ 1.764,00 por ano). Os valores podem ser reajustados, com aviso prévio, antes da renovação seguinte.',
      'A cobrança é recorrente e processada pelo Stripe. Você autoriza a cobrança no ciclo escolhido até o cancelamento.',
      'Se o pagamento falhar, podemos suspender o acesso até a regularização. Seus dados são mantidos conforme a Política de Privacidade.',
    ],
  },
  {
    title:'5. Cancelamento e reembolso',
    list:[
      'Você pode cancelar a assinatura a qualquer momento. O cancelamento impede novas cobranças e o acesso segue até o fim do período já pago.',
      'Conforme o Código de Defesa do Consumidor (art. 49), na primeira contratação você pode desistir em até 7 dias após o pagamento e receber o valor integral de volta.',
      'Fora desse prazo, não há reembolso proporcional do período já iniciado, salvo quando a lei exigir.',
      'Para cancelar ou pedir reembolso, fale conosco pelos canais indicados no fim desta página.',
    ],
  },
  {
    title:'6. Seus dados e conteúdo',
    body:[
      'Os dados que você registra na plataforma continuam sendo seus. Você nos autoriza a tratá-los apenas para prestar o serviço, conforme a Política de Privacidade.',
      'Você é responsável pela legalidade dos dados que cadastra, inclusive por ter base legal e, quando necessário, o consentimento dos seus pacientes para registrar informações sobre eles. Recomendamos não inserir informações clínicas ou sensíveis além do necessário para a gestão financeira e de agenda.',
    ],
  },
  {
    title:'7. Uso aceitável',
    body:['Você concorda em não:'],
    list:[
      'usar a plataforma para fins ilegais ou que violem direitos de terceiros;',
      'tentar acessar contas, sistemas ou dados que não sejam seus, ou burlar mecanismos de segurança;',
      'fazer engenharia reversa, copiar ou revender o software;',
      'enviar código malicioso ou sobrecarregar a infraestrutura de forma abusiva, inclusive o uso automatizado do assistente de IA além dos limites diários.',
    ],
    after:'Podemos suspender ou encerrar contas que violem estes termos.',
  },
  {
    title:'8. Assistente com inteligência artificial',
    body:[
      'O assistente financeiro gera respostas automáticas com base nos dados da sua clínica. Ele é uma ferramenta de apoio e pode errar. As respostas não substituem o trabalho de um contador, consultor financeiro ou advogado, e as decisões tomadas com base nelas são de sua responsabilidade.',
    ],
  },
  {
    title:'9. Integração com o Google Agenda',
    body:[
      'A conexão com o Google Agenda é opcional e depende da sua autorização. Ao conectá-la, você entende que eventos de consultas e cirurgias, com o nome do paciente no título, serão criados no seu calendário do Google. Você pode desconectar a qualquer momento na tela Agenda. O uso do Google Agenda também está sujeito aos termos do Google.',
    ],
  },
  {
    title:'10. Propriedade intelectual',
    body:[
      'O software, a marca, o layout e os materiais do SurgiMetrics pertencem a nós ou a nossos licenciadores. Estes termos concedem a você apenas um direito pessoal, limitado, não exclusivo e intransferível de usar a plataforma enquanto sua conta estiver ativa.',
    ],
  },
  {
    title:'11. Disponibilidade e limitação de responsabilidade',
    body:[
      'Trabalhamos para manter a plataforma disponível e segura, mas não garantimos funcionamento ininterrupto ou livre de erros, nem que serviços de terceiros (como Google, Stripe, Supabase e OpenAI) estarão sempre disponíveis. Os indicadores dependem dos dados que você registra; confira as informações importantes antes de usá-las em decisões ou obrigações fiscais.',
      'Na extensão permitida pela lei, não respondemos por lucros cessantes ou danos indiretos decorrentes do uso ou da impossibilidade de uso da plataforma, e nossa responsabilidade total fica limitada ao valor pago por você nos 12 meses anteriores ao fato. Nada nestes termos afasta direitos que a lei garante ao consumidor.',
    ],
  },
  {
    title:'12. Encerramento',
    body:[
      'Você pode parar de usar a plataforma e pedir a exclusão da sua conta quando quiser. Após o encerramento, tratamos os dados conforme a Política de Privacidade. Podemos encerrar ou suspender o acesso em caso de violação destes termos, fraude ou inadimplência.',
    ],
  },
  {
    title:'13. Alterações nestes termos',
    body:[
      'Podemos atualizar estes termos. A data da última atualização fica no topo da página e, em mudanças relevantes, avisaremos pela plataforma ou por e-mail. Continuar usando o serviço depois do aviso significa que você concorda com a nova versão.',
    ],
  },
  {
    title:'14. Lei aplicável e foro',
    body:[
      'Estes termos são regidos pelas leis do Brasil. Fica eleito o foro do domicílio do consumidor para resolver qualquer conflito decorrente deles.',
    ],
  },
]

export function TermsOfServicePage() {
  return (
    <LegalPage
      title="Termos de Serviço"
      updatedAt={UPDATED_AT}
      sections={SECTIONS}
      contactTitle="15. Contato"
      contactIntro="Para dúvidas sobre estes termos, cancelamento ou reembolso, fale com a gente pelo"
    />
  )
}

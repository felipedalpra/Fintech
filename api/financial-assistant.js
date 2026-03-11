const OPENAI_URL = 'https://api.openai.com/v1/responses'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error:'OPENAI_API_KEY not configured' })
  }

  const { question, context, history = [] } = req.body || {}
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error:'Question is required' })
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
  const systemPrompt = [
    'Você é o CFO automático do SurgiMetrics, um ERP financeiro para cirurgiões plásticos.',
    'Responda sempre em português do Brasil.',
    'Use somente os dados fornecidos no contexto.',
    'Seja conversacional, natural e direto, sem parecer um template engessado.',
    'Considere o histórico recente da conversa para manter contexto e continuidade.',
    'Se a mensagem do usuário for apenas uma saudação, resposta social curta ou agradecimento, responda de forma breve e natural, sem despejar métricas financeiras automaticamente.',
    'Só entre em análise financeira quando a pergunta pedir isso ou quando o usuário demonstrar intenção clara de análise.',
    'Quando fizer sentido, organize a resposta em blocos curtos: dados, leitura, risco e ação.',
    'Não precisa usar sempre a mesma estrutura; varie de acordo com a pergunta.',
    'Se o contexto não sustentar uma conclusão, diga isso explicitamente.',
    'Não invente números.',
    'Evite frases genéricas e repetitivas.',
  ].join(' ')

  const input = [
    {
      role:'system',
      content:[
        { type:'input_text', text:systemPrompt },
      ],
    },
    {
      role:'user',
      content:[
        {
          type:'input_text',
          text:[
            'Contexto financeiro estruturado da clínica:',
            JSON.stringify(context || {}, null, 2),
          ].join('\n\n'),
        },
      ],
    },
  ]

  const recentHistory = Array.isArray(history) ? history.slice(-8) : []
  recentHistory.forEach(item => {
    if (!item?.content || (item.role !== 'user' && item.role !== 'assistant')) return
    input.push({
      role:item.role,
      content:[
        { type:'input_text', text:item.content },
      ],
    })
  })

  input.push({
    role:'user',
    content:[
      {
        type:'input_text',
        text:`Pergunta atual do médico: ${question}`,
      },
    ],
  })

  try {
    const response = await fetch(OPENAI_URL, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${apiKey}`,
      },
      body:JSON.stringify({
        model,
        input,
      }),
    })

    const payload = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({
        error:payload?.error?.message || 'OpenAI request failed',
      })
    }

    const answer = extractText(payload)
    return res.status(200).json({ answer })
  } catch (error) {
    return res.status(500).json({ error:error.message || 'Unexpected server error' })
  }
}

function extractText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim()

  const output = Array.isArray(payload?.output) ? payload.output : []
  const chunks = []

  output.forEach(item => {
    const content = Array.isArray(item?.content) ? item.content : []
    content.forEach(block => {
      if (block?.type === 'output_text' && block.text) chunks.push(block.text)
      if (block?.type === 'text' && block.text) chunks.push(block.text)
    })
  })

  return chunks.join('\n').trim() || 'Não foi possível gerar a resposta da IA.'
}

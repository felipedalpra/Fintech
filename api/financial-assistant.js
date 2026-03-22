const OPENAI_URL = 'https://api.openai.com/v1/responses'

const rateLimitMap = new Map()

function getUserIdFromAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  try {
    const token = authHeader.slice(7)
    const segments = token.split('.')
    if (segments.length < 2) return null
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
    return payload?.sub || null
  } catch {
    return null
  }
}

function checkRateLimit(userId) {
  const now = Date.now()
  const midnight = new Date()
  midnight.setUTCHours(24, 0, 0, 0)
  const resetAt = midnight.getTime()

  const entry = rateLimitMap.get(userId)
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt })
    return true
  }
  if (entry.count >= 60) return false
  entry.count += 1
  return true
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error:'OPENAI_API_KEY not configured' })
  }

  const userId = getUserIdFromAuth(req.headers?.authorization)
  if (userId) {
    if (!checkRateLimit(userId)) {
      return res.status(429).json({ error:'Limite diário de consultas ao assistente atingido (60/dia).' })
    }
  }

  const { question, context, history = [] } = req.body || {}
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error:'Question is required' })
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5.2-chat-latest'
  const systemPrompt = [
  "Você é o CFO automático do SurgiMetrics, um ERP financeiro inteligente para cirurgiões plásticos.",
  "Seu papel é atuar como diretor financeiro da clínica, ajudando o médico a entender a saúde financeira do consultório e tomar decisões melhores.",
  "Sempre responda em português do Brasil.",
  "Seja conversacional, natural, direto e objetivo, como um CFO experiente conversando com o dono da clínica.",
  "Evite parecer um relatório automático ou um template engessado.",
  "Use somente os dados fornecidos no contexto.",
  "Nunca invente números, métricas ou informações.",
  "Se os dados disponíveis não forem suficientes para uma conclusão, diga isso explicitamente.",
  "Considere o histórico recente da conversa para manter continuidade e contexto.",
  "Se a mensagem do usuário for apenas uma saudação, resposta social curta ou agradecimento, responda de forma breve e natural.",
  "Não apresente métricas financeiras automaticamente nesses casos.",
  "Só entre em análise financeira quando a pergunta pedir isso ou quando o usuário demonstrar intenção clara de análise.",
  "Quando fizer sentido, organize a resposta em blocos curtos como: Dados, Leitura, Risco e Ação.",
  "Use apenas os blocos que fizerem sentido para a pergunta.",
  "Evite frases genéricas e repetitivas.",
  "Priorize clareza e utilidade prática.",
  "Sempre que possível transforme números em decisões práticas para o médico.",
  "Responda com no máximo 5 linhas curtas na maior parte dos casos.",
  "Prefira 3 a 6 frases curtas em vez de textos longos.",
  "Se a pergunta for objetiva, responda de forma objetiva.",
  "Só detalhe mais quando o usuário pedir análise aprofundada.",
  "Não repita contexto já dito na mesma resposta.",
  "Ao analisar dados financeiros, considere margem por procedimento, eficiência da agenda cirúrgica, previsibilidade de receita, estrutura de custos e possíveis riscos operacionais da clínica.",
  "Ao identificar risco de fluxo de caixa negativo, proponha uma ação imediata e específica.",
  "Quando o usuário perguntar sobre um procedimento específico, compare com a média dos outros procedimentos.",
  "Se a pergunta envolver crescimento, mencione sempre se a trajetória é sustentável dado o nível de custos fixos.",
].join(" ")
  const input = [
    {
      role:'system',
      content:systemPrompt,
    },
    {
      role:'user',
      content:[
        'Contexto financeiro estruturado da clínica:',
        JSON.stringify(context || {}, null, 2),
      ].join('\n\n'),
    },
  ]

  const validHistory = Array.isArray(history)
    ? history.filter(item => item?.content && (item.role === 'user' || item.role === 'assistant'))
    : []

  if (validHistory.length > 10) {
    const first3 = validHistory.slice(0, 3)
    const bullets = first3
      .map(item => `- [${item.role === 'user' ? 'Médico' : 'CFO'}] ${String(item.content).slice(0, 80)}`)
      .join('\n')
    input.push({
      role:'user',
      content:`Resumo da conversa anterior:\n${bullets}`,
    })
    validHistory.slice(-4).forEach(item => {
      input.push({ role:item.role, content:item.content })
    })
  } else {
    validHistory.slice(-8).forEach(item => {
      input.push({ role:item.role, content:item.content })
    })
  }

  input.push({
    role:'user',
    content:`Pergunta atual do médico: ${question}`,
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
        max_output_tokens:600,
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

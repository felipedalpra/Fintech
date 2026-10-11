// api/_lib/stageSuggestClient.js
// Chamada à OpenAI (/v1/responses) para classificar o estágio — modelo barato, prompt curto.
// Mesmo endpoint/credenciais do assistente financeiro (OPENAI_API_KEY).

const OPENAI_URL = 'https://api.openai.com/v1/responses'

// Extrai o texto de saída da API /v1/responses (output[].content[].text).
function extractText(payload) {
  if (!payload) return ''
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text
  const out = Array.isArray(payload.output) ? payload.output : []
  const parts = []
  for (const item of out) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const c of content) {
      if (typeof c?.text === 'string') parts.push(c.text)
    }
  }
  return parts.join('').trim()
}

// Classifica o estágio. Retorna o texto bruto da IA (para parseSuggestionResult validar) ou ''.
// Nunca lança: qualquer falha/timeout vira '' (o webhook segue sem sugestão).
export async function classifyStageWithAI(input, { timeoutMs = 6000 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return ''
  const model = (process.env.OPENAI_SUGGEST_MODEL || process.env.OPENAI_MODEL || 'gpt-5.2-mini').trim()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input, max_output_tokens: 120 }),
      signal: controller.signal,
    })
    if (!res.ok) return ''
    const payload = await res.json().catch(() => null)
    return extractText(payload)
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

import { answerFinancialQuestion, buildFinancialContext } from '../ai/financialBrain.js'

export async function queryFinancialAssistant({ question, brain, history = [] }) {
  const fallback = answerFinancialQuestion(question, brain)

  try {
    const response = await fetch('/api/financial-assistant', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        question,
        context:buildFinancialContext(brain),
        history:history
          .filter(item => item?.role === 'user' || item?.role === 'assistant')
          .slice(-8)
          .map(item => ({ role:item.role, content:item.content })),
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      return {
        answer:fallback,
        source:'fallback',
        reason:explainHttpError(response.status, payload?.error),
      }
    }

    const payload = await response.json()
    return {
      answer:payload?.answer || fallback,
      source:'openai',
      reason:'',
    }
  } catch {
    return {
      answer:fallback,
      source:'fallback',
      reason:explainNetworkError(),
    }
  }
}

function explainHttpError(status, errorMessage = '') {
  if (status === 503 && errorMessage.includes('OPENAI_API_KEY')) {
    return 'OPENAI_API_KEY não configurada na função /api'
  }
  if (status === 404) {
    return 'Rota /api/financial-assistant não encontrada'
  }
  if (status === 500) {
    return errorMessage || 'Erro interno na função da IA'
  }
  return errorMessage || `HTTP ${status}`
}

function explainNetworkError() {
  if (typeof window !== 'undefined') {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    if (isLocal) {
      return 'Ambiente local sem função /api ativa. Use vercel dev ou teste na Vercel'
    }
  }
  return 'Falha ao chamar /api/financial-assistant'
}

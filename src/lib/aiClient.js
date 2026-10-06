import { answerFinancialQuestion } from '../ai/financialBrain.js'
import { supabase } from './supabase.js'

export async function queryFinancialAssistant({ question, brain, history = [] }) {
  const fallback = answerFinancialQuestion(question, brain)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)

  try {
    if (!supabase) throw new AssistantClientError('SESSION_REQUIRED', 'Supabase não configurado.')
    const { data, error } = await supabase.auth.getSession()
    if (error || !data?.session?.access_token) {
      throw new AssistantClientError('SESSION_REQUIRED', 'Entre novamente para consultar os dados.')
    }

    const response = await fetch('/api/financial-assistant', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${data.session.access_token}`,
      },
      body:JSON.stringify({
        question,
        history:history
          .filter(item => item?.role === 'user' || item?.role === 'assistant')
          .slice(-8)
          .map(item => ({ role:item.role, content:item.content })),
      }),
      signal:controller.signal,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      return {
        answer:fallback,
        source:'fallback',
        mode:'limited',
        reason:explainHttpError(response.status, payload?.code),
        evidence:[],
        requestId:payload?.requestId || '',
      }
    }

    const payload = await response.json()
    return {
      answer:payload?.answer || fallback,
      source:'openai',
      mode:payload?.mode || 'conversational',
      reason:'',
      evidence:Array.isArray(payload?.evidence) ? payload.evidence : [],
      requestId:payload?.requestId || '',
    }
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'AI_TIMEOUT' : error?.code
    return {
      answer:fallback,
      source:'fallback',
      mode:'limited',
      reason:explainClientError(code),
      evidence:[],
      requestId:'',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function explainHttpError(status, code = '') {
  if (status === 401) return 'Sua sessão expirou. Entre novamente para consultar os dados.'
  if (status === 429 || code === 'RATE_LIMITED') return 'O limite diário do assistente foi atingido.'
  if (status === 504 || code === 'AI_TIMEOUT') return 'A análise demorou demais. Tente novamente.'
  if (code === 'RATE_LIMIT_UNAVAILABLE') return 'A atualização do assistente ainda precisa ser ativada no banco.'
  if (status === 503) return 'O assistente avançado está temporariamente indisponível.'
  return 'Não foi possível consultar os dados agora.'
}

function explainClientError(code) {
  if (code === 'SESSION_REQUIRED') return 'Sua sessão expirou. Entre novamente para consultar os dados.'
  if (code === 'AI_TIMEOUT') return 'A análise demorou demais. Tente novamente.'
  if (typeof window !== 'undefined') {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    if (isLocal) {
      return 'Ambiente local sem função /api ativa. Use vercel dev ou teste na Vercel'
    }
  }
  return 'Falha ao chamar /api/financial-assistant'
}

class AssistantClientError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

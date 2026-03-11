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

    if (!response.ok) return fallback

    const payload = await response.json()
    return payload?.answer || fallback
  } catch {
    return fallback
  }
}

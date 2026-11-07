import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { maskMoney } from '../lib/privacyMask.js'

const STORAGE_KEY = 'surgimetrics_financial_privacy'
// Chave separada do modo financeiro: sao escolhas diferentes. Esconder valores durante uma
// consulta nao e a mesma coisa que esconder TUDO para gravar um video.
const PRESENTATION_KEY = 'surgimetrics_presentation_privacy'
const FinancialPrivacyContext = createContext(null)

export function FinancialPrivacyProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  // Persiste porque o uso tipico e gravar video: um reload no meio nao pode reexibir
  // nome de paciente justamente enquanto a tela esta sendo capturada.
  const [presentation, setPresentation] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(PRESENTATION_KEY) === '1'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  }, [enabled])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PRESENTATION_KEY, presentation ? '1' : '0')
  }, [presentation])

  const value = useMemo(() => ({
    // Valores somem no modo financeiro OU no de apresentacao: o de apresentacao e o mais
    // forte dos dois, entao ligar so ele tambem tem que esconder dinheiro.
    financialPrivacyMode: enabled || presentation,
    setFinancialPrivacyMode: setEnabled,
    toggleFinancialPrivacy() {
      setEnabled(current => !current)
    },
    presentationMode: presentation,
    setPresentationMode: setPresentation,
    togglePresentationMode() {
      setPresentation(current => {
        // Desligar o olho tem que REVELAR, sempre. Sem isto, quem tivesse o modo
        // financeiro ligado continuava sem ver os valores depois de desligar o olho,
        // e o unico controle para aquele modo vive no Dashboard -- de outra tela,
        // nao havia como voltar a enxergar.
        if (current) setEnabled(false)
        return !current
      })
    },
  }), [enabled, presentation])

  return <FinancialPrivacyContext.Provider value={value}>{children}</FinancialPrivacyContext.Provider>
}

export function useFinancialPrivacy() {
  const context = useContext(FinancialPrivacyContext)
  if (!context) throw new Error('useFinancialPrivacy must be used within FinancialPrivacyProvider')
  return context
}

export function maskFinancialValue(value, enabled, formatter) {
  // Pontinhos, nao 'XXXXX': fileira de X parece erro de renderizacao numa gravacao.
  return enabled ? maskMoney() : formatter(value)
}

/** Atalho de leitura para componente que so precisa saber se deve mascarar dado pessoal. */
export function usePresentationMode() {
  return useFinancialPrivacy().presentationMode
}

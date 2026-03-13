import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'surgimetrics_financial_privacy'
const FinancialPrivacyContext = createContext(null)

export function FinancialPrivacyProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  }, [enabled])

  const value = useMemo(() => ({
    financialPrivacyMode: enabled,
    setFinancialPrivacyMode: setEnabled,
    toggleFinancialPrivacy() {
      setEnabled(current => !current)
    },
  }), [enabled])

  return <FinancialPrivacyContext.Provider value={value}>{children}</FinancialPrivacyContext.Provider>
}

export function useFinancialPrivacy() {
  const context = useContext(FinancialPrivacyContext)
  if (!context) throw new Error('useFinancialPrivacy must be used within FinancialPrivacyProvider')
  return context
}

export function maskFinancialValue(value, enabled, formatter) {
  return enabled ? 'R$ XXXXX' : formatter(value)
}

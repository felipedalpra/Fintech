import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getTrialDaysLeft, hasActiveAccess, ensureBillingAccount, updateSelectedPlan } from '../lib/billingStore.js'
import { useAuth } from './AuthContext.jsx'

const BillingContext = createContext(null)

export function BillingProvider({ children }) {
  const { user } = useAuth()
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function bootstrap(attempt = 0) {
      if (!user?.id) {
        setBilling(null)
        setLoading(false)
        return
      }

      if (attempt === 0) {
        setLoading(true)
        setError('')
      }

      try {
        const account = await ensureBillingAccount(user)
        if (!active) return
        setBilling(account)
        if (active) setLoading(false)
      } catch (nextError) {
        if (!active) return
        if (attempt < 2) {
          setTimeout(() => bootstrap(attempt + 1), 1000 * Math.pow(2, attempt))
          return
        }
        setError(nextError.message || 'Nao foi possivel carregar o billing da conta.')
        setLoading(false)
      }
    }

    bootstrap()
    return () => { active = false }
  }, [user])

  const value = useMemo(() => ({
    billing,
    billingLoading:loading,
    billingError:error,
    hasAppAccess:hasActiveAccess(billing),
    trialDaysLeft:getTrialDaysLeft(billing),
    async refreshBilling() {
      if (!user) return null
      const account = await ensureBillingAccount(user)
      setBilling(account)
      return account
    },
    async selectPlan(planId) {
      if (!user?.id) throw new Error('Usuario nao autenticado.')
      const account = await updateSelectedPlan(user.id, planId)
      setBilling(account)
      return account
    },
  }), [billing, error, loading, user])

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>
}

export function useBilling() {
  const context = useContext(BillingContext)
  if (!context) throw new Error('useBilling must be used within BillingProvider')
  return context
}

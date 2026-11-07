import { useMemo } from 'react'
import { useFinancialPrivacy } from '../context/FinancialPrivacyContext.jsx'
import { maskEmail, maskName, maskPhone, maskText } from './privacyMask.js'

/**
 * Mascara dado pessoal quando o modo apresentação está ligado; devolve o valor intacto
 * quando está desligado.
 *
 * Existe para que cada ponto de exibição custe uma linha. O caminho alternativo — espalhar
 * `modo ? mask(x) : x` por dezenas de componentes — é onde um campo acaba esquecido, e um
 * campo esquecido num vídeo público é um nome de paciente vazado.
 */
export function useMask() {
  const { presentationMode } = useFinancialPrivacy()
  return useMemo(() => ({
    on: presentationMode,
    name: v => (presentationMode ? maskName(v) : v),
    email: v => (presentationMode ? maskEmail(v) : v),
    phone: v => (presentationMode ? maskPhone(v) : v),
    text: v => (presentationMode ? maskText(v) : v),
  }), [presentationMode])
}

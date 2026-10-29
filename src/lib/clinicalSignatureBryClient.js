import { supabase } from './supabase.js'

// Cliente da assinatura clinica. Toda decisao (flag, autorizacao, estado) vem
// do backend: o navegador nunca envia ownerId, autoria, CRM, CPF, caminho de
// arquivo ou status, e nunca recebe token, credencial ou caminho de storage.
const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'

async function authFetch(action, payload = {}) {
  const token = E2E_BYPASS_AUTH
    ? 'e2e-token'
    : (await supabase.auth.getSession()).data.session?.access_token
  if (!token) throw new Error('Sessão inválida. Entre novamente.')

  const response = await fetch(`/api/secure-profile?action=${action}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body:JSON.stringify(payload),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(json.error || `HTTP ${response.status}`)
    error.code = json.code || null
    error.statusCode = response.status
    throw error
  }
  return json
}

export function fetchClinicalSignatureState(documentIds) {
  return authFetch('clinical-signature-state', { documentIds })
}

// `requestId` e apenas a chave idempotente da solicitacao: nao concede
// autoridade nenhuma e e revalidada no servidor.
export function requestClinicalSignature(documentId, requestId) {
  return authFetch('clinical-signature-request', { documentId, requestId })
}

// Reabre a pagina de assinatura de uma tentativa pendente, sem criar envelope
// novo. O link nunca e guardado no navegador.
export function fetchClinicalSignatureLink(attemptId) {
  return authFetch('clinical-signature-link', { attemptId })
}

export function reconcileClinicalSignature(attemptId) {
  return authFetch('clinical-signature-reconcile', { attemptId })
}

export function abandonClinicalSignature(attemptId) {
  return authFetch('clinical-signature-abandon', { attemptId, confirm:true })
}

export function openClinicalSignatureArtifact(attemptId, kind = 'signed') {
  return authFetch('clinical-signature-artifact', { attemptId, kind })
}

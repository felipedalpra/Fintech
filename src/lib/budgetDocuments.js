// Spec: docs/superpowers/plans/2026-11-13-biblioteca-orcamento-pdf.md
// Biblioteca de orçamento PDF por paciente — funções puras (sem I/O, testáveis sem Supabase).

export const BUDGET_DOCUMENT_BUCKET = 'budget-documents'
export const BUDGET_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

export function validateBudgetDocumentFile(file) {
  if (!file) return 'Selecione um PDF.'
  if (file.type !== 'application/pdf') return 'Formato não aceito. Anexe um PDF.'
  if (!Number.isFinite(file.size) || file.size <= 0) return 'O arquivo está vazio.'
  if (file.size > BUDGET_DOCUMENT_MAX_BYTES) return 'O arquivo deve ter no máximo 10 MB.'
  if (!String(file.name || '').trim()) return 'O arquivo precisa ter um nome.'
  return ''
}

export async function budgetDocumentSha256(file) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function buildBudgetDocumentRpcArgs({ patientId, opportunityId, file, sha256 }) {
  return {
    p_patient_id:patientId,
    p_opportunity_id:opportunityId || null,
    p_file_name:file.name,
    p_file_size:file.size,
    p_client_sha256:sha256,
  }
}

// Mais recente primeiro — é como a biblioteca sempre deve ser exibida.
export function sortBudgetDocumentsByVersion(rows) {
  return [...(rows || [])].sort((a, b) => (b.version || 0) - (a.version || 0))
}

export function budgetDocumentStatusLabel(status) {
  return {
    uploading:'Enviando…',
    available:'Disponível',
    failed:'Falhou — tente novamente',
    archived:'Arquivado',
  }[status] || status
}

// Mensagem pronta para abrir o WhatsApp do paciente com o link do orçamento — nunca afirma
// "enviado", só prepara o texto (regra R27: não declarar envio sem evidência de API de mídia).
export function buildBudgetDocumentWhatsAppMessage({ patientName, version, signedUrl }) {
  const name = String(patientName || '').trim() || 'tudo bem'
  return `Oi ${name}! Segue o orçamento (versão ${version}): ${signedUrl}`
}

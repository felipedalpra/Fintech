import {
  decryptPayload,
  encryptPayload,
  fetchEncryptedProfile,
  getAuthenticatedUser,
  insertProfileAuditLog,
  profileMeta,
  sanitizeProfilePayload,
  saveEncryptedProfile,
} from './_lib/secureProfile.js'
import {
  abandonClinicalSignature,
  clinicalSignatureContext,
  clinicalSignatureState,
  handleBryWebhook,
  openClinicalSignatureArtifact,
  reconcileClinicalSignature,
  requestClinicalSignature,
} from './_lib/clinicalSignatureBry.js'

// Endpoint consolidado do perfil seguro e da assinatura clinica BRy Easy Sign.
// Uma unica funcao serverless porque o projeto opera no limite de 12 funcoes do
// plano Hobby da Vercel (ver api/whatsapp.js, que segue o mesmo padrao).
//
// Roteado por ?action=
//   get | save                        -> perfil seguro (autenticado)
//   clinical-signature-state          -> flag + tentativas do documento (autenticado)
//   clinical-signature-request        -> cria envelope na BRy (autenticado, autor)
//   clinical-signature-reconcile      -> reconciliacao autenticada contra a BRy
//   clinical-signature-abandon        -> encerra tentativa de resultado desconhecido
//   clinical-signature-artifact       -> URL assinada curta e auditada do PDF
//   bry-webhook                       -> PUBLICO, apenas notificacao (ver abaixo)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const action = req.query.action || 'get'

  // O webhook da BRy e roteado ANTES de qualquer autenticacao de usuario: ele
  // nao tem sessao Supabase. A documentacao publica da BRy declara
  // `authType: NONE`, portanto ele e tratado como simples notificacao,
  // protegido por segredo de endpoint, com payload limitado, e NUNCA como
  // fonte de verdade -- a transicao real so acontece apos consulta
  // autenticada por JWT a propria BRy.
  if (action === 'bry-webhook') {
    try {
      const result = await handleBryWebhook(req, req.body)
      return res.status(result.statusCode).json(result.body)
    } catch {
      // Nunca detalhar falha interna para um chamador nao autenticado.
      return res.status(202).json({ ok: true })
    }
  }

  try {
    if (action === 'save') {
      const user = await getAuthenticatedUser(req)
      const sanitized = sanitizeProfilePayload(req.body?.profile)
      const encrypted = encryptPayload(sanitized)
      const meta = profileMeta(sanitized)
      await saveEncryptedProfile(user.id, encrypted, meta)
      await insertProfileAuditLog(user.id, 'update_secure_profile', meta)
      return res.status(200).json({ ok: true })
    }

    if (action === 'get') {
      const user = await getAuthenticatedUser(req)
      const record = await fetchEncryptedProfile(user.id)
      const profile = record?.encrypted_payload ? decryptPayload(record.encrypted_payload) : null
      return res.status(200).json({ profile })
    }

    if (action === 'clinical-signature-state') {
      const { admin, ownerId } = await clinicalSignatureContext(req)
      const documentIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds.slice(0, 200) : []
      const state = await clinicalSignatureState({ admin, ownerId, documentIds })
      return res.status(200).json(state)
    }

    if (action === 'clinical-signature-request') {
      return res.status(200).json(await requestClinicalSignature(req))
    }

    if (action === 'clinical-signature-reconcile') {
      return res.status(200).json(await reconcileClinicalSignature(req))
    }

    if (action === 'clinical-signature-abandon') {
      return res.status(200).json(await abandonClinicalSignature(req))
    }

    if (action === 'clinical-signature-artifact') {
      return res.status(200).json(await openClinicalSignatureArtifact(req))
    }

    res.setHeader('Allow', 'POST')
    return res.status(400).json({ error: 'Ação inválida.' })
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500
    // Mensagem sanitizada: nenhuma credencial, link de assinatura ou detalhe de
    // schema chega ao navegador.
    const message = statusCode === 500
      ? 'Não foi possível processar a solicitação.'
      : (error?.message || 'Não foi possível processar a solicitação.')
    return res.status(statusCode).json({ error: message, code: error?.publicCode || null })
  }
}

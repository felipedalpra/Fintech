export const WHATSAPP_REALTIME_BATCH_MS = 300
export const WHATSAPP_REALTIME_FALLBACK_POLL_MS = 90_000
export const WHATSAPP_REALTIME_ID_BATCH_SIZE = 80

const byNewestFirst = (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)

export function mergeWhatsAppMessageRows(currentRows, incomingRows) {
  const merged = new Map((currentRows || []).map(row => [row.id, row]))
  for (const row of incomingRows || []) {
    if (!row?.id) continue
    merged.set(row.id, { ...(merged.get(row.id) || {}), ...row })
  }
  return Array.from(merged.values()).sort(byNewestFirst)
}

export function removeWhatsAppMessageRow(currentRows, messageId) {
  if (!messageId) return currentRows || []
  return (currentRows || []).filter(row => row.id !== messageId)
}

export function reconcileWhatsAppMessageRows(currentRows, requestedIds, authorizedRows) {
  const requested = new Set((requestedIds || []).filter(Boolean))
  const authorized = new Set((authorizedRows || []).map(row => row.id))
  const stillVisible = (currentRows || []).filter(row => !requested.has(row.id) || authorized.has(row.id))
  return mergeWhatsAppMessageRows(stillVisible, authorizedRows)
}

export function reconcileWhatsAppMessageWindow(currentRows, loadedRows, changedVersions, versionAtLoadStart) {
  const current = new Map((currentRows || []).map(row => [row.id, row]))
  const reconciled = new Map((loadedRows || []).map(row => [row.id, row]))
  for (const [messageId, version] of changedVersions || []) {
    if (version <= versionAtLoadStart) continue
    if (current.has(messageId)) reconciled.set(messageId, current.get(messageId))
    else reconciled.delete(messageId)
  }
  return Array.from(reconciled.values()).sort(byNewestFirst)
}

export function chunkWhatsAppMessageIds(messageIds, batchSize = WHATSAPP_REALTIME_ID_BATCH_SIZE) {
  const ids = Array.from(new Set((messageIds || []).filter(Boolean)))
  const chunks = []
  for (let offset = 0; offset < ids.length; offset += batchSize) chunks.push(ids.slice(offset, offset + batchSize))
  return chunks
}

export function whatsappNumberScopeChanged(previousRow, payload) {
  const row = payload?.new || payload?.old
  if (!row?.id) return false
  return payload.eventType === 'DELETE'
    || !previousRow
    || previousRow.assigned_user_id !== row.assigned_user_id
}

export function whatsappLoadIsCurrent(started, current) {
  return started.ownerId === current.ownerId
    && started.scopeGeneration === current.scopeGeneration
    && (started.requestId == null || started.requestId === current.requestId)
}

const ALLOWED_COLLECTIONS = new Set(['extraRevenues', 'expenses'])

export function mergePendingFinanceSave(data, pendingSave) {
  const collection = pendingSave?.collection
  const record = pendingSave?.record
  if (!ALLOWED_COLLECTIONS.has(collection) || !record?.id) return data

  const records = Array.isArray(data?.[collection]) ? data[collection] : []
  const exists = records.some(item => item.id === record.id)
  return {
    ...data,
    [collection]:exists
      ? records.map(item => item.id === record.id ? { ...item, ...record } : item)
      : [...records, record],
  }
}

// Ordenação das tabelas de lançamentos.
//
// A regra decisiva: quando a linha traz `rawCells`, ordena-se pelo valor CRU, nunca pelo texto
// exibido. Ordenar por "01/12/2026" como texto coloca 01/12 antes de 02/09 — a data vira string
// e a lista mente. Mesmo problema com dinheiro: "R$ 1.000,00" ordena antes de "R$ 900,00".
export function sortValue(row, columnIndex) {
  const raw = row?.rawCells?.[columnIndex]
  if (raw !== undefined && raw !== null) return raw
  const cell = row?.cells?.[columnIndex]
  return typeof cell === 'string' ? cell : ''
}

export function compareRows(a, b, columnIndex, direction = 'asc') {
  const left = sortValue(a, columnIndex)
  const right = sortValue(b, columnIndex)
  // Números comparam como números; o resto compara como texto com reconhecimento numérico.
  const cmp = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), 'pt-BR', { numeric:true })
  return direction === 'asc' ? cmp : -cmp
}

export function sortRows(rows = [], columnIndex = null, direction = 'asc') {
  if (columnIndex === null || columnIndex === undefined) return rows
  return [...(rows || [])].sort((a, b) => compareRows(a, b, columnIndex, direction))
}

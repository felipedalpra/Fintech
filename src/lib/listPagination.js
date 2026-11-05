// Paginação das listas longas (entradas, saídas, contas, consultas, cirurgias).
//
// Vive aqui, puro, porque o erro clássico de paginação é de estado, não de desenho: quando um
// filtro encurta a lista e a página atual deixa de existir, a tela mostra uma página vazia e a
// pessoa acha que os dados sumiram. Por isso `page` é SEMPRE normalizada para dentro do
// intervalo válido, e quem chama não precisa lembrar de resetar.

export const DEFAULT_PAGE_SIZE = 25

export function paginate(rows = [], page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const list = Array.isArray(rows) ? rows : []
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE
  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / size))
  const requested = Number.isFinite(page) ? Math.floor(page) : 1
  // Clamp em vez de página vazia: filtrar não pode fazer a lista "sumir".
  const current = Math.min(Math.max(requested, 1), totalPages)
  const start = (current - 1) * size
  const visible = list.slice(start, start + size)
  return {
    rows:visible,
    page:current,
    totalPages,
    total,
    pageSize:size,
    from:total === 0 ? 0 : start + 1,
    to:total === 0 ? 0 : start + visible.length,
    hasPrevious:current > 1,
    hasNext:current < totalPages,
    // Paginação só atrapalha quando não há o que paginar.
    needed:total > size,
  }
}

// Texto do rodapé. Em português, concordância e zero exigem cuidado — por isso é testado.
export function paginationSummary(view) {
  if (!view || view.total === 0) return 'Nenhum lançamento'
  if (!view.needed) return `${view.total} lançamento${view.total === 1 ? '' : 's'}`
  return `${view.from}–${view.to} de ${view.total} lançamentos`
}

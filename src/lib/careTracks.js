// Helpers puros das esteiras de acompanhamento.

// "D-7", "D+1", "no dia". O rótulo precisa ser lido sem pensar: é a âncora da tarefa.
export function describeOffset(offsetDays) {
  const days = Number(offsetDays || 0)
  if (!Number.isFinite(days) || days === 0) return 'no dia'
  return days < 0 ? `D${days}` : `D+${days}`
}

// Ordena pela ordem cronológica do cuidado, não pela ordem de cadastro: a clínica cadastra
// os passos fora de ordem e espera ver a esteira na sequência em que ela acontece.
export function sortTrackSteps(steps = []) {
  return [...(steps || [])].sort((a, b) => {
    const offsetCmp = Number(a?.offset_days || 0) - Number(b?.offset_days || 0)
    if (offsetCmp !== 0) return offsetCmp
    return Number(a?.sort_order || 0) - Number(b?.sort_order || 0)
  })
}

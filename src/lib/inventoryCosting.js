// inventoryCosting.js — Fase 6 (fundação) do custo histórico / CMV. PURO e testável.
//
// Processa os movimentos de estoque em ordem cronológica mantendo um CUSTO MÉDIO MÓVEL por produto.
// Cada venda recebe o custo médio vigente NO MOMENTO da venda (custo histórico) — assim a margem e a
// DRE não mudam retroativamente se o preço de compra for alterado depois.
//   CMV da venda = quantidade × custo médio móvel até a data da venda.
// Projeção: derivado do histórico de movimentos. App ainda não lê/escreve daqui.
// Design: docs/superpowers/specs/2026-10-12-financial-core-ledger-design.md
import { buildInventoryMovements } from './inventoryLedger.js'

const IN_TYPES = new Set(['opening', 'purchase', 'adjustment_in', 'return_in'])
const OUT_TYPES = new Set(['sale', 'adjustment_out', 'loss', 'return_out'])

function num(v) { return Number(v) || 0 }
function round2(n) { return Math.round(num(n) * 100) / 100 }

// Ordena para o cálculo: abertura primeiro, depois por data; no mesmo dia, entradas antes de saídas
// (uma compra do dia fica disponível para uma venda do mesmo dia).
function chronological(movements) {
  const rank = m => (m.movement_type === 'opening' ? 0 : (IN_TYPES.has(m.movement_type) ? 1 : 2))
  return movements.slice().sort((a, b) => {
    const da = a.movement_date || '', db = b.movement_date || ''
    if (da !== db) {
      if (!da) return -1
      if (!db) return 1
      return da.localeCompare(db)
    }
    return rank(a) - rank(b)
  })
}

// Retorna { salesCost: { [saleId]: { unitCost, totalCost } }, averageByProduct, cmvTotal }.
export function buildProductCosting(data = {}) {
  const movements = chronological(buildInventoryMovements(data))
  const pool = {} // productId -> { qty, totalCost }
  const salesCost = {}
  let cmvTotal = 0

  for (const m of movements) {
    const p = (pool[m.product_id] ||= { qty: 0, totalCost: 0 })
    if (IN_TYPES.has(m.movement_type)) {
      p.qty = round2(p.qty + num(m.quantity))
      p.totalCost = round2(p.totalCost + num(m.total_cost != null ? m.total_cost : num(m.unit_cost) * num(m.quantity)))
    } else if (OUT_TYPES.has(m.movement_type)) {
      const avg = p.qty > 0 ? p.totalCost / p.qty : 0
      const qty = num(m.quantity)
      const unitCost = round2(avg)
      const totalCost = round2(avg * qty)
      if (m.movement_type === 'sale' && m.source_id) {
        salesCost[m.source_id] = { unitCost, totalCost }
        cmvTotal = round2(cmvTotal + totalCost)
      }
      // consome o pool pelo custo médio vigente
      p.qty = round2(p.qty - qty)
      p.totalCost = round2(p.qty > 0 ? p.totalCost - totalCost : 0)
    }
  }

  const averageByProduct = {}
  for (const [id, p] of Object.entries(pool)) {
    averageByProduct[id] = p.qty > 0 ? round2(p.totalCost / p.qty) : 0
  }
  return { salesCost, averageByProduct, cmvTotal }
}

import { expect, test } from '@playwright/test'
import { buildInventoryMovements, stockByProduct } from '../../src/lib/inventoryLedger.js'

const data = {
  products: [
    { id: 'A', stock: 10, purchasePrice: 5 },
    { id: 'B', stock: 0, purchasePrice: 2 },
  ],
  productPurchases: [
    { id: 'c1', productId: 'A', quantity: 4, totalValue: 20, purchaseDate: '2026-09-01', status: 'pago' },
    { id: 'c2', productId: 'B', quantity: 6, totalValue: 12, purchaseDate: '2026-09-02', status: 'pago' },
    { id: 'c3', productId: 'A', quantity: 99, totalValue: 500, status: 'cancelado' }, // cancelada: ignora
  ],
  productSales: [
    { id: 'v1', productId: 'A', quantity: 3, unitValue: 9, saleDate: '2026-09-05', paymentStatus: 'recebido' },
    { id: 'v2', productId: 'B', quantity: 2, unitValue: 4, saleDate: '2026-09-06', paymentStatus: 'pendente' },
    { id: 'v3', productId: 'B', quantity: 5, unitValue: 4, paymentStatus: 'cancelado' }, // cancelada: ignora
  ],
}

test('deriva abertura + compras + vendas; ignora cancelados', () => {
  const mov = buildInventoryMovements(data)
  // A: opening + 1 compra válida + 1 venda = 3; B: 1 compra + 1 venda = 2 (sem opening pois stock 0)
  expect(mov.filter(m => m.product_id === 'A')).toHaveLength(3)
  expect(mov.filter(m => m.product_id === 'B')).toHaveLength(2)
  expect(mov.some(m => m.movement_type === 'opening' && m.product_id === 'A' && m.quantity === 10)).toBe(true)
  const compraA = mov.find(m => m.source_id === 'c1')
  expect(compraA).toMatchObject({ movement_type: 'purchase', quantity: 4, unit_cost: 5, total_cost: 20 })
})

test('saldo = soma dos movimentos e bate com inicial + compras - vendas', () => {
  const stock = stockByProduct(buildInventoryMovements(data))
  // A: 10 + 4 - 3 = 11 ; B: 0 + 6 - 2 = 4
  expect(stock.A).toBe(11)
  expect(stock.B).toBe(4)
})

test('tipos de ajuste/perda/devolução entram no saldo pelo sinal correto', () => {
  const movements = [
    { product_id: 'X', movement_type: 'opening', quantity: 10 },
    { product_id: 'X', movement_type: 'loss', quantity: 2 },         // -2
    { product_id: 'X', movement_type: 'adjustment_in', quantity: 1 },// +1
    { product_id: 'X', movement_type: 'return_out', quantity: 3 },   // -3
  ]
  expect(stockByProduct(movements).X).toBe(6)
})

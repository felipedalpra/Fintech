import { expect, test } from '@playwright/test'
import { buildProductCosting } from '../../src/lib/inventoryCosting.js'

test('custo médio móvel: venda usa o histórico, não o preço de compra atual', () => {
  // A: abertura 10 @ 5 (custo 50) + compra 10 @ 8 (custo 80) => pool 20, total 130, média 6,5
  // Venda 5 => CMV unit 6,5 (nem 5 da abertura, nem 8 da última compra).
  const data = {
    products: [{ id: 'A', stock: 10, purchasePrice: 5 }],
    productPurchases: [{ id: 'c1', productId: 'A', quantity: 10, totalValue: 80, purchaseDate: '2026-09-01', status: 'pago' }],
    productSales: [{ id: 'v1', productId: 'A', quantity: 5, unitValue: 20, saleDate: '2026-09-05', paymentStatus: 'recebido' }],
  }
  const { salesCost, cmvTotal } = buildProductCosting(data)
  expect(salesCost.v1).toEqual({ unitCost: 6.5, totalCost: 32.5 })
  expect(cmvTotal).toBe(32.5)
})

test('compra posterior à venda não muda o CMV da venda anterior', () => {
  const data = {
    products: [{ id: 'A', stock: 10, purchasePrice: 5 }],
    productSales: [{ id: 'v1', productId: 'A', quantity: 4, unitValue: 20, saleDate: '2026-09-02', paymentStatus: 'recebido' }],
    productPurchases: [{ id: 'c1', productId: 'A', quantity: 10, totalValue: 100, purchaseDate: '2026-09-10', status: 'pago' }],
  }
  const { salesCost } = buildProductCosting(data)
  // Na data da venda (02/09) a média era 5 (só a abertura). A compra de 10/09 (@10) não afeta.
  expect(salesCost.v1).toEqual({ unitCost: 5, totalCost: 20 })
})

test('compra no mesmo dia da venda fica disponível (entra antes da saída)', () => {
  const data = {
    products: [{ id: 'B', stock: 0, purchasePrice: 0 }],
    productPurchases: [{ id: 'c1', productId: 'B', quantity: 10, totalValue: 70, purchaseDate: '2026-09-05', status: 'pago' }],
    productSales: [{ id: 'v1', productId: 'B', quantity: 2, unitValue: 15, saleDate: '2026-09-05', paymentStatus: 'recebido' }],
  }
  const { salesCost } = buildProductCosting(data)
  expect(salesCost.v1).toEqual({ unitCost: 7, totalCost: 14 })
})

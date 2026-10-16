import { expect, test } from '@playwright/test'
import { today } from '../../src/utils.js'

test('today usa a data civil local mesmo quando o UTC já está no dia seguinte', () => {
  const lateLocalTime = new Date(2026, 9, 15, 22, 30, 0)
  expect(today(lateLocalTime)).toBe('2026-10-15')
})

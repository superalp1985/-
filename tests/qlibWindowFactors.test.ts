import { describe, expect, it } from 'vitest'
import { alpha158Factors, buildFactorGraph } from '../src/factors'
import { calculateGraphFactor } from '../src/graphRuntime'
import type { FactorRow } from '../src/factor'

const settings = { window: 20, minSamples: 5, descending: true }

function evaluate(name: string, rows: FactorRow[]) {
  const factor = alpha158Factors.find((item) => item.name === name)!
  const graph = buildFactorGraph(factor)
  const result = calculateGraphFactor(rows, graph.edges, graph.nodes, settings)
  expect(result.supported).toBe(true)
  expect(result.warnings).toEqual([])
  return result.points.map((point) => point.factor)
}

const closes = [10, 10.4, 10.2, 10.8, 10.6]
const highs = [10.2, 10.6, 10.5, 11, 10.9]
const lows = [9.8, 10, 10, 10.4, 10.3]
const rows = closes.map((close, index) => ({
  timestamp: `2026-01-0${index + 1}`, asset: 'A', open: close, close,
  high: highs[index], low: lows[index],
}))

describe('Qlib trend, quantile and extreme-position factors', () => {
  it.each([
    ['ROC', (n: number) => `Ref($close,${n})/$close`],
    ['BETA', (n: number) => `Slope($close,${n})/$close`],
    ['QTLU', (n: number) => `Quantile($close,${n},0.8)/$close`],
    ['QTLD', (n: number) => `Quantile($close,${n},0.2)/$close`],
    ['IMAX', (n: number) => `IdxMax($high,${n})/${n}`],
    ['IMIN', (n: number) => `IdxMin($low,${n})/${n}`],
    ['IMXD', (n: number) => `(IdxMax($high,${n})-IdxMin($low,${n}))/${n}`],
  ] as const)('preserves the official %s expression for every window', (name, expression) => {
    for (const n of [5, 10, 20, 30, 60]) {
      expect(alpha158Factors.find((factor) => factor.name === `${name}${n}`)?.expression).toBe(expression(n))
    }
  })

  it('uses n lags, not n observations, for the inverse-price ROC', () => {
    expect(evaluate('ROC5', rows)).toEqual([null, null, null, null, null])
    const history = [{ ...rows[0], timestamp: '2025-12-31' }, ...rows]
    expect(evaluate('ROC5', history).at(-1)).toBeCloseTo(10 / 10.6, 12)
  })

  it.each([
    ['BETA5', 0.16 / 10.6], ['QTLU5', 10.64 / 10.6], ['QTLD5', 10.16 / 10.6],
    ['IMAX5', 4 / 5], ['IMIN5', 1 / 5], ['IMXD5', 3 / 5],
  ])('matches the hand calculation for %s', (name, expected) => {
    expect(evaluate(String(name), rows).at(-1)).toBeCloseTo(Number(expected), 12)
  })

  it('imports Qlib partial-window semantics without changing the fixed denominator', () => {
    expect(evaluate('IMAX20', rows.slice(0, 2))).toEqual([1 / 20, 2 / 20])
    expect(evaluate('IMIN20', rows.slice(0, 2))).toEqual([1 / 20, 1 / 20])
    expect(evaluate('QTLU20', rows.slice(0, 1))).toEqual([1])
    const beta = evaluate('BETA20', rows.slice(0, 2))
    expect(beta[0]).toBeNull()
    expect(beta[1]).toBeCloseTo(0.4 / 10.4, 12)
  })

  it('takes the oldest tied extreme and keeps the sign of high-minus-low', () => {
    const ties = rows.map((row, index) => ({
      ...row, high: [11, 10, 11, 10, 11][index], low: [9, 8, 8, 9, 8][index],
    }))
    expect(evaluate('IMAX5', ties).at(-1)).toBe(1 / 5)
    expect(evaluate('IMIN5', ties).at(-1)).toBe(2 / 5)
    expect(evaluate('IMXD5', ties).at(-1)).toBe(-1 / 5)
  })

  it('keeps missing dates in the slope time axis and skips them for quantiles', () => {
    const missing = [10, null, 14].map((close, index) => ({
      timestamp: `2026-01-0${index + 1}`, asset: 'A', open: 10, close,
    }))
    expect(evaluate('BETA5', missing).at(-1)).toBeCloseTo(2 / 14, 12)
    expect(evaluate('QTLU5', missing).at(-1)).toBeCloseTo(13.2 / 14, 12)
    expect(evaluate('QTLD5', missing).at(-1)).toBeCloseTo(10.8 / 14, 12)
  })

  it('preserves the upstream raw-argmax NaN position instead of compressing missing dates', () => {
    const missing = rows.map((row, index) => ({
      ...row, high: index === 1 ? null : row.high, low: index === 2 ? null : row.low,
    }))
    expect(evaluate('IMAX5', missing).at(-1)).toBe(2 / 5)
    expect(evaluate('IMIN5', missing).at(-1)).toBe(3 / 5)
    expect(evaluate('IMXD5', missing).at(-1)).toBe(-1 / 5)
    const empty = rows.map((row) => ({ ...row, high: null, low: null }))
    expect(evaluate('IMAX5', empty).every((value) => value === null)).toBe(true)
  })

  it('rolls extreme positions within each asset, not across assets or the full history', () => {
    const history = [5, 4, 3, 2, 1, 9].flatMap((high, index) => [
      { timestamp: `2026-01-0${index + 1}`, asset: 'A', open: 1, close: 1, high, low: -high },
      { timestamp: `2026-01-0${index + 1}`, asset: 'B', open: 1, close: 1, high: 10, low: 0 },
    ])
    expect(evaluate('IMAX5', history).slice(-2)).toEqual([1, 1 / 5])
    expect(evaluate('IMIN5', history).slice(-2)).toEqual([1, 1 / 5])
  })
})

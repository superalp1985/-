import { describe, expect, it } from 'vitest'
import { alpha158Factors, alpha360Factors, buildFactorGraph } from '../src/factors'
import { compileGraphExpression } from '../src/graph'
import { calculateGraphFactor } from '../src/graphRuntime'

const settings = { window: 20, minSamples: 5, descending: true }
const rows = [10, 10.4, 10.2, 10.2, 10.8, 10.6].map((close, index) => ({
  asset: 'A', timestamp: `2026-01-0${index + 1}`, open: close, close,
  volume: [100, 120, 90, 90, 150, 130][index],
}))

function values(name: string, input = rows) {
  const graph = buildFactorGraph(alpha158Factors.find((factor) => factor.name === name)!)
  const result = calculateGraphFactor(input, graph.edges, graph.nodes, settings)
  expect(result.warnings).toEqual([])
  expect(result.supported).toBe(true)
  return result.points.map((point) => point.factor)
}

describe('remaining Qlib families', () => {
  it('connects every operand of every registered factor, including literal zero', () => {
    for (const factor of [...alpha158Factors, ...alpha360Factors]) {
      const graph = buildFactorGraph(factor)
      expect(compileGraphExpression(graph.nodes, graph.edges, settings).warnings, factor.name).toEqual([])
    }
  })

  it.each([
    ['CNTP5', 0.4], ['CNTN5', 0.4], ['CNTD5', 0],
    ['SUMP5', 1 / (1.4 + 1e-12)], ['SUMN5', 0.4 / (1.4 + 1e-12)],
    ['SUMD5', 0.6 / (1.4 + 1e-12)], ['VMA5', 116 / (130 + 1e-12)],
    ['VSTD5', Math.sqrt(680) / (130 + 1e-12)],
    ['VSUMP5', 80 / (130 + 1e-12)], ['VSUMN5', 50 / (130 + 1e-12)],
    ['VSUMD5', 30 / (130 + 1e-12)],
  ])('matches the six-row hand example for %s', (name, expected) => {
    expect(values(String(name)).at(-1)).toBeCloseTo(Number(expected), 10)
  })

  it('uses Qlib false comparisons for missing history, not omitted observations', () => {
    expect(values('CNTP5', rows.slice(0, 2))).toEqual([0, 0.5])
    expect(values('CNTN5', rows.slice(0, 2))).toEqual([0, 0])
  })

  it('returns zero for flat magnitude shares instead of dropping the zero operand', () => {
    const flat = rows.map((row) => ({ ...row, close: 10, volume: 100 }))
    for (const name of ['SUMP5', 'SUMN5', 'SUMD5', 'VSUMP5', 'VSUMN5', 'VSUMD5', 'WVMA5']) {
      expect(values(name, flat).at(-1), name).toBe(0)
    }
  })

  it('masks almost-constant correlation inputs with the Qlib tolerance', () => {
    const almostFlat = rows.map((row, index) => ({ ...row, close: 10 + index * 1e-7 }))
    expect(values('CORR5', almostFlat).at(-1)).toBeNull()
  })

  it('does not rank yesterday when the current value is missing', () => {
    const graph = buildFactorGraph(alpha158Factors.find((factor) => factor.name === 'RANK5')!)
    graph.nodes.find((node) => node.data.blockId === 'ts_rank')!.data.parameters!.min_samples = 1
    const input = rows.map((row, index) => ({ ...row, close: index === 5 ? null : row.close }))
    const result = calculateGraphFactor(input, graph.edges, graph.nodes, { ...settings, minSamples: 1 })
    expect(result.points.at(-1)?.factor).toBeNull()
  })

  it('retains missing observation positions in regression fit and residual', () => {
    const input = [10, null, 14, 16, 18].map((close, index) => ({
      asset: 'A', timestamp: `2026-01-0${index + 1}`, open: 10, close,
    }))
    for (const [name, expected] of [['RSQR5', 1], ['RESI5', 0]] as const) {
      const graph = buildFactorGraph(alpha158Factors.find((factor) => factor.name === name)!)
      for (const node of graph.nodes) if (node.data.parameters?.min_samples) node.data.parameters.min_samples = 1
      const result = calculateGraphFactor(input, graph.edges, graph.nodes, settings)
      expect(result.points.at(-1)?.factor, name).toBeCloseTo(expected, 10)
    }
  })
})

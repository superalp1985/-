import { describe, expect, it } from 'vitest'
import { calculateGraphFactor } from '../src/graphRuntime'
import type { GraphEdge, GraphNode } from '../src/graph'

const settings = { window: 3, minSamples: 3, descending: true }

function node(id: string, blockId: string, extra: Partial<GraphNode['data']> = {}): GraphNode {
  return { id, data: { blockId, kind: blockId === 'factor_output' ? 'output' : 'operator', ...extra } }
}

function edge(source: string, target: string, targetHandle: string): GraphEdge {
  return { source, target, targetHandle }
}

const rows = [
  { timestamp: '2026-01-01', asset: 'A', open: 10, close: 2 },
  { timestamp: '2026-01-01', asset: 'B', open: 20, close: 4 },
  { timestamp: '2026-01-02', asset: 'A', open: 10, close: 3 },
  { timestamp: '2026-01-02', asset: 'B', open: 20, close: 5 },
]

describe('graph runtime', () => {
  it('evaluates connected constants and binary math instead of blocking the local run', () => {
    const nodes = [
      node('close', 'field_close', { kind: 'input' }),
      node('constant', 'constant', { parameters: { value: 2 } }),
      node('add', 'add'),
      node('power', 'power', { parameters: { exponent: 2 } }),
      node('output', 'factor_output'),
    ]
    const edges = [
      edge('close', 'add', 'left'),
      edge('constant', 'add', 'right'),
      edge('add', 'power', 'left'),
      edge('power', 'output', 'value'),
    ]

    const result = calculateGraphFactor(rows, edges, nodes, settings)

    expect(result.supported).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.points.map((point) => point.factor)).toEqual([16, 36, 25, 49])
  })

  it('covers every registered arithmetic operator in the local runtime', () => {
    const sourceRows = [
      { timestamp: '2026-01-01', asset: 'A', open: 1, close: 2 },
      { timestamp: '2026-01-01', asset: 'B', open: 1, close: -3 },
      { timestamp: '2026-01-01', asset: 'C', open: 1, close: 4 },
    ]
    const cases: Array<{
      blockId: string
      parameters?: Record<string, number>
      constants?: Array<{ id: string; port: string; value: number }>
      expected: Array<number | null>
    }> = [
      { blockId: 'add', constants: [{ id: 'right', port: 'right', value: 2 }], expected: [4, -1, 6] },
      { blockId: 'subtract', constants: [{ id: 'right', port: 'right', value: 2 }], expected: [0, -5, 2] },
      { blockId: 'multiply', constants: [{ id: 'right', port: 'right', value: 2 }], expected: [4, -6, 8] },
      { blockId: 'divide', constants: [{ id: 'right', port: 'right', value: 2 }], expected: [1, -1.5, 2] },
      { blockId: 'power', parameters: { exponent: 2 }, expected: [4, 9, 16] },
      { blockId: 'abs', expected: [2, 3, 4] },
      { blockId: 'negate', expected: [-2, 3, -4] },
      { blockId: 'log', expected: [Math.log(2), null, Math.log(4)] },
      { blockId: 'exp', expected: [Math.exp(2), Math.exp(-3), Math.exp(4)] },
      { blockId: 'sqrt', expected: [Math.sqrt(2), null, 2] },
      { blockId: 'sign', expected: [1, -1, 1] },
      { blockId: 'maximum', constants: [{ id: 'right', port: 'right', value: 1 }], expected: [2, 1, 4] },
      { blockId: 'minimum', constants: [{ id: 'right', port: 'right', value: 1 }], expected: [1, -3, 1] },
      {
        blockId: 'clip',
        constants: [{ id: 'low', port: 'low', value: -1 }, { id: 'high', port: 'high', value: 1 }],
        expected: [1, -1, 1],
      },
    ]

    for (const testCase of cases) {
      const nodes = [
        node('close', 'field_close', { kind: 'input' }),
        ...(testCase.constants ?? []).map((constant) => node(`constant-${constant.id}`, 'constant', { parameters: { value: constant.value } })),
        node('operator', testCase.blockId, { parameters: testCase.parameters }),
        node('output', 'factor_output'),
      ]
      const inputPort = testCase.blockId === 'power' ? 'left' : testCase.blockId === 'clip' ? 'series' : ['add', 'subtract', 'multiply', 'divide', 'maximum', 'minimum'].includes(testCase.blockId) ? 'left' : 'series'
      const edges = [edge('close', 'operator', inputPort), ...(testCase.constants ?? []).map((constant) => edge(`constant-${constant.id}`, 'operator', constant.port)), edge('operator', 'output', 'value')]
      const result = calculateGraphFactor(sourceRows, edges, nodes, settings)

      expect(result.supported, testCase.blockId).toBe(true)
      testCase.expected.forEach((expected, index) => {
        const actual = result.points[index].factor
        if (expected === null) expect(actual).toBeNull()
        else expect(actual).toBeCloseTo(expected, 8)
      })
    }
  })

  it('evaluates the built-in unary math family and preserves nulls', () => {
    const sourceRows = [
      { timestamp: '2026-01-01', asset: 'A', open: 1, close: -4 },
      { timestamp: '2026-01-01', asset: 'B', open: 1, close: null },
      { timestamp: '2026-01-02', asset: 'A', open: 1, close: 9 },
      { timestamp: '2026-01-02', asset: 'B', open: 1, close: -1 },
    ]
    const nodes = [
      node('close', 'field_close', { kind: 'input' }),
      node('abs', 'abs'),
      node('sqrt', 'sqrt'),
      node('output', 'factor_output'),
    ]
    const edges = [edge('close', 'abs', 'series'), edge('abs', 'sqrt', 'series'), edge('sqrt', 'output', 'value')]

    const result = calculateGraphFactor(sourceRows, edges, nodes, settings)

    expect(result.supported).toBe(true)
    expect(result.points.map((point) => point.factor)).toEqual([2, null, 3, 1])
  })

  it('evaluates a user-authored custom formula with common math functions', () => {
    const nodes = [
      node('close', 'field_close', { kind: 'input' }),
      node('custom', 'custom_formula', { customExpression: 'np.log(x + 1) * 2' }),
      node('output', 'factor_output'),
    ]
    const edges = [edge('close', 'custom', 'series'), edge('custom', 'output', 'value')]

    const result = calculateGraphFactor(rows, edges, nodes, settings)

    expect(result.supported).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.points[0].factor).toBeCloseTo(Math.log(3) * 2, 10)
    expect(result.points[3].factor).toBeCloseTo(Math.log(6) * 2, 10)
  })

  it('evaluates optional scalar ports, clipping, comparisons, and conditional output', () => {
    const sourceRows = [
      { timestamp: '2026-01-01', asset: 'A', open: 1, close: -4 },
      { timestamp: '2026-01-01', asset: 'B', open: 1, close: null },
      { timestamp: '2026-01-02', asset: 'A', open: 1, close: 9 },
      { timestamp: '2026-01-02', asset: 'B', open: 1, close: -0.5 },
    ]
    const nodes = [
      node('close', 'field_close', { kind: 'input' }),
      node('low', 'constant', { parameters: { value: -1 } }),
      node('high', 'constant', { parameters: { value: 1 } }),
      node('clip', 'clip'),
      node('threshold', 'greater', { parameters: { threshold: 0 } }),
      node('fallback', 'constant', { parameters: { value: 100 } }),
      node('where', 'where'),
      node('output', 'factor_output'),
    ]
    const edges = [
      edge('close', 'clip', 'series'),
      edge('low', 'clip', 'low'),
      edge('high', 'clip', 'high'),
      edge('close', 'threshold', 'left'),
      edge('threshold', 'where', 'condition'),
      edge('close', 'where', 'when_true'),
      edge('fallback', 'where', 'when_false'),
      edge('where', 'output', 'value'),
    ]

    const result = calculateGraphFactor(sourceRows, edges, nodes, settings)

    expect(result.supported).toBe(true)
    expect(result.points.map((point) => point.factor)).toEqual([100, null, 9, 100])
  })

  it('fills a missing series value through a connected cleaning rule', () => {
    const sourceRows = [
      { timestamp: '2026-01-01', asset: 'A', open: 1, close: null },
      { timestamp: '2026-01-02', asset: 'A', open: 1, close: 3 },
    ]
    const nodes = [
      node('close', 'field_close', { kind: 'input' }),
      node('fill', 'fill_missing', { parameters: { value: 7 } }),
      node('output', 'factor_output'),
    ]
    const edges = [edge('close', 'fill', 'series'), edge('fill', 'output', 'value')]

    const result = calculateGraphFactor(sourceRows, edges, nodes, settings)

    expect(result.supported).toBe(true)
    expect(result.points.map((point) => point.factor)).toEqual([7, 3])
  })

  it('runs time-series and cross-sectional nodes through the same runtime', () => {
    const nodes = [
      node('close', 'field_close', { kind: 'input' }),
      node('mean', 'ts_mean', { parameters: { window: 2, min_samples: 2 } }),
      node('zscore', 'cs_zscore'),
      node('output', 'factor_output'),
    ]
    const edges = [edge('close', 'mean', 'series'), edge('mean', 'zscore', 'series'), edge('zscore', 'output', 'value')]

    const result = calculateGraphFactor(rows, edges, nodes, settings)

    expect(result.supported).toBe(true)
    expect(result.points.slice(0, 2).every((point) => point.factor === null)).toBe(true)
    expect(result.points.slice(2).every((point) => Number.isFinite(point.factor ?? Number.NaN))).toBe(true)
  })

  it('matches Qlib rolling standard deviation with the sample denominator', () => {
    const sourceRows = [1, 2, 3].map((close, index) => ({
      timestamp: `2026-01-0${index + 1}`,
      asset: 'A',
      open: close,
      close,
    }))
    const nodes = [
      node('close', 'field_close', { kind: 'input' }),
      node('std', 'ts_std', { parameters: { window: 3, min_samples: 3 } }),
      node('output', 'factor_output'),
    ]
    const edges = [edge('close', 'std', 'series'), edge('std', 'output', 'value')]

    const result = calculateGraphFactor(sourceRows, edges, nodes, settings)

    expect(result.points.map((point) => point.factor)).toEqual([null, null, 1])
  })
})

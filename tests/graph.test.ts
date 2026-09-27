import { describe, expect, it } from 'vitest'
import { compileGraphExpression, compileGraphPython, isLocalCalculationSupported } from '../src/graph'

const settings = { window: 5, minSamples: 5, descending: true }

const nodes = [
  { id: 'market-input', data: { blockId: 'market_data', kind: 'input' as const } },
  { id: 'ratio', data: { blockId: 'close_open_ratio', kind: 'operator' as const } },
  { id: 'ts-rank', data: { blockId: 'ts_rank', kind: 'operator' as const } },
  { id: 'cs-zscore', data: { blockId: 'cs_zscore', kind: 'operator' as const } },
  { id: 'factor-output', data: { blockId: 'factor_output', kind: 'output' as const } },
]

const edges = [
  { source: 'market-input', target: 'ratio' },
  { source: 'ratio', target: 'ts-rank' },
  { source: 'ts-rank', target: 'cs-zscore' },
  { source: 'cs-zscore', target: 'factor-output' },
]

describe('factor graph compiler', () => {
  it('derives the mathematical expression from the output path', () => {
    expect(compileGraphExpression(nodes, edges, settings)).toEqual({
      expression: 'Cs_ZScore(Ts_Rank(Close / Open, 5, desc, min_samples=5))',
      warnings: [],
    })
  })

  it('emits framework-free Python for the same graph', () => {
    const code = compileGraphPython(nodes, edges, settings)

    expect(code).toContain('def compute_factor(df, window=5, min_samples=5, descending=True):')
    expect(code).toContain('ratio = df["close"] / df["open"]')
    expect(code).toContain('ts_rank = rolling_rank(ratio, window=window, by="asset", min_samples=min_samples, descending=descending)')
    expect(code).toContain('factor_value = cross_sectional_zscore(ts_rank, by="timestamp")')
    expect(code).toContain('import pandas as pd')
    expect(code).toContain('def rolling_rank(values, window, by="asset", min_samples=1, descending=True):')
    expect(code).toContain('def cross_sectional_zscore(values, by="timestamp"):')
    expect(code).toContain('return factor_value')
  })

  it('reports an unsupported block instead of silently inventing its meaning', () => {
    const result = compileGraphExpression(
      [{ id: 'output', data: { blockId: 'factor_output', kind: 'output' as const } }, { id: 'mystery', data: { blockId: 'not_registered', kind: 'operator' as const, title: '未知积木' } }],
      [{ source: 'mystery', target: 'output' }],
      settings,
    )

    expect(result.expression).toBe('未知积木')
    expect(result.warnings).toEqual(['未知积木：尚未注册程序语义'])
  })

  it('uses numeric parameters and port identities in the compiled expression', () => {
    const nodesWithParameters = [
      { id: 'close', data: { blockId: 'field_close', kind: 'input' as const } },
      { id: 'clip', data: { blockId: 'clip', kind: 'operator' as const, parameters: { low: -0.2, high: 0.8 } } },
      { id: 'output', data: { blockId: 'factor_output', kind: 'output' as const } },
    ]
    const portEdges = [
      { source: 'close', target: 'clip', targetHandle: 'series' },
      { source: 'clip', target: 'output', targetHandle: 'value' },
    ]

    expect(compileGraphExpression(nodesWithParameters, portEdges, settings).expression).toBe('Clip(Close, -0.2, 0.8)')
    expect(compileGraphPython(nodesWithParameters, portEdges, settings)).toContain('np.clip(df["close"], -0.2, 0.8)')
  })

  it('falls back to editable parameter values when an optional numeric port is not connected', () => {
    const nodesWithParameters = [
      { id: 'close', data: { blockId: 'field_close', kind: 'input' as const } },
      { id: 'power', data: { blockId: 'power', kind: 'operator' as const, parameters: { exponent: 3 } } },
      { id: 'output', data: { blockId: 'factor_output', kind: 'output' as const } },
    ]
    const portEdges = [
      { source: 'close', target: 'power', targetHandle: 'left' },
      { source: 'power', target: 'output', targetHandle: 'value' },
    ]

    expect(compileGraphExpression(nodesWithParameters, portEdges, settings).expression).toBe('Pow(Close, 3)')
  })

  it('preserves very small constants used to prevent division by zero', () => {
    const nodesWithSmallConstant = [
      { id: 'constant', data: { blockId: 'constant', kind: 'input' as const, parameters: { value: 1e-12 } } },
      { id: 'output', data: { blockId: 'factor_output', kind: 'output' as const } },
    ]
    const constantEdges = [
      { source: 'constant', target: 'output', targetHandle: 'value' },
    ]

    expect(compileGraphExpression(nodesWithSmallConstant, constantEdges, settings).expression).toBe('1e-12')
    expect(compileGraphPython(nodesWithSmallConstant, constantEdges, settings)).toContain('return 1e-12')
  })

  it('recognizes the atomically connected demo factor as locally executable', () => {
    expect(isLocalCalculationSupported('Cs_ZScore(Ts_Rank((Close / Open), 7, desc, min_samples=5))')).toBe(true)
    expect(isLocalCalculationSupported('Cs_ZScore(Ts_Mean(Close, 7))')).toBe(false)
  })

  it('compiles a user-authored custom formula block into the same pure outputs', () => {
    const customNodes = [
      { id: 'close', data: { blockId: 'field_close', kind: 'input' as const } },
      { id: 'custom', data: { blockId: 'custom_formula', kind: 'operator' as const, customExpression: 'x * 2' } },
      { id: 'output', data: { blockId: 'factor_output', kind: 'output' as const } },
    ]
    const customEdges = [
      { source: 'close', target: 'custom', targetHandle: 'series' },
      { source: 'custom', target: 'output', targetHandle: 'value' },
    ]

    expect(compileGraphExpression(customNodes, customEdges, settings).expression).toBe('Close * 2')
    expect(compileGraphPython(customNodes, customEdges, settings)).toContain('node_custom = df["close"] * 2')
  })

  it('keeps an explicitly edited ranking direction in exported Python', () => {
    const editedNodes = [
      { id: 'close', data: { blockId: 'field_close', kind: 'input' as const } },
      { id: 'rank', data: { blockId: 'ts_rank', kind: 'operator' as const, parameters: { window: 9, min_samples: 6, descending: false } } },
      { id: 'output', data: { blockId: 'factor_output', kind: 'output' as const } },
    ]
    const editedEdges = [
      { source: 'close', target: 'rank', targetHandle: 'series' },
      { source: 'rank', target: 'output', targetHandle: 'value' },
    ]

    const code = compileGraphPython(editedNodes, editedEdges, settings)
    expect(code).toContain('rolling_rank(df["close"], window=9, by="asset", min_samples=6, descending=False)')
    expect(code).toContain('base = np.count_nonzero(sample < current) if descending else np.count_nonzero(sample > current)')
  })
})

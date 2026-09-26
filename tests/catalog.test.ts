import { describe, expect, it } from 'vitest'
import {
  alpha158Factors,
  alpha360Factors,
  buildFactorGraph,
  factorSources,
} from '../src/factors'
import {
  blockCategories,
  blockDefinitions,
  getBlockDefinition,
} from '../src/blocks'

describe('Scratch-style block catalog', () => {
  it('contains a broad atomic vocabulary with readable grouped metadata', () => {
    expect(blockDefinitions).toHaveLength(60)
    expect(blockCategories.length).toBeGreaterThanOrEqual(6)
    expect(new Set(blockDefinitions.map((block) => block.id)).size).toBe(blockDefinitions.length)
    expect(blockDefinitions.every((block) => block.description && block.inputs && block.output)).toBe(true)
    expect(getBlockDefinition('divide')?.inputs.map((port) => port.id)).toEqual(['left', 'right'])
    expect(getBlockDefinition('ts_rank')?.inputs[0].label).toBe('序列')
  })
})

describe('open-source factor catalog', () => {
  it('generates the complete Qlib Alpha158 and Alpha360 source sets', () => {
    expect(alpha158Factors).toHaveLength(158)
    expect(alpha360Factors).toHaveLength(360)
    expect(alpha158Factors[0]).toMatchObject({ id: 'qlib-alpha158-kmid', name: 'KMID', source: factorSources.qlib })
    expect(alpha158Factors.some((factor) => factor.name === 'CORR60')).toBe(true)
    expect(alpha158Factors.find((factor) => factor.name === 'OPEN')?.expression).toBe('$open/$close')
    expect(alpha158Factors.find((factor) => factor.name === 'WVMA20')?.expression).toContain('Std(Abs($close/Ref($close,1)-1)*$volume,20)')
    expect(alpha360Factors.find((factor) => factor.name === 'CLOSE59')?.expression).toBe('Ref($close,59)/$close')
    expect(alpha360Factors.at(-1)?.name).toBe('VOLUME0')
    expect(alpha360Factors.at(-1)?.expression).toBe('$volume/($volume+1e-12)')
  })

  it('expands a source expression into connected atomic nodes', () => {
    const graph = buildFactorGraph({
      id: 'qlib-alpha158-ma5',
      name: 'MA5',
      family: 'Qlib Alpha158',
      source: factorSources.qlib,
      expression: 'Mean($close, 5)/$close',
    })

    expect(graph.nodes.map((node) => node.data.blockId)).toEqual([
      'field_close',
      'ts_mean',
      'field_close',
      'divide',
      'factor_output',
    ])
    expect(graph.edges.some((edge) => edge.targetHandle === 'series')).toBe(true)
    expect(graph.edges.some((edge) => edge.targetHandle === 'left')).toBe(true)
  })

  it('can expand every registered Qlib factor without a placeholder fallback', () => {
    for (const factor of [...alpha158Factors, ...alpha360Factors]) {
      const graph = buildFactorGraph(factor)
      expect(graph.nodes.at(-1)?.data.blockId, factor.name).toBe('factor_output')
      expect(graph.edges.length, factor.name).toBeGreaterThan(0)
      expect(graph.nodes.some((node) => node.data.blockId === 'constant' && node.data.parameters?.value === 0), factor.name).toBe(false)
    }
  })
})

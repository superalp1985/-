import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import reference from './fixtures/qlib-reference.json'
import { alpha158Factors, alpha360Factors, buildFactorGraph } from '../src/factors'
import { compileGraphPython } from '../src/graph'
import { calculateGraphFactor } from '../src/graphRuntime'
import type { FactorRow } from '../src/factor'

const settings = { window: 20, minSamples: 5, descending: true }
const catalog = [...alpha158Factors, ...alpha360Factors]
const rows: FactorRow[] = reference.rows
const cases = reference.factors.map((factor) => {
  const local = catalog.find((item) => item.name === factor.name && item.id.startsWith(`qlib-${factor.family}-`))!
  return { ...factor, local }
})
const python = process.env.PYTHON ?? 'python'
const available = spawnSync(python, ['-c', 'import numpy, pandas'], { encoding: 'utf8' }).status === 0

function compare(actual: Array<number | null>, expected: Array<number | null>, label: string) {
  expect(actual, label).toHaveLength(expected.length)
  expected.forEach((value, index) => {
    const context = `${label}, row ${index}`
    if (value === null) expect(actual[index], context).toBeNull()
    else {
      expect(actual[index], context).not.toBeNull()
      expect(Math.abs(actual[index]! - value), context).toBeLessThanOrEqual(1e-8 * Math.max(1, Math.abs(value)))
    }
  })
}

describe('all Qlib catalog expressions against the pinned independent reference', () => {
  it('covers every catalog entry exactly once and keeps the official formula', () => {
    expect(cases).toHaveLength(518)
    expect(new Set(cases.map((item) => item.local?.id)).size).toBe(518)
    for (const factor of cases) {
      expect(factor.local, factor.name).toBeDefined()
      expect(factor.local.expression.replace(/\s/g, '')).toBe(factor.expression.replace(/\s/g, ''))
    }
  })

  it.each(cases)('$family $name matches 130 reference observations', (factor) => {
    const graph = buildFactorGraph(factor.local)
    const result = calculateGraphFactor(rows, graph.edges, graph.nodes, settings)
    expect(result.supported).toBe(true)
    expect(result.warnings).toEqual([])
    compare(result.points.map((point) => point.factor), factor.expected, `${factor.family} ${factor.name}`)
  })

  it.skipIf(!available)('executes all 518 framework-free Python exports against the same reference', () => {
    const exports = cases.map((factor) => {
      const graph = buildFactorGraph(factor.local)
      return { name: `${factor.family} ${factor.name}`, code: compileGraphPython(graph.nodes, graph.edges, settings) }
    })
    const script = [
      'import sys, json, warnings',
      'import numpy as np',
      'import pandas as pd',
      'warnings.filterwarnings("ignore", category=RuntimeWarning)',
      'payload = json.load(sys.stdin)',
      'df = pd.DataFrame(payload["rows"])',
      'result = []',
      'for factor in payload["exports"]:',
      '    namespace = {}',
      '    exec(factor["code"], namespace)',
      '    values = namespace["compute_factor"](df)',
      '    result.append([None if not np.isfinite(value) else float(value) for value in values])',
      'print(json.dumps(result, allow_nan=False))',
    ].join('\n')
    const output = spawnSync(python, ['-c', script], {
      encoding: 'utf8', input: JSON.stringify({ rows, exports }),
      maxBuffer: 16 * 1024 * 1024, timeout: 120000,
    })
    expect(output.status, output.stderr).toBe(0)
    const actual: Array<Array<number | null>> = JSON.parse(output.stdout)
    expect(actual).toHaveLength(cases.length)
    cases.forEach((factor, index) => compare(actual[index], factor.expected, exports[index].name))
  }, 130000)
})

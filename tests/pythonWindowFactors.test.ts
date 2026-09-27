import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { alpha158Factors, buildFactorGraph } from '../src/factors'
import { compileGraphPython } from '../src/graph'
import { calculateGraphFactor } from '../src/graphRuntime'
import type { FactorRow } from '../src/factor'

const python = process.env.PYTHON ?? 'python'
const available = spawnSync(python, ['-c', 'import numpy, pandas'], { encoding: 'utf8' }).status === 0
const settings = { window: 20, minSamples: 5, descending: true }
const rows: FactorRow[] = [10, 10.4, null, 10.8, 10.6, 11].flatMap((close, index) => [
  {
    timestamp: `2026-01-0${index + 1}`, asset: 'A', open: 10, close,
    high: [11, 10.6, 11, null, 10.9, 12][index],
    low: [9.8, 9, null, 9, 10.3, 10.5][index],
  },
  { timestamp: `2026-01-0${index + 1}`, asset: 'B', open: 20, close: 20, high: 21, low: 19 },
])

describe.skipIf(!available)('executed framework-free Python window factors (requires numpy/pandas)', () => {
  it.each([
    ...['ROC5', 'BETA5', 'QTLU5', 'QTLD5', 'IMAX5', 'IMIN5', 'IMXD5'].map((name) => ({ name, minSamples: 1 })),
    { name: 'QTLU5', minSamples: 6 },
    { name: 'QTLD5', minSamples: -1 },
  ])(
    'matches browser results for $name (min_samples=$minSamples) with partial windows, gaps, ties and multiple assets',
    ({ name, minSamples }) => {
      const graph = buildFactorGraph(alpha158Factors.find((factor) => factor.name === name)!)
      for (const node of graph.nodes) {
        if (node.data.parameters?.min_samples !== undefined) node.data.parameters.min_samples = minSamples
      }
      const code = compileGraphPython(graph.nodes, graph.edges, settings)
      const script = [
        'import sys, json',
        'payload = json.load(sys.stdin)',
        'exec(payload["code"])',
        'values = compute_factor(pd.DataFrame(payload["rows"]))',
        'print(json.dumps([None if pd.isna(value) else float(value) for value in values], allow_nan=False))',
      ].join('\n')
      const output = spawnSync(python, ['-c', script], {
        encoding: 'utf8', input: JSON.stringify({ code, rows }),
      })
      expect(output.status, output.stderr).toBe(0)
      const actual: Array<number | null> = JSON.parse(output.stdout)
      const expected = calculateGraphFactor(rows, graph.edges, graph.nodes, settings).points.map((point) => point.factor)
      expect(actual).toHaveLength(expected.length)
      expected.forEach((value, index) => {
        if (value === null) expect(actual[index]).toBeNull()
        else expect(actual[index]).toBeCloseTo(value, 10)
      })
    },
  )
})

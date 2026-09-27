import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { alpha158Factors, buildFactorGraph } from '../src/factors'
import { compileGraphPython } from '../src/graph'
import { calculateGraphFactor } from '../src/graphRuntime'
import type { FactorRow } from '../src/factor'

const python = process.env.PYTHON ?? 'python'
const available = spawnSync(python, ['-c', 'import numpy, pandas'], { encoding: 'utf8' }).status === 0
const settings = { window: 5, minSamples: 1, descending: true }

describe.skipIf(!available)('Python export data boundaries', () => {
  it.each([
    { name: 'ROC5', reverse: true, zero: false },
    { name: 'VMA5', reverse: true, zero: false },
    { name: 'CORD5', reverse: false, zero: true },
    { name: 'SUMP5', reverse: true, zero: true },
    { name: 'CNTP5', reverse: true, zero: false, nullable: true },
    { name: 'CNTN5', reverse: true, zero: false, nullable: true },
    { name: 'CNTD5', reverse: true, zero: false, nullable: true },
    { name: 'CORR5', reverse: false, zero: false, descendingIndex: true },
  ].map((sample) => ({ nullable: false, descendingIndex: false, ...sample })))('preserves row order and finite results for $name (reverse=$reverse, zero=$zero)', ({ name, reverse, zero, nullable, descendingIndex }) => {
    const input: FactorRow[] = [10, 10.4, 10.2, 10.8, 10.6, 11].flatMap((close, index) => [
      { asset: 'A', timestamp: `2026-01-0${index + 1}`, open: 10, close: zero && index === 1 ? 0 : close, volume: zero && index === 1 ? 0 : 100 + index * 10 },
      { asset: 'B', timestamp: `2026-01-0${index + 1}`, open: 20, close: 20 + index, volume: 150 + index * 20 },
    ])
    const rows = reverse ? input.reverse() : input
    const graph = buildFactorGraph(alpha158Factors.find((factor) => factor.name === name)!)
    const code = compileGraphPython(graph.nodes, graph.edges, settings)
    const script = [
      'import sys, json',
      'payload = json.load(sys.stdin)',
      'exec(payload["code"])',
      'df = pd.DataFrame(payload["rows"])',
      'df.index = list(reversed(range(len(df)))) if payload["descendingIndex"] else [7] * len(df)',
      'if payload["nullable"]: df = df.convert_dtypes()',
      'original = df.copy(deep=True)',
      'result = compute_factor(df)',
      'pd.testing.assert_frame_equal(df, original)',
      'assert result.index.equals(df.index)',
      'assert not np.isinf(result.to_numpy(dtype=float)).any(), "infinity escaped the graph"',
      'print(json.dumps([None if pd.isna(value) else float(value) for value in result], allow_nan=False))',
    ].join('\n')
    const output = spawnSync(python, ['-c', script], { encoding: 'utf8', input: JSON.stringify({ code, rows, nullable, descendingIndex }) })
    expect(output.status, output.stderr).toBe(0)
    const actual: Array<number | null> = JSON.parse(output.stdout)
    const expected = calculateGraphFactor(rows, graph.edges, graph.nodes, settings).points.map((point) => point.factor)
    expect(actual).toHaveLength(expected.length)
    expected.forEach((value, index) => {
      if (value === null) expect(actual[index], `row ${index}`).toBeNull()
      else expect(actual[index], `row ${index}`).toBeCloseTo(value, 10)
    })
  })

  it.each(['ts_corr', 'ts_rsquare'])('keeps custom %s scale invariant in both runtimes', (blockId) => {
    const input = [1, 2, 3, 4, 5].map((value, index) => ({
      asset: 'A', timestamp: `2026-01-0${index + 1}`, open: value * 2e-6, close: value * 1e-6,
    }))
    const graph = {
      nodes: [
        { id: 'close', data: { blockId: 'field_close' } },
        { id: 'open', data: { blockId: 'field_open' } },
        { id: 'statistic', data: { blockId, parameters: { window: 5, min_samples: 5 } } },
        { id: 'output', data: { blockId: 'factor_output' } },
      ],
      edges: [
        { source: 'close', target: 'statistic', targetHandle: blockId === 'ts_corr' ? 'left' : 'series' },
        ...(blockId === 'ts_corr' ? [{ source: 'open', target: 'statistic', targetHandle: 'right' }] : []),
        { source: 'statistic', target: 'output', targetHandle: 'value' },
      ],
    }
    expect(calculateGraphFactor(input, graph.edges, graph.nodes, settings).points.at(-1)?.factor).toBeCloseTo(1, 10)
    const code = compileGraphPython(graph.nodes, graph.edges, settings)
    const output = spawnSync(python, ['-c', [
      'import sys, json',
      'payload = json.load(sys.stdin)',
      'exec(payload["code"])',
      'print(compute_factor(pd.DataFrame(payload["rows"])).iloc[-1])',
    ].join('\n')], { encoding: 'utf8', input: JSON.stringify({ code, rows: input }) })
    expect(output.status, output.stderr).toBe(0)
    expect(Number(output.stdout)).toBeCloseTo(1, 10)
  })

  it.each(['constant', 'scalar-division', 'close_open_ratio'])('returns an indexed finite series for %s', (mode) => {
    const nodes = mode === 'close_open_ratio'
      ? [{ id: 'value', data: { blockId: mode } }]
      : [{ id: 'value', data: { blockId: 'constant', parameters: { value: 7 } } }]
    if (mode === 'scalar-division') nodes.push(
      { id: 'zero', data: { blockId: 'constant', parameters: { value: 0 } } },
      { id: 'divide', data: { blockId: 'divide' } },
    )
    nodes.push({ id: 'output', data: { blockId: 'factor_output' } })
    const edges = [
      ...(mode === 'scalar-division' ? [
        { source: 'value', target: 'divide', targetHandle: 'left' },
        { source: 'zero', target: 'divide', targetHandle: 'right' },
      ] : []),
      { source: mode === 'scalar-division' ? 'divide' : 'value', target: 'output', targetHandle: 'value' },
    ]
    const input = [2, 0, 4].map((open, index) => ({
      asset: 'A', timestamp: `2026-01-0${3 - index}`, open, close: 8,
    }))
    const code = compileGraphPython(nodes, edges, settings)
    const output = spawnSync(python, ['-c', [
      'import sys, json',
      'payload = json.load(sys.stdin)',
      'exec(payload["code"])',
      'df = pd.DataFrame(payload["rows"], index=pd.Index([4, 4, 1], name="original"))',
      'result = compute_factor(df)',
      'assert isinstance(result, pd.Series)',
      'pd.testing.assert_index_equal(result.index, df.index)',
      'assert not np.isinf(result.to_numpy(dtype=float)).any()',
      'print(json.dumps([None if pd.isna(value) else float(value) for value in result], allow_nan=False))',
    ].join('\n')], { encoding: 'utf8', input: JSON.stringify({ code, rows: input }) })
    expect(output.status, output.stderr).toBe(0)
    expect(JSON.parse(output.stdout)).toEqual(calculateGraphFactor(input, edges, nodes, settings).points.map((point) => point.factor))
  })
})

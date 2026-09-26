import { describe, expect, it } from 'vitest'
import {
  calculateFactor,
  cleanRows,
  factorExpression,
  parseDelimitedText,
  parseDelimitedTextDetailed,
  qualitySummary,
  summarizeFactorRun,
} from '../src/factor'

describe('factor canvas semantics', () => {
  it('parses user-owned CSV data without changing asset codes', () => {
    const rows = parseDelimitedText('date,code,open,close\n2026-01-02,000001,10,11\n')
    expect(rows).toEqual([{ timestamp: '2026-01-02', asset: '000001', open: 10, close: 11 }])
  })

  it('reports data quality before factor claims', () => {
    const rows = parseDelimitedText('date,code,open,close\n2026-01-02,A,10,11\n2026-01-02,A,10,\n')
    expect(qualitySummary(rows)).toMatchObject({ rows: 2, assets: 1, dates: 1, duplicateKeys: 1, missingValues: 1 })
  })

  it('requires the full window before emitting a factor value', () => {
    const rows = [
      { timestamp: '2026-01-01', asset: 'A', open: 10, close: 11 },
      { timestamp: '2026-01-02', asset: 'A', open: 10, close: 10 },
      { timestamp: '2026-01-03', asset: 'A', open: 10, close: 12 },
      { timestamp: '2026-01-01', asset: 'B', open: 10, close: 10 },
      { timestamp: '2026-01-02', asset: 'B', open: 10, close: 11 },
      { timestamp: '2026-01-03', asset: 'B', open: 10, close: 10 },
    ]
    const points = calculateFactor(rows, { window: 3, minSamples: 3, descending: true })
    expect(points.filter((point) => point.timestamp === '2026-01-01').every((point) => point.factor === null)).toBe(true)
    expect(points.find((point) => point.asset === 'A' && point.timestamp === '2026-01-03')?.factor).toBeGreaterThan(0)
    expect(points.find((point) => point.asset === 'B' && point.timestamp === '2026-01-03')?.factor).toBeLessThan(0)
  })

  it('renders an expression from the same settings used by calculation', () => {
    expect(factorExpression({ window: 7, minSamples: 5, descending: false })).toBe('Cs_ZScore(Ts_Rank(Close / Open, 7, asc, min_samples=5))')
  })

  it('keeps equal time-series ranks aligned to their own cross-sectional score', () => {
    const rows = [
      { timestamp: '2026-01-01', asset: 'A', open: 10, close: 10 },
      { timestamp: '2026-01-02', asset: 'A', open: 10, close: 11 },
      { timestamp: '2026-01-01', asset: 'B', open: 10, close: 10 },
      { timestamp: '2026-01-02', asset: 'B', open: 10, close: 11 },
      { timestamp: '2026-01-01', asset: 'C', open: 10, close: 10 },
      { timestamp: '2026-01-02', asset: 'C', open: 10, close: 10 },
    ]
    const points = calculateFactor(rows, { window: 2, minSamples: 2, descending: true })
    const latest = points.filter((point) => point.timestamp === '2026-01-02')
    const equalRanks = latest.filter((point) => point.asset === 'A' || point.asset === 'B').map((point) => point.factor)
    expect(equalRanks[0]).toBeCloseTo(0.70710678, 6)
    expect(equalRanks[1]).toBeCloseTo(0.70710678, 6)
    expect(latest.find((point) => point.asset === 'C')?.factor).toBeCloseTo(-1.41421356, 6)
  })

  it('reports field mapping and invalid numeric cells instead of silently dropping them', () => {
    const report = parseDelimitedTextDetailed([
      '日期,代码,开盘价,最高价,最低价,收盘价,成交量',
      '2026-01-02,000001,10,11,9,11,1000',
      '2026-01-03,000001,bad,12,8,12,1200',
    ].join('\n'))

    expect(report.rows).toHaveLength(2)
    expect(report.rows[0]).toMatchObject({ high: 11, low: 9, volume: 1000 })
    expect(report.rows[1].open).toBeNull()
    expect(report.fieldMap).toMatchObject({ timestamp: '日期', asset: '代码', open: '开盘价', close: '收盘价' })
    expect(report.errors).toContain('第 3 行：开盘价“bad”不是有效数字')
  })

  it('rejects a file with missing required fields with a concrete reason', () => {
    const report = parseDelimitedTextDetailed('date,code,open\n2026-01-02,A,10')

    expect(report.rows).toEqual([])
    expect(report.errors).toContain('缺少必需字段：close（收盘价）')
  })

  it('checks zero prices and out-of-order observations in addition to duplicates', () => {
    const rows = [
      { timestamp: '2026-01-03', asset: 'A', open: 0, close: 11 },
      { timestamp: '2026-01-01', asset: 'A', open: 10, close: 10 },
      { timestamp: '2026-01-01', asset: 'A', open: 10, close: 10 },
    ]

    expect(qualitySummary(rows)).toMatchObject({ duplicateKeys: 1, zeroPrices: 1, outOfOrderRows: 1 })
  })

  it('cleans a copied dataset without mutating the original rows', () => {
    const original = [
      { timestamp: '2026-01-02', asset: 'A', open: 11, close: null },
      { timestamp: '2026-01-01', asset: 'A', open: 10, close: 10 },
      { timestamp: '2026-01-01', asset: 'A', open: 9, close: 9 },
    ]
    const result = cleanRows(original, { duplicate: 'keep-first', missing: 'forward-fill', sortByAssetDate: true })

    expect(original[0].close).toBeNull()
    expect(result.rows).toEqual([
      { timestamp: '2026-01-01', asset: 'A', open: 10, close: 10 },
      { timestamp: '2026-01-02', asset: 'A', open: 11, close: 10 },
    ])
    expect(result.removedRows).toBe(1)
    expect(result.changedCells).toBe(1)
  })

  it('can fill missing values with a user-provided fixed number', () => {
    const result = cleanRows(
      [{ timestamp: '2026-01-01', asset: 'A', open: null, close: 10 }],
      { duplicate: 'keep-all', missing: 'fill-value', fillValue: 0 },
    )

    expect(result.rows[0].open).toBe(0)
    expect(result.appliedRules).toContain('使用固定值 0 填充缺失值')
  })

  it('summarizes a real factor run instead of claiming every definition is runnable', () => {
    const points = calculateFactor([
      { timestamp: '2026-01-01', asset: 'A', open: 10, close: 10 },
      { timestamp: '2026-01-02', asset: 'A', open: 10, close: 11 },
    ], { window: 2, minSamples: 2, descending: true })
    const result = summarizeFactorRun(points, 'Cs_ZScore(...)', ['当前图存在 1 条警告'])

    expect(result.validValues).toBe(0)
    expect(result.missingValues).toBe(2)
    expect(result.warnings).toEqual(['当前图存在 1 条警告', '历史有效样本不足 2 条'])
    expect(result.status).toBe('warning')
  })
})

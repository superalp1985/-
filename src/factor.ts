export type FactorRow = {
  timestamp: string
  asset: string
  open: number | null
  close: number | null
  high?: number | null
  low?: number | null
  volume?: number | null
  amount?: number | null
  vwap?: number | null
  extra?: Record<string, string | null>
}

export type FactorPoint = FactorRow & {
  ratio: number | null
  tsRank: number | null
  factor: number | null
  warning?: string
}

export type FactorSettings = {
  window: number
  minSamples: number
  descending: boolean
}

export const defaultSettings: FactorSettings = {
  window: 5,
  minSamples: 5,
  descending: true,
}

type CanonicalField = 'timestamp' | 'asset' | 'open' | 'high' | 'low' | 'close' | 'volume' | 'amount' | 'vwap'

export type DataParseResult = {
  rows: FactorRow[]
  delimiter: ',' | '\t'
  headers: string[]
  fieldMap: Record<CanonicalField, string | null>
  sourceRows: number
  errors: string[]
  warnings: string[]
}

export type DataQualityReport = {
  rows: number
  assets: number
  dates: number
  duplicateKeys: number
  missingValues: number
  invalidNumbers: number
  zeroPrices: number
  outOfOrderRows: number
  missingByField: Record<string, number>
  issues: string[]
}

export type CleaningOptions = {
  duplicate: 'keep-first' | 'keep-last' | 'keep-all'
  missing: 'keep' | 'drop-row' | 'forward-fill' | 'fill-value'
  fillValue?: number
  sortByAssetDate?: boolean
}

export const defaultCleaningOptions: CleaningOptions = {
  duplicate: 'keep-first',
  missing: 'keep',
  fillValue: 0,
  sortByAssetDate: true,
}

export type CleaningResult = {
  rows: FactorRow[]
  removedRows: number
  changedCells: number
  appliedRules: string[]
  report: DataQualityReport
}

export type FactorRunStatus = 'passed' | 'warning' | 'blocked'

export type FactorRunResult = {
  status: FactorRunStatus
  expression: string
  points: FactorPoint[]
  validValues: number
  missingValues: number
  warnings: string[]
}

const aliases: Record<string, CanonicalField> = {
  timestamp: 'timestamp', date: 'timestamp', datetime: 'timestamp', time: 'timestamp', 日期: 'timestamp', 时间: 'timestamp', 交易日期: 'timestamp',
  asset: 'asset', symbol: 'asset', ticker: 'asset', code: 'asset', securitycode: 'asset', 证券代码: 'asset', 代码: 'asset', 标的: 'asset',
  open: 'open', 开盘: 'open', 开盘价: 'open',
  high: 'high', 最高: 'high', 最高价: 'high',
  low: 'low', 最低: 'low', 最低价: 'low',
  close: 'close', 收盘: 'close', 收盘价: 'close',
  volume: 'volume', vol: 'volume', 成交量: 'volume', 交易量: 'volume',
  amount: 'amount', turnover: 'amount', 成交额: 'amount', 交易额: 'amount',
  vwap: 'vwap', 成交均价: 'vwap', 均价: 'vwap',
}

const fieldLabels: Record<CanonicalField, string> = {
  timestamp: 'timestamp（日期）',
  asset: 'asset（标的）',
  open: 'open（开盘价）',
  high: 'high（最高价）',
  low: 'low（最低价）',
  close: 'close（收盘价）',
  volume: 'volume（成交量）',
  amount: 'amount（成交额）',
  vwap: 'vwap（成交均价）',
}

const shortFieldLabels: Record<CanonicalField, string> = {
  timestamp: '日期', asset: '标的', open: '开盘价', high: '最高价', low: '最低价', close: '收盘价', volume: '成交量', amount: '成交额', vwap: '成交均价',
}

const numericFields: Array<Exclude<CanonicalField, 'timestamp' | 'asset'>> = ['open', 'high', 'low', 'close', 'volume', 'amount', 'vwap']
const priceFields: Array<'open' | 'high' | 'low' | 'close'> = ['open', 'high', 'low', 'close']

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-]/g, '')
}

function splitDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }
  cells.push(current.trim())
  return cells
}

function emptyFieldMap(): Record<CanonicalField, string | null> {
  return { timestamp: null, asset: null, open: null, high: null, low: null, close: null, volume: null, amount: null, vwap: null }
}

function parseCell(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseDelimitedTextDetailed(text: string): DataParseResult {
  const rawLines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const nonEmptyLines = rawLines.filter((line) => line.trim())
  const delimiter: ',' | '\t' = nonEmptyLines[0]?.includes('\t') ? '\t' : ','
  const headers = nonEmptyLines[0] ? splitDelimitedLine(nonEmptyLines[0], delimiter) : []
  const fieldMap = emptyFieldMap()
  const indexByField = new Map<CanonicalField, number>()

  headers.forEach((header, index) => {
    const field = aliases[normalizeHeader(header)]
    if (field && !indexByField.has(field)) {
      indexByField.set(field, index)
      fieldMap[field] = header.trim()
    }
  })

  const errors: string[] = []
  const warnings: string[] = []
  const required: CanonicalField[] = ['timestamp', 'asset', 'open', 'close']
  for (const field of required) {
    if (!indexByField.has(field)) errors.push(`缺少必需字段：${fieldLabels[field]}`)
  }
  if (nonEmptyLines.length === 0) errors.push('文件没有可读取的表头和数据')
  if (errors.length > 0) return { rows: [], delimiter, headers, fieldMap, sourceRows: Math.max(0, nonEmptyLines.length - 1), errors, warnings }

  const rows: FactorRow[] = []
  const originalHeaders = headers.map((header) => header.trim())
  const recognizedIndexes = new Set(indexByField.values())
  nonEmptyLines.slice(1).forEach((line, lineOffset) => {
    const sourceLine = rawLines.findIndex((candidate) => candidate === line) + 1 || lineOffset + 2
    const cells = splitDelimitedLine(line, delimiter)
    const timestamp = cells[indexByField.get('timestamp') ?? -1]?.trim() ?? ''
    const asset = cells[indexByField.get('asset') ?? -1]?.trim() ?? ''
    if (!timestamp || !asset) {
      errors.push(`第 ${sourceLine} 行：日期和标的不能为空`)
      return
    }

    const row: FactorRow = { timestamp, asset, open: null, close: null }
    for (const field of numericFields) {
      const index = indexByField.get(field)
      if (index === undefined) continue
      const rawValue = cells[index] ?? ''
      const parsed = parseCell(rawValue)
      row[field] = parsed
      if (rawValue.trim() !== '' && parsed === null) {
        errors.push(`第 ${sourceLine} 行：${shortFieldLabels[field]}“${rawValue}”不是有效数字`)
      }
    }

    const extra: Record<string, string | null> = {}
    originalHeaders.forEach((header, index) => {
      if (!recognizedIndexes.has(index) && header) extra[header] = cells[index]?.trim() || null
    })
    if (Object.keys(extra).length > 0) row.extra = extra
    rows.push(row)
  })

  if (errors.length > 0) warnings.push('部分单元格无法解析，已保留为缺失值，请在质量报告中处理')
  return { rows, delimiter, headers, fieldMap, sourceRows: Math.max(0, nonEmptyLines.length - 1), errors, warnings }
}

export function parseDelimitedText(text: string): FactorRow[] {
  return parseDelimitedTextDetailed(text).rows
}

function rankWindow(values: number[], descending: boolean): number {
  const current = values.at(-1)
  if (current === undefined) return Number.NaN
  const sorted = [...values].sort((left, right) => descending ? left - right : right - left)
  const same = sorted.filter((value) => value === current)
  const first = sorted.indexOf(current) + 1
  const averageRank = first + (same.length - 1) / 2
  return averageRank / sorted.length
}

function zScore(values: Array<number | null>): Map<number, number> {
  const clean = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (clean.length < 2) return new Map()
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length
  const variance = clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length
  const standardDeviation = Math.sqrt(variance)
  if (standardDeviation === 0) return new Map()
  return new Map(values.map((value, index) => [index, value === null ? Number.NaN : (value - mean) / standardDeviation]))
}

export function calculateFactor(rows: FactorRow[], settings: FactorSettings = defaultSettings): FactorPoint[] {
  const windowLength = Math.max(2, Math.round(settings.window))
  const minSamples = Math.max(1, Math.min(windowLength, Math.round(settings.minSamples)))
  const byAsset = new Map<string, FactorRow[]>()
  for (const row of rows) {
    const bucket = byAsset.get(row.asset) ?? []
    bucket.push(row)
    byAsset.set(row.asset, bucket)
  }

  const points = [...byAsset.values()].flatMap((assetRows) => {
    const ordered = [...assetRows].sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    return ordered.map((row, index) => {
      const ratio = row.open !== null && row.open !== 0 && row.close !== null ? row.close / row.open : null
      const start = Math.max(0, index - windowLength + 1)
      const window = ordered.slice(start, index + 1)
        .map((item) => item.open !== null && item.open !== 0 && item.close !== null ? item.close / item.open : null)
        .filter((value): value is number => value !== null && Number.isFinite(value))
      const tsRank = window.length >= minSamples ? rankWindow(window, settings.descending) : null
      return { ...row, ratio, tsRank, factor: null }
    })
  })

  const byTimestamp = new Map<string, FactorPoint[]>()
  for (const point of points) {
    const bucket = byTimestamp.get(point.timestamp) ?? []
    bucket.push(point)
    byTimestamp.set(point.timestamp, bucket)
  }

  return points.map((point) => {
    const values = byTimestamp.get(point.timestamp)?.map((item) => item.tsRank) ?? []
    const index = values.indexOf(point.tsRank)
    const scores = zScore(values)
    const score = scores.get(index)
    return {
      ...point,
      factor: score === undefined || Number.isNaN(score) ? null : score,
      warning: point.tsRank === null ? `历史有效样本不足 ${minSamples} 条` : undefined,
    }
  })
}

export function factorExpression(settings: FactorSettings = defaultSettings): string {
  const direction = settings.descending ? 'desc' : 'asc'
  return `Cs_ZScore(Ts_Rank(Close / Open, ${settings.window}, ${direction}, min_samples=${settings.minSamples}))`
}

function numericFieldsPresent(rows: FactorRow[]): Array<Exclude<CanonicalField, 'timestamp' | 'asset'>> {
  const fields = new Set<Exclude<CanonicalField, 'timestamp' | 'asset'>>(['open', 'close'])
  for (const row of rows) {
    for (const field of numericFields) if (Object.prototype.hasOwnProperty.call(row, field)) fields.add(field)
  }
  return numericFields.filter((field) => fields.has(field))
}

export function qualitySummary(rows: FactorRow[]): DataQualityReport {
  const keys = new Set<string>()
  let duplicateKeys = 0
  let missingValues = 0
  let invalidNumbers = 0
  let zeroPrices = 0
  let outOfOrderRows = 0
  const missingByField: Record<string, number> = {}
  const lastTimestampByAsset = new Map<string, string>()
  const presentFields = numericFieldsPresent(rows)
  const issues: string[] = []

  for (const row of rows) {
    const key = `${row.timestamp}::${row.asset}`
    if (keys.has(key)) duplicateKeys += 1
    keys.add(key)
    const previousTimestamp = lastTimestampByAsset.get(row.asset)
    if (previousTimestamp && row.timestamp < previousTimestamp) outOfOrderRows += 1
    lastTimestampByAsset.set(row.asset, row.timestamp)

    let rowHasZeroPrice = false
    for (const field of presentFields) {
      const value = row[field]
      if (value === null || value === undefined) {
        missingValues += 1
        missingByField[field] = (missingByField[field] ?? 0) + 1
      } else if (!Number.isFinite(value)) {
        invalidNumbers += 1
      } else if (priceFields.includes(field as typeof priceFields[number]) && value === 0) {
        rowHasZeroPrice = true
      }
    }
    if (rowHasZeroPrice) zeroPrices += 1
  }

  if (duplicateKeys) issues.push(`${duplicateKeys} 个重复的日期 + 标的键`)
  if (missingValues) issues.push(`${missingValues} 个缺失数值`)
  if (zeroPrices) issues.push(`${zeroPrices} 行存在零价格`)
  if (outOfOrderRows) issues.push(`${outOfOrderRows} 行日期顺序异常`)
  if (invalidNumbers) issues.push(`${invalidNumbers} 个非法数字`)
  return { rows: rows.length, assets: new Set(rows.map((row) => row.asset)).size, dates: new Set(rows.map((row) => row.timestamp)).size, duplicateKeys, missingValues, invalidNumbers, zeroPrices, outOfOrderRows, missingByField, issues }
}

function cloneRow(row: FactorRow): FactorRow {
  return { ...row, extra: row.extra ? { ...row.extra } : undefined }
}

function rowKey(row: FactorRow): string {
  return `${row.timestamp}::${row.asset}`
}

function rowHasMissing(row: FactorRow, fields: Array<Exclude<CanonicalField, 'timestamp' | 'asset'>>): boolean {
  return fields.some((field) => row[field] === null || row[field] === undefined)
}

export function cleanRows(rows: FactorRow[], options: CleaningOptions = defaultCleaningOptions): CleaningResult {
  const numericPresent = numericFieldsPresent(rows)
  let working = rows.map(cloneRow)
  let removedRows = 0
  let changedCells = 0
  const appliedRules: string[] = []

  if (options.duplicate !== 'keep-all') {
    const seen = new Set<string>()
    if (options.duplicate === 'keep-first') {
      working = working.filter((row) => {
        const key = rowKey(row)
        if (seen.has(key)) {
          removedRows += 1
          return false
        }
        seen.add(key)
        return true
      })
      if (removedRows) appliedRules.push(`重复键保留首条，删除 ${removedRows} 行`)
    } else {
      const keepIndexes = new Set<number>()
      for (let index = working.length - 1; index >= 0; index -= 1) {
        const key = rowKey(working[index])
        if (seen.has(key)) removedRows += 1
        else {
          seen.add(key)
          keepIndexes.add(index)
        }
      }
      working = working.filter((_, index) => keepIndexes.has(index))
      if (removedRows) appliedRules.push(`重复键保留末条，删除 ${removedRows} 行`)
    }
  }

  if (options.sortByAssetDate) {
    working.sort((left, right) => left.asset.localeCompare(right.asset) || left.timestamp.localeCompare(right.timestamp))
    appliedRules.push('按标的和日期排序')
  }

  if (options.missing === 'drop-row') {
    const before = working.length
    working = working.filter((row) => !rowHasMissing(row, numericPresent))
    removedRows += before - working.length
    if (before !== working.length) appliedRules.push(`删除含缺失值的 ${before - working.length} 行`)
  } else if (options.missing === 'fill-value') {
    const fillValue = Number.isFinite(options.fillValue) ? Number(options.fillValue) : 0
    for (const row of working) {
      for (const field of numericPresent) {
        if (row[field] === null || row[field] === undefined) {
          row[field] = fillValue
          changedCells += 1
        }
      }
    }
    if (changedCells) appliedRules.push(`使用固定值 ${fillValue} 填充缺失值`)
  } else if (options.missing === 'forward-fill') {
    const previousByAsset = new Map<string, Partial<Record<Exclude<CanonicalField, 'timestamp' | 'asset'>, number>>>()
    for (const row of working) {
      const previous = previousByAsset.get(row.asset) ?? {}
      for (const field of numericPresent) {
        if (row[field] === null || row[field] === undefined) {
          const previousValue = previous[field]
          if (previousValue !== undefined) {
            row[field] = previousValue
            changedCells += 1
          }
        } else {
          previous[field] = row[field] as number
        }
      }
      previousByAsset.set(row.asset, previous)
    }
    if (changedCells) appliedRules.push(`按标的使用前值填充 ${changedCells} 个缺失单元格`)
  }

  return { rows: working, removedRows, changedCells, appliedRules, report: qualitySummary(working) }
}

export function summarizeFactorRun(points: FactorPoint[], expression: string, warnings: string[] = []): FactorRunResult {
  const pointWarnings = points.map((point) => point.warning).filter((warning): warning is string => Boolean(warning))
  const allWarnings = [...new Set([...warnings, ...pointWarnings])]
  const validValues = points.filter((point) => point.factor !== null && Number.isFinite(point.factor)).length
  const missingValues = points.length - validValues
  const status: FactorRunStatus = warnings.length > 0 ? 'warning' : validValues > 0 ? 'passed' : 'warning'
  return { status, expression, points, validValues, missingValues, warnings: allWarnings }
}

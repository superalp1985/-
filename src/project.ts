import type { Edge, Node } from '@xyflow/react'
import type { CleaningOptions, DataParseResult, DataQualityReport, FactorRunResult, FactorRow, FactorSettings } from './factor'
import type { ParameterValue } from './blocks'

export const PROJECT_FORMAT = 'wangdazhan-factor-project'
export const PROJECT_SCHEMA_VERSION = 2

export type ProjectView = 'workspace' | 'library' | 'data' | 'export'

export type ProjectNodeData = {
  blockId?: string
  kind: 'input' | 'operator' | 'output'
  title: string
  subtitle: string
  description: string
  accent: string
  symbol: string
  status?: 'ready' | 'selected' | 'warning'
  parameter?: string
  parameters?: Record<string, ParameterValue>
  customExpression?: string
}

export type ProjectNode = Node<ProjectNodeData, 'factor'>
export type ProjectEdge = Edge

export type CustomBlockRecord = {
  id: string
  name: string
  symbol: string
  description: string
  expression: string
  createdAt: string
}

export type IntentReview = {
  text: string
  confirmed: boolean
  checks: {
    logic: boolean
    parameters: boolean
    data: boolean
  }
}

export type ProjectState = {
  name: string
  view: ProjectView
  nodes: ProjectNode[]
  edges: ProjectEdge[]
  selectedNode: string | null
  settings: FactorSettings
  rows: FactorRow[]
  dataName: string
  lastRun: string
  showMore: boolean
  originalRows?: FactorRow[]
  cleanedRows?: FactorRow[] | null
  currentDataVersion?: 'original' | 'cleaned'
  cleaningOptions?: CleaningOptions
  qualityReport?: DataQualityReport
  runResult?: FactorRunResult | null
  parseReport?: DataParseResult | null
  customBlocks?: CustomBlockRecord[]
  intent?: IntentReview
}

export type ProjectDocument = ProjectState & {
  format: typeof PROJECT_FORMAT
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  savedAt: string
}

const projectViews = new Set<ProjectView>(['workspace', 'library', 'data', 'export'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseNodes(value: unknown): ProjectNode[] {
  if (!Array.isArray(value)) throw new Error('项目文件缺少有效的画布节点')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.position) || !isRecord(item.data)) {
      throw new Error('项目文件包含无效的画布节点')
    }
    if (!isFiniteNumber(item.position.x) || !isFiniteNumber(item.position.y)) {
      throw new Error('项目文件包含无效的节点位置')
    }
    return item as unknown as ProjectNode
  })
}

function parseEdges(value: unknown): ProjectEdge[] {
  if (!Array.isArray(value)) throw new Error('项目文件缺少有效的连线')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.source !== 'string' || typeof item.target !== 'string') {
      throw new Error('项目文件包含无效的连线')
    }
    return item as unknown as ProjectEdge
  })
}

function parseRows(value: unknown): FactorRow[] {
  if (!Array.isArray(value)) throw new Error('项目文件缺少有效的数据快照')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.timestamp !== 'string' || typeof item.asset !== 'string') {
      throw new Error('项目文件包含无效的数据行')
    }
    const optionalNumbers = ['open', 'close', 'high', 'low', 'volume', 'amount', 'vwap'] as const
    for (const field of optionalNumbers) {
      const fieldValue = item[field]
      if (fieldValue !== undefined && fieldValue !== null && !isFiniteNumber(fieldValue)) {
        throw new Error('项目文件包含无效的行情数据')
      }
    }
    const open = item.open === null || item.open === undefined ? null : item.open
    const close = item.close === null || item.close === undefined ? null : item.close
    if (!isFiniteNumber(open) && open !== null || !isFiniteNumber(close) && close !== null) {
      throw new Error('项目文件包含无效的价格数据')
    }
    const row: FactorRow = { timestamp: item.timestamp, asset: item.asset, open, close }
    for (const field of optionalNumbers.slice(2)) {
      if (item[field] !== undefined) row[field] = item[field] as number | null
    }
    if (isRecord(item.extra)) row.extra = Object.fromEntries(Object.entries(item.extra).map(([key, value]) => [key, typeof value === 'string' || value === null ? value : String(value)]))
    return row
  })
}

function clonePersistedRow(row: FactorRow): FactorRow {
  const cloned: FactorRow = { timestamp: row.timestamp, asset: row.asset, open: row.open, close: row.close }
  for (const field of ['high', 'low', 'volume', 'amount', 'vwap'] as const) {
    if (row[field] !== undefined) cloned[field] = row[field]
  }
  if (row.extra) cloned.extra = { ...row.extra }
  return cloned
}

function parseCleaningOptions(value: unknown): CleaningOptions {
  if (!isRecord(value)) return { duplicate: 'keep-first', missing: 'keep', fillValue: 0, sortByAssetDate: true }
  const duplicate = value.duplicate === 'keep-last' || value.duplicate === 'keep-all' ? value.duplicate : 'keep-first'
  const missing = value.missing === 'drop-row' || value.missing === 'forward-fill' || value.missing === 'fill-value' ? value.missing : 'keep'
  return {
    duplicate,
    missing,
    fillValue: isFiniteNumber(value.fillValue) ? value.fillValue : 0,
    sortByAssetDate: value.sortByAssetDate !== false,
  }
}

function parseQualityReport(value: unknown): DataQualityReport | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.rows) || !isFiniteNumber(value.assets) || !isFiniteNumber(value.dates)) return undefined
  return {
    rows: value.rows,
    assets: value.assets,
    dates: value.dates,
    duplicateKeys: isFiniteNumber(value.duplicateKeys) ? value.duplicateKeys : 0,
    missingValues: isFiniteNumber(value.missingValues) ? value.missingValues : 0,
    invalidNumbers: isFiniteNumber(value.invalidNumbers) ? value.invalidNumbers : 0,
    zeroPrices: isFiniteNumber(value.zeroPrices) ? value.zeroPrices : 0,
    outOfOrderRows: isFiniteNumber(value.outOfOrderRows) ? value.outOfOrderRows : 0,
    missingByField: isRecord(value.missingByField) ? Object.fromEntries(Object.entries(value.missingByField).filter(([, item]) => isFiniteNumber(item))) as Record<string, number> : {},
    issues: Array.isArray(value.issues) ? value.issues.filter((item): item is string => typeof item === 'string') : [],
  }
}

function parseDataParseResult(value: unknown): DataParseResult | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (!isRecord(value) || (value.delimiter !== ',' && value.delimiter !== '\t') || !Array.isArray(value.headers) || !isFiniteNumber(value.sourceRows)) return undefined
  if (!isRecord(value.fieldMap)) return undefined
  const rawFieldMap = value.fieldMap as Record<string, unknown>
  const headers = value.headers.filter((item): item is string => typeof item === 'string')
  const fieldMap = Object.fromEntries(
    ['timestamp', 'asset', 'open', 'high', 'low', 'close', 'volume', 'amount', 'vwap'].map((field) => [field, typeof rawFieldMap[field] === 'string' ? rawFieldMap[field] : null]),
  ) as DataParseResult['fieldMap']
  return {
    rows: Array.isArray(value.rows) ? parseRows(value.rows) : [],
    delimiter: value.delimiter,
    headers,
    fieldMap,
    sourceRows: Math.max(0, Math.round(value.sourceRows)),
    errors: Array.isArray(value.errors) ? value.errors.filter((item): item is string => typeof item === 'string') : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === 'string') : [],
  }
}

function parseCustomBlocks(value: unknown): CustomBlockRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.expression !== 'string') return []
    return [{
      id: item.id,
      name: item.name,
      symbol: typeof item.symbol === 'string' ? item.symbol : 'fx',
      description: typeof item.description === 'string' ? item.description : '用户自定义公式积木',
      expression: item.expression,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
    }]
  })
}

function parseIntent(value: unknown): IntentReview | undefined {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.confirmed !== 'boolean' || !isRecord(value.checks)) return undefined
  return {
    text: value.text,
    confirmed: value.confirmed,
    checks: {
      logic: value.checks.logic === true,
      parameters: value.checks.parameters === true,
      data: value.checks.data === true,
    },
  }
}

function parseRunResult(value: unknown): FactorRunResult | null | undefined {
  if (value === null || value === undefined) return value === null ? null : undefined
  if (!isRecord(value) || typeof value.expression !== 'string' || !Array.isArray(value.points)) return undefined
  const points = value.points.filter(isRecord).map((item) => {
    const row = parseRows([item])[0]
    return { ...row, ratio: isFiniteNumber(item.ratio) ? item.ratio : null, tsRank: isFiniteNumber(item.tsRank) ? item.tsRank : null, factor: isFiniteNumber(item.factor) ? item.factor : null, warning: typeof item.warning === 'string' ? item.warning : undefined }
  })
  const status = value.status === 'passed' || value.status === 'blocked' ? value.status : 'warning'
  return {
    status,
    expression: value.expression,
    points,
    validValues: isFiniteNumber(value.validValues) ? value.validValues : 0,
    missingValues: isFiniteNumber(value.missingValues) ? value.missingValues : points.length,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === 'string') : [],
  }
}

function parseSettings(value: unknown): FactorSettings {
  if (!isRecord(value) || !isFiniteNumber(value.window) || !isFiniteNumber(value.minSamples)) {
    throw new Error('项目文件缺少有效的因子参数')
  }
  const window = Math.max(2, Math.round(value.window))
  const minSamples = Math.min(window, Math.max(2, Math.round(value.minSamples)))
  return { window, minSamples, descending: value.descending !== false }
}

export function createProjectDocument(state: ProjectState, savedAt = new Date().toISOString()): ProjectDocument {
  const originalRows = (state.originalRows ?? state.rows).map(clonePersistedRow)
  const cleanedRows = state.cleanedRows === undefined ? null : state.cleanedRows?.map(clonePersistedRow) ?? null
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt,
    name: state.name,
    view: state.view,
    nodes: JSON.parse(JSON.stringify(state.nodes)) as ProjectNode[],
    edges: JSON.parse(JSON.stringify(state.edges)) as ProjectEdge[],
    selectedNode: state.selectedNode,
    settings: { ...state.settings },
    rows: state.rows.map(clonePersistedRow),
    dataName: state.dataName,
    lastRun: state.lastRun,
    showMore: state.showMore,
    originalRows,
    cleanedRows,
    currentDataVersion: state.currentDataVersion ?? 'original',
    cleaningOptions: state.cleaningOptions ?? { duplicate: 'keep-first', missing: 'keep', fillValue: 0, sortByAssetDate: true },
    qualityReport: state.qualityReport,
    runResult: state.runResult ?? null,
    parseReport: state.parseReport ?? null,
    customBlocks: state.customBlocks?.map((block) => ({ ...block })) ?? [],
    intent: state.intent ? { text: state.intent.text, confirmed: state.intent.confirmed, checks: { ...state.intent.checks } } : undefined,
  }
}

export function parseProjectDocument(value: unknown): ProjectDocument {
  if (!isRecord(value) || value.format !== PROJECT_FORMAT) {
    throw new Error('项目文件格式不正确')
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`项目文件版本 ${String(value.schemaVersion)} 暂不支持`)
  }
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('项目文件缺少项目名称')
  if (typeof value.savedAt !== 'string') throw new Error('项目文件缺少保存时间')
  if (typeof value.view !== 'string' || !projectViews.has(value.view as ProjectView)) throw new Error('项目文件包含无效的页面状态')
  if (value.selectedNode !== null && typeof value.selectedNode !== 'string') throw new Error('项目文件包含无效的选中节点')
  if (typeof value.dataName !== 'string' || typeof value.lastRun !== 'string' || typeof value.showMore !== 'boolean') {
    throw new Error('项目文件缺少会话状态')
  }

  const rows = parseRows(value.rows)
  const originalRows = value.schemaVersion === 1 || value.originalRows === undefined ? rows : parseRows(value.originalRows)
  const cleanedRows = value.cleanedRows === null || value.cleanedRows === undefined ? null : parseRows(value.cleanedRows)
  const currentDataVersion = value.currentDataVersion === 'cleaned' && cleanedRows ? 'cleaned' : 'original'
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: value.savedAt,
    name: value.name,
    view: value.view as ProjectView,
    nodes: parseNodes(value.nodes),
    edges: parseEdges(value.edges),
    selectedNode: value.selectedNode,
    settings: parseSettings(value.settings),
    rows,
    dataName: value.dataName,
    lastRun: value.lastRun,
    showMore: value.showMore,
    originalRows,
    cleanedRows,
    currentDataVersion,
    cleaningOptions: parseCleaningOptions(value.cleaningOptions),
    qualityReport: parseQualityReport(value.qualityReport),
    runResult: parseRunResult(value.runResult),
    parseReport: parseDataParseResult(value.parseReport),
    customBlocks: parseCustomBlocks(value.customBlocks),
    intent: parseIntent(value.intent),
  }
}

export function serializeProjectDocument(document: ProjectDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function projectFileName(name: string): string {
  const safeName = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return `${safeName || '王大粘因子项目'}.wdz-factor.json`
}

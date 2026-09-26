import { describe, expect, it } from 'vitest'
import {
  PROJECT_FORMAT,
  PROJECT_SCHEMA_VERSION,
  createProjectDocument,
  parseProjectDocument,
  projectFileName,
  serializeProjectDocument,
} from '../src/project'
import type { CustomBlockRecord, IntentReview } from '../src/project'
import { readProjectFromStorage, writeProjectToStorage } from '../src/projectStorage'
import type { DataParseResult } from '../src/factor'

const state = {
  name: '收开比 · 时序强弱',
  view: 'workspace' as const,
  selectedNode: 'ts-rank',
  nodes: [
    {
      id: 'ratio',
      type: 'factor' as const,
      position: { x: 330, y: 180 },
      data: {
        kind: 'operator' as const,
        title: '收开比',
        subtitle: '逐行计算',
        description: 'Close ÷ Open',
        accent: '#d5795f',
        symbol: '÷',
        status: 'ready' as const,
      },
    },
  ],
  edges: [],
  settings: { window: 5, minSamples: 5, descending: true },
  rows: [{ timestamp: '2026-01-02', asset: '000001', open: 10, close: 11 }],
  dataName: 'sample.csv',
  lastRun: '刚刚',
  showMore: false,
  parseReport: {
    rows: [{ timestamp: '2026-01-02', asset: '000001', open: 10, close: 11 }],
    delimiter: ',',
    headers: ['date', 'code', 'open', 'close'],
    fieldMap: { timestamp: 'date', asset: 'code', open: 'open', high: null, low: null, close: 'close', volume: null, amount: null, vwap: null },
    sourceRows: 1,
    errors: ['第 3 行：收盘价“bad”不是有效数字'],
    warnings: ['部分单元格无法解析'],
  } satisfies DataParseResult,
  customBlocks: [{ id: 'custom-1', name: '翻倍', symbol: '×2', description: '输入乘以 2', expression: 'x * 2', createdAt: '2026-09-26T10:00:00.000Z' }] satisfies CustomBlockRecord[],
  intent: { text: '先计算收开比，再做时序排名。', confirmed: true, checks: { logic: true, parameters: true, data: true } } satisfies IntentReview,
}

describe('factor project files', () => {
  it('creates a versioned portable snapshot from the current workspace', () => {
    const document = createProjectDocument(state, '2026-09-26T10:00:00.000Z')

    expect(document).toMatchObject({
      format: PROJECT_FORMAT,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      savedAt: '2026-09-26T10:00:00.000Z',
      name: state.name,
      dataName: 'sample.csv',
    })
    expect(document.rows[0].asset).toBe('000001')
  })

  it('round-trips a project document without losing canvas or data', () => {
    const document = createProjectDocument({
      ...state,
      originalRows: state.rows,
      cleanedRows: [{ timestamp: '2026-01-02', asset: '000001', open: 10, close: 11 }],
      currentDataVersion: 'cleaned',
      cleaningOptions: { duplicate: 'keep-first', missing: 'forward-fill', fillValue: 0, sortByAssetDate: true },
    }, '2026-09-26T10:00:00.000Z')
    const restored = parseProjectDocument(JSON.parse(serializeProjectDocument(document)))

    expect(restored).toEqual(document)
    expect(restored.currentDataVersion).toBe('cleaned')
    expect(restored.parseReport?.fieldMap.close).toBe('close')
    expect(restored.parseReport?.errors).toContain('第 3 行：收盘价“bad”不是有效数字')
    expect(restored.customBlocks?.[0].expression).toBe('x * 2')
    expect(restored.intent?.confirmed).toBe(true)
  })

  it('rejects files from another format or unsupported schema', () => {
    expect(() => parseProjectDocument({ format: 'other-tool', schemaVersion: 1 })).toThrow(/项目文件格式/)
    expect(() => parseProjectDocument({ format: PROJECT_FORMAT, schemaVersion: 99 })).toThrow(/版本/)
  })

  it('creates a safe local filename from the project name', () => {
    expect(projectFileName('收开比 / 时序强弱')).toBe('收开比_时序强弱.wdz-factor.json')
  })

  it('uses a browser storage adapter for a local resume fallback', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const document = createProjectDocument(state, '2026-09-26T10:00:00.000Z')

    writeProjectToStorage(document, storage)

    expect(readProjectFromStorage(storage)).toEqual(document)
  })
})

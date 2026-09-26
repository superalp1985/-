import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Code2,
  Database,
  Download,
  FileDown,
  FileSpreadsheet,
  FolderOpen,
  GitBranch,
  Layers3,
  Lightbulb,
  Link2,
  Menu,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Save,
  Settings2,
  Sparkles,
  Upload,
  Workflow,
  X,
} from 'lucide-react'
import {
  alpha158Factors,
  alpha360Factors,
  buildFactorGraph,
  type FactorDefinition,
} from './factors'
import {
  blockCategories,
  blockDefinitions,
  defaultBlockParameters,
  getBlockDefinition,
  type BlockDefinition,
  type BlockParameter,
  type ParameterValue,
} from './blocks'
import {
  calculateFactor,
  cleanRows,
  defaultSettings,
  defaultCleaningOptions,
  parseDelimitedTextDetailed,
  qualitySummary,
  summarizeFactorRun,
  type CleaningOptions,
  type CleaningResult,
  type DataParseResult,
  type FactorRunResult,
  type FactorRow,
  type FactorSettings,
} from './factor'
import {
  createProjectDocument,
  parseProjectDocument,
  projectFileName,
  serializeProjectDocument,
  type ProjectNode,
  type ProjectNodeData,
  type ProjectView,
  type CustomBlockRecord,
  type IntentReview,
} from './project'
import { loadLocalProject, saveLocalProject } from './projectStorage'
import { compileGraphExpression, compileGraphPython } from './graph'
import { calculateGraphFactor } from './graphRuntime'

type View = ProjectView
type NodeKind = ProjectNodeData['kind']
type FactorNodeData = ProjectNodeData
type FactorNode = ProjectNode

const demoRows: FactorRow[] = (
  [
    ['2026-09-14', 'AAPL', 226.1, 228.2], ['2026-09-14', 'MSFT', 508.4, 505.8], ['2026-09-14', 'NVDA', 179.2, 182.4], ['2026-09-14', 'TSLA', 339.5, 337.1],
    ['2026-09-15', 'AAPL', 228.4, 231.1], ['2026-09-15', 'MSFT', 505.9, 509.4], ['2026-09-15', 'NVDA', 182.2, 181.3], ['2026-09-15', 'TSLA', 336.8, 342.6],
    ['2026-09-16', 'AAPL', 231.2, 229.7], ['2026-09-16', 'MSFT', 509.6, 510.5], ['2026-09-16', 'NVDA', 181.4, 185.2], ['2026-09-16', 'TSLA', 342.8, 345.1],
    ['2026-09-17', 'AAPL', 229.9, 233.6], ['2026-09-17', 'MSFT', 510.3, 507.2], ['2026-09-17', 'NVDA', 185.4, 187.9], ['2026-09-17', 'TSLA', 345.0, 341.2],
    ['2026-09-18', 'AAPL', 233.8, 236.7], ['2026-09-18', 'MSFT', 507.4, 511.8], ['2026-09-18', 'NVDA', 188.1, 186.9], ['2026-09-18', 'TSLA', 341.5, 347.3],
    ['2026-09-21', 'AAPL', 236.8, 235.2], ['2026-09-21', 'MSFT', 511.9, 514.6], ['2026-09-21', 'NVDA', 187.1, 191.5], ['2026-09-21', 'TSLA', 347.5, 351.2],
    ['2026-09-22', 'AAPL', 235.1, 237.9], ['2026-09-22', 'MSFT', 514.7, 512.5], ['2026-09-22', 'NVDA', 191.7, 189.8], ['2026-09-22', 'TSLA', 351.0, 348.6],
  ] as const
).map(([timestamp, asset, open, close]) => ({ timestamp, asset, open, close }))

function createNodeData(blockId: string, status: FactorNodeData['status'] = 'ready', parameters: Record<string, ParameterValue> = {}, customExpression?: string): ProjectNodeData {
  const definition = getBlockDefinition(blockId)
  if (!definition) throw new Error(`未注册积木：${blockId}`)
  return {
    blockId,
    kind: definition.kind,
    title: definition.title,
    subtitle: definition.subtitle,
    description: definition.description,
    accent: definition.accent,
    symbol: definition.symbol,
    status,
    parameters: { ...defaultBlockParameters(blockId), ...parameters },
    ...(customExpression ? { customExpression } : {}),
  }
}

function createCustomNodeData(block: CustomBlockRecord, status: FactorNodeData['status'] = 'ready'): ProjectNodeData {
  const base = createNodeData('custom_formula', status, {}, block.expression)
  return {
    ...base,
    title: block.name,
    subtitle: '用户自定义公式',
    description: block.description,
    symbol: block.symbol,
    customExpression: block.expression,
  }
}

function createIntentDraft(nodes: FactorNode[], edges: Edge[], expression: string): string {
  const blockIds = new Set<string>()
  const output = nodes.find((node) => node.data.blockId === 'factor_output' || node.data.kind === 'output')
  const visit = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId)
    if (!node || blockIds.has(node.data.blockId ?? node.id)) return
    blockIds.add(node.data.blockId ?? node.id)
    edges.filter((edge) => edge.target === nodeId).forEach((edge) => visit(edge.source))
  }
  if (output) visit(output.id)

  const has = (blockId: string) => blockIds.has(blockId)
  if (has('field_close') && has('field_open') && has('divide') && has('ts_rank') && has('cs_zscore')) {
    return '先计算收盘价相对开盘价，再按每个标的回看历史窗口做时序排名，最后按每个交易日做截面标准化。'
  }

  const steps = nodes
    .filter((node) => blockIds.has(node.data.blockId ?? node.id) && node.data.kind !== 'output')
    .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y)
    .map((node) => {
      const definition = getBlockDefinition(node.data.blockId)
      if (!definition) return node.data.title
      if (definition.kind === 'input') return `取出${node.data.title}`
      if (definition.id === 'constant') return `使用数值 ${String(node.data.parameters?.value ?? 1)}`
      return definition.title
    })
  const uniqueSteps = steps.filter((step, index) => index === 0 || step !== steps[index - 1])
  const readable = uniqueSteps.slice(0, 8).join('，')
  return readable ? `当前因子依次使用：${readable}。最终表达式为 ${expression || '待连接'}。` : `当前因子尚未形成完整逻辑。表达式：${expression || '待连接'}。`
}

const initialNodes: FactorNode[] = [
  { id: 'field-close', type: 'factor', position: { x: 50, y: 125 }, data: createNodeData('field_close') },
  { id: 'field-open', type: 'factor', position: { x: 50, y: 330 }, data: createNodeData('field_open') },
  { id: 'divide', type: 'factor', position: { x: 345, y: 225 }, data: createNodeData('divide') },
  { id: 'ts-rank', type: 'factor', position: { x: 635, y: 225 }, data: createNodeData('ts_rank', 'selected', { window: 5, min_samples: 5, descending: true }) },
  { id: 'cs-zscore', type: 'factor', position: { x: 930, y: 225 }, data: createNodeData('cs_zscore') },
  { id: 'factor-output', type: 'factor', position: { x: 1220, y: 225 }, data: createNodeData('factor_output') },
]

const initialEdges: Edge[] = [
  { id: 'edge-close-divide-left', source: 'field-close', sourceHandle: 'value', target: 'divide', targetHandle: 'left', animated: true, style: { stroke: '#7c9696', strokeWidth: 2 } },
  { id: 'edge-open-divide-right', source: 'field-open', sourceHandle: 'value', target: 'divide', targetHandle: 'right', animated: true, style: { stroke: '#7c9696', strokeWidth: 2 } },
  { id: 'edge-divide-rank-series', source: 'divide', sourceHandle: 'value', target: 'ts-rank', targetHandle: 'series', animated: true, style: { stroke: '#7c9696', strokeWidth: 2 } },
  { id: 'edge-rank-zscore-series', source: 'ts-rank', sourceHandle: 'value', target: 'cs-zscore', targetHandle: 'series', animated: true, style: { stroke: '#7c9696', strokeWidth: 2 } },
  { id: 'edge-zscore-output-value', source: 'cs-zscore', sourceHandle: 'value', target: 'factor-output', targetHandle: 'value', animated: true, style: { stroke: '#7c9696', strokeWidth: 2 } },
]

function FactorNodeCard({ data, selected }: NodeProps<FactorNode>) {
  const definition = getBlockDefinition(data.blockId)
  const inputPorts = definition?.inputs ?? []
  const isInput = data.kind === 'input' || inputPorts.length === 0
  const isOutput = data.kind === 'output'
  const parameters = definition?.parameters
    .map((item) => `${item.label} ${String(data.parameters?.[item.id] ?? item.default)}`)
    .join(' · ')
  return (
    <div className={`factor-node ${selected ? 'factor-node-selected' : ''}`} style={{ '--node-accent': data.accent } as React.CSSProperties}>
      {!isInput && inputPorts.map((port, index) => <Handle key={port.id} type="target" position={Position.Left} id={port.id} className="node-handle node-target-handle" style={{ top: `${((index + 1) / (inputPorts.length + 1)) * 100}%` }} title={port.label} />)}
      <div className="node-topline">
        <span className="node-symbol">{data.symbol}</span>
        <span className={`node-status node-status-${data.status ?? 'ready'}`}><span />{data.status === 'selected' ? '正在编辑' : data.status === 'warning' ? '需检查' : '已就绪'}</span>
      </div>
      <div className="node-title">{data.title}</div>
      <div className="node-subtitle">{data.subtitle}</div>
      <div className="node-description">{data.description}</div>
      {parameters && <div className="node-parameter"><Settings2 size={13} /> {parameters}</div>}
      {definition && <div className="node-port-summary"><span>入：{inputPorts.length ? inputPorts.map((port) => port.label).join(' · ') : '无'}</span><span>出：{definition.output.label}</span></div>}
      {!isOutput && <Handle type="source" position={Position.Right} id={definition?.output.id ?? 'value'} className="node-handle" />}
    </div>
  )
}

function formatNumber(value: number | null) {
  return value === null || Number.isNaN(value) ? '—' : value.toFixed(4)
}

function App() {
  const [view, setView] = useState<View>('workspace')
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNode, setSelectedNode] = useState<string | null>('ts-rank')
  const [settings, setSettings] = useState<FactorSettings>(defaultSettings)
  const [originalRows, setOriginalRows] = useState<FactorRow[]>(demoRows)
  const [cleanedRows, setCleanedRows] = useState<FactorRow[] | null>(null)
  const [currentDataVersion, setCurrentDataVersion] = useState<'original' | 'cleaned'>('original')
  const [cleaningOptions, setCleaningOptions] = useState<CleaningOptions>(defaultCleaningOptions)
  const [parseReport, setParseReport] = useState<DataParseResult | null>(null)
  const [cleaningSummary, setCleaningSummary] = useState<CleaningResult | null>(null)
  const [runResult, setRunResult] = useState<FactorRunResult | null>(null)
  const [dataName, setDataName] = useState('demo-market-panel.csv')
  const [projectName, setProjectName] = useState('收开比 · 时序强弱')
  const [isRunning, setIsRunning] = useState(false)
  const [lastRun, setLastRun] = useState('刚刚')
  const [search, setSearch] = useState('')
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})
  const [showMore, setShowMore] = useState(false)
  const [customBlocks, setCustomBlocks] = useState<CustomBlockRecord[]>([])
  const [intentText, setIntentText] = useState('')
  const [intentConfirmed, setIntentConfirmed] = useState(false)
  const [intentChecks, setIntentChecks] = useState<IntentReview['checks']>({ logic: false, parameters: false, data: false })
  const [inspectorTab, setInspectorTab] = useState<'node' | 'intent'>('node')
  const [assistantSuggestionVisible, setAssistantSuggestionVisible] = useState(false)
  const [dockTab, setDockTab] = useState<'results' | 'data' | 'code'>('results')
  const [showCustomBlockModal, setShowCustomBlockModal] = useState(false)
  const [customBlockDraft, setCustomBlockDraft] = useState({ name: '', symbol: 'fx', description: '', expression: 'x * 2' })
  const [graphHistory, setGraphHistory] = useState<Array<{ nodes: FactorNode[]; edges: Edge[] }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectFileInputRef = useRef<HTMLInputElement>(null)
  const userChangedBeforeHydration = useRef(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [saveState, setSaveState] = useState<'loading' | 'saving' | 'saved' | 'restored' | 'error'>('loading')

  const rows = currentDataVersion === 'cleaned' && cleanedRows ? cleanedRows : originalRows
  const results = useMemo(() => calculateFactor(rows, settings), [rows, settings])
  const quality = useMemo(() => qualitySummary(rows), [rows])
  const originalQuality = useMemo(() => qualitySummary(originalRows), [originalRows])
  const cleanedQuality = useMemo(() => cleanedRows ? qualitySummary(cleanedRows) : null, [cleanedRows])
  const invalidNumberErrors = useMemo(() => currentDataVersion === 'original' ? parseReport?.errors.filter((issue) => issue.includes('不是有效数字')).length ?? 0 : 0, [currentDataVersion, parseReport])
  const compilation = useMemo(() => compileGraphExpression(nodes, edges, settings), [edges, nodes, settings])
  const expression = compilation.expression
  const pythonCode = useMemo(() => compileGraphPython(nodes, edges, settings), [edges, nodes, settings])
  const latestResults = useMemo(() => results.slice(-8), [results])
  const latestResult = latestResults.at(-1)
  const filteredLibrary = useMemo(() => blockDefinitions.filter((item) => !search || `${item.title} ${item.symbol} ${item.description}`.toLowerCase().includes(search.toLowerCase())), [search])
  const selectedNodeItem = useMemo(() => nodes.find((node) => node.id === selectedNode), [nodes, selectedNode])
  const selectedDefinition = getBlockDefinition(selectedNodeItem?.data.blockId)
  const selectedIncoming = useMemo(() => edges.filter((edge) => edge.target === selectedNode), [edges, selectedNode])
  const selectedOutgoing = useMemo(() => edges.filter((edge) => edge.source === selectedNode), [edges, selectedNode])

  const pushGraphHistory = () => {
    setGraphHistory((current) => [
      ...current.slice(-19),
      {
        nodes: JSON.parse(JSON.stringify(nodes)) as FactorNode[],
        edges: JSON.parse(JSON.stringify(edges)) as Edge[],
      },
    ])
  }

  const invalidateIntent = () => {
    setIntentConfirmed(false)
    setIntentChecks({ logic: false, parameters: false, data: false })
  }

  const useDataVersion = (version: 'original' | 'cleaned') => {
    setCurrentDataVersion(version)
    setRunResult(null)
    setLastRun('等待测试')
    invalidateIntent()
  }

  const updateCleaningOptions = (patch: Partial<CleaningOptions>) => {
    setCleaningOptions((current) => ({ ...current, ...patch }))
    invalidateIntent()
  }

  useEffect(() => {
    let cancelled = false
    void loadLocalProject().then((document) => {
      if (cancelled) return
      if (userChangedBeforeHydration.current) {
        setSaveState('saved')
        setIsHydrated(true)
        return
      }
      if (document) {
        setProjectName(document.name)
        setView(document.view)
        setNodes(document.nodes)
        setEdges(document.edges)
        setSelectedNode(document.selectedNode ?? 'ts-rank')
        setSettings(document.settings)
        setOriginalRows(document.originalRows ?? document.rows)
        setCleanedRows(document.cleanedRows ?? null)
        setCurrentDataVersion(document.currentDataVersion ?? 'original')
        setCleaningOptions(document.cleaningOptions ?? defaultCleaningOptions)
        setRunResult(document.runResult ?? null)
        setParseReport(document.parseReport ?? null)
        setCustomBlocks(document.customBlocks ?? [])
        setIntentText(document.intent?.text ?? '')
        setIntentConfirmed(document.intent?.confirmed ?? false)
        setIntentChecks(document.intent?.checks ?? { logic: false, parameters: false, data: false })
        setDataName(document.dataName)
        setLastRun(document.lastRun)
        setShowMore(document.showMore)
        setSaveState('restored')
      } else {
        setSaveState('saved')
      }
      setIsHydrated(true)
    }).catch(() => {
      if (cancelled) return
      setSaveState('error')
      setIsHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [setEdges, setNodes])

  useEffect(() => {
    if (!isHydrated) return
    setSaveState('saving')
    const timeout = window.setTimeout(() => {
      const document = createProjectDocument({
        name: projectName,
        view,
        nodes,
        edges,
        selectedNode,
        settings,
        rows,
        dataName,
        lastRun,
        showMore,
        originalRows,
        cleanedRows,
        currentDataVersion,
        cleaningOptions,
        qualityReport: quality,
        runResult,
        parseReport,
        customBlocks,
        intent: { text: intentText, confirmed: intentConfirmed, checks: intentChecks },
      })
      void saveLocalProject(document)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'))
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [cleanedRows, cleaningOptions, currentDataVersion, customBlocks, dataName, edges, intentChecks, intentConfirmed, intentText, isHydrated, lastRun, nodes, originalRows, parseReport, projectName, runResult, rows, selectedNode, settings, showMore, view])

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const source = nodes.find((node) => node.id === connection.source)
    const target = nodes.find((node) => node.id === connection.target)
    const sourceDefinition = getBlockDefinition(source?.data.blockId)
    const targetDefinition = getBlockDefinition(target?.data.blockId)
    const targetPort = targetDefinition?.inputs.find((port) => port.id === connection.targetHandle)
    if (!sourceDefinition || !targetDefinition || !targetPort) return false
    const sourceType = sourceDefinition.output.type
    return sourceType === targetPort.type || (sourceType === 'scalar' && targetPort.type === 'series')
  }, [nodes])

  const handleConnect = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) return
    pushGraphHistory()
    invalidateIntent()
    setEdges((current) => {
      const withoutExistingInput = current.filter((edge) => !(edge.target === connection.target && edge.targetHandle === connection.targetHandle))
      return addEdge({ ...connection, animated: true, style: { stroke: '#7c9696', strokeWidth: 2 } }, withoutExistingInput)
    })
  }, [isValidConnection, setEdges, nodes, edges])

  const handleEdgesChange = (changes: Parameters<typeof onEdgesChange>[0]) => {
    if (changes.some((change) => change.type === 'remove')) {
      pushGraphHistory()
      invalidateIntent()
    }
    onEdgesChange(changes)
  }

  const handleNodesChange = (changes: Parameters<typeof onNodesChange>[0]) => {
    if (changes.some((change) => change.type === 'remove')) {
      pushGraphHistory()
      invalidateIntent()
    }
    onNodesChange(changes)
  }

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id)
    setNodes((current) => current.map((item) => ({ ...item, data: { ...item.data, status: item.id === node.id ? 'selected' : item.data.status === 'selected' ? 'ready' : item.data.status } })))
  }, [setNodes])

  const updateNodeParameters = (nodeId: string, patch: Record<string, ParameterValue>) => {
    pushGraphHistory()
    invalidateIntent()
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, parameters: { ...(node.data.parameters ?? {}), ...patch } } }
      : node))
    const node = nodes.find((item) => item.id === nodeId)
    if (node?.data.blockId === 'ts_rank') {
      const nextParameters = { ...(node.data.parameters ?? {}), ...patch }
      const nextWindow = typeof nextParameters.window === 'number' ? Math.max(2, nextParameters.window) : settings.window
      const nextMinSamples = typeof nextParameters.min_samples === 'number' ? Math.min(nextWindow, Math.max(1, nextParameters.min_samples)) : settings.minSamples
      const nextDescending = typeof nextParameters.descending === 'boolean' ? nextParameters.descending : settings.descending
      setSettings({ window: nextWindow, minSamples: nextMinSamples, descending: nextDescending })
    }
  }

  const runFactor = () => {
    setIsRunning(true)
    window.setTimeout(() => {
      const calculation = calculateGraphFactor(rows, edges, nodes, settings)
      const warnings = [...new Set([...compilation.warnings, ...calculation.warnings])]
      const nextResult = calculation.supported
        ? summarizeFactorRun(calculation.points, compilation.expression, warnings)
        : {
            status: 'blocked' as const,
            expression: compilation.expression,
            points: calculation.points,
            validValues: 0,
            missingValues: calculation.points.length,
            warnings,
          }
      setRunResult(nextResult)
      setIsRunning(false)
      setLastRun('刚刚')
    }, 220)
  }

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    userChangedBeforeHydration.current = true
    const text = await file.text()
    const report = parseDelimitedTextDetailed(text)
    setParseReport(report)
    if (report.rows.length > 0) {
      setOriginalRows(report.rows)
      setCleanedRows(null)
      setCurrentDataVersion('original')
      setCleaningSummary(null)
      setRunResult(null)
      setDataName(file.name)
      setView('data')
      setLastRun('等待测试')
      invalidateIntent()
    } else {
      window.alert(report.errors.join('\n') || '文件中没有可用数据行')
    }
    event.target.value = ''
  }

  const applyCleaning = () => {
    const result = cleanRows(originalRows, cleaningOptions)
    setCleaningSummary(result)
    setCleanedRows(result.rows)
    setCurrentDataVersion('cleaned')
    setRunResult(null)
    setLastRun('等待测试')
    invalidateIntent()
  }

  const undoCleaning = () => {
    setCurrentDataVersion('original')
    setRunResult(null)
    setLastRun('等待测试')
    invalidateIntent()
  }

  const currentProject = () => createProjectDocument({
    name: projectName,
    view,
    nodes,
    edges,
    selectedNode,
    settings,
    rows,
    dataName,
    lastRun,
    showMore,
    originalRows,
    cleanedRows,
    currentDataVersion,
    cleaningOptions,
    qualityReport: quality,
    runResult,
    parseReport,
    customBlocks,
    intent: { text: intentText, confirmed: intentConfirmed, checks: intentChecks },
  })

  const saveProjectFile = () => {
    const project = currentProject()
    const blob = new Blob([serializeProjectDocument(project)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = projectFileName(project.name)
    link.click()
    URL.revokeObjectURL(url)
    setSaveState('saved')
    void saveLocalProject(project).catch(() => setSaveState('error'))
  }

  const onProjectFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    userChangedBeforeHydration.current = true
    try {
      const project = parseProjectDocument(JSON.parse(await file.text()))
      setProjectName(project.name)
      setView(project.view)
      setNodes(project.nodes)
      setEdges(project.edges)
      setSelectedNode(project.selectedNode ?? 'ts-rank')
      setSettings(project.settings)
      setOriginalRows(project.originalRows ?? project.rows)
      setCleanedRows(project.cleanedRows ?? null)
      setCurrentDataVersion(project.currentDataVersion ?? 'original')
      setCleaningOptions(project.cleaningOptions ?? defaultCleaningOptions)
      setRunResult(project.runResult ?? null)
      setParseReport(project.parseReport ?? null)
      setDataName(project.dataName)
      setLastRun(project.lastRun)
      setShowMore(project.showMore)
      setCustomBlocks(project.customBlocks ?? [])
      setIntentText(project.intent?.text ?? '')
      setIntentConfirmed(project.intent?.confirmed ?? false)
      setIntentChecks(project.intent?.checks ?? { logic: false, parameters: false, data: false })
      setSaveState('restored')
    } catch (error) {
      setSaveState('error')
      window.alert(error instanceof Error ? error.message : '无法读取项目文件')
    } finally {
      event.target.value = ''
    }
  }

  const addLibraryNode = (item: BlockDefinition) => {
    pushGraphHistory()
    const id = `${item.id}-${Date.now()}`
    const x = 320 + (nodes.length % 3) * 220
    const y = 420 + Math.floor(nodes.length / 3) * 150
    setNodes((current) => [...current, { id, type: 'factor', position: { x, y }, data: createNodeData(item.id) }])
    setSelectedNode(id)
    setView('workspace')
    invalidateIntent()
  }

  const addCustomBlockNode = (block: CustomBlockRecord) => {
    pushGraphHistory()
    const id = `custom-${block.id}-${Date.now()}`
    const x = 320 + (nodes.length % 3) * 220
    const y = 420 + Math.floor(nodes.length / 3) * 150
    setNodes((current) => [...current, { id, type: 'factor', position: { x, y }, data: createCustomNodeData(block) }])
    setSelectedNode(id)
    setView('workspace')
    invalidateIntent()
  }

  const openFactor = (factor: FactorDefinition) => {
    pushGraphHistory()
    const graph = buildFactorGraph(factor)
    setProjectName(`${factor.family} · ${factor.name}`)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setSelectedNode(graph.nodes.at(-2)?.id ?? graph.nodes[0]?.id ?? null)
    setView('workspace')
    setLastRun('等待检查')
    setRunResult(null)
    invalidateIntent()
  }

  const undoGraph = () => {
    const previous = graphHistory.at(-1)
    if (!previous) return
    setNodes(previous.nodes)
    setEdges(previous.edges)
    setGraphHistory((current) => current.slice(0, -1))
    setSelectedNode(previous.nodes.find((node) => node.data.status === 'selected')?.id ?? previous.nodes.at(-1)?.id ?? null)
    invalidateIntent()
  }

  const generateIntentDescription = () => {
    setIntentText(createIntentDraft(nodes, edges, expression))
    setIntentConfirmed(false)
    setIntentChecks({ logic: false, parameters: false, data: false })
    setInspectorTab('intent')
  }

  const confirmIntent = () => {
    if (!intentText.trim() || !intentChecks.logic || !intentChecks.parameters || !intentChecks.data) return
    setIntentConfirmed(true)
  }

  const createCustomBlock = () => {
    const name = customBlockDraft.name.trim()
    const expressionText = customBlockDraft.expression.trim()
    if (!name || !expressionText || !/\bx\b/.test(expressionText)) {
      window.alert('请填写名称，并在公式中使用 x 表示输入序列，例如 x * 2。')
      return
    }
    if (!/^[x\d\s+\-*/().,%<>!=&|a-zA-Z_]+$/.test(expressionText)) {
      window.alert('公式只支持 x、数字、括号、基本运算和已登记函数。')
      return
    }
    const block: CustomBlockRecord = {
      id: `custom-block-${Date.now()}`,
      name,
      symbol: customBlockDraft.symbol.trim() || 'fx',
      description: customBlockDraft.description.trim() || `用户公式：${expressionText}`,
      expression: expressionText,
      createdAt: new Date().toISOString(),
    }
    setCustomBlocks((current) => [...current, block])
    setCustomBlockDraft({ name: '', symbol: 'fx', description: '', expression: 'x * 2' })
    setShowCustomBlockModal(false)
    addCustomBlockNode(block)
  }

  const saveStatusText = saveState === 'loading'
    ? '读取本地项目'
    : saveState === 'saving'
      ? '正在本地保存'
      : saveState === 'restored'
        ? '已恢复本地项目'
        : saveState === 'error'
          ? '本地保存失败'
          : '本地已保存'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <div>
            <div className="brand-name">王大粘</div>
            <div className="brand-product">因子工坊 <span>·</span> Factor Canvas</div>
          </div>
        </div>
        <nav className="topnav" aria-label="主导航">
          <button className={view === 'workspace' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => setView('workspace')}><Workflow size={16} /> 工作台</button>
          <button className={view === 'library' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => setView('library')}><BookOpen size={16} /> 因子库</button>
          <button className={view === 'data' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => setView('data')}><Database size={16} /> 数据</button>
          <button className={view === 'export' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => setView('export')}><ArrowDownToLine size={16} /> 导出</button>
        </nav>
        <div className="top-actions">
          <a className="zhihu-link" href="https://www.zhihu.com/search?type=content&q=%E7%8E%8B%E5%A4%A7%E7%B2%98" target="_blank" rel="noreferrer"><span className="zhihu-dot">知</span> 王大粘 · 知乎</a>
          <button className="icon-button" title="设置"><Settings2 size={17} /></button>
          <button className="avatar-button" title="个人项目">王</button>
        </div>
      </header>

      <div className="workspace-bar">
        <div className="workspace-title">
          <button className="workspace-menu icon-button" title="项目菜单"><Menu size={17} /></button>
          <div><strong>{projectName}</strong><span>个人因子 / 本地项目</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
        <div className="workspace-meta"><span className={`save-state save-state-${saveState}`}><Check size={14} /> {saveStatusText}</span><span>数据：{dataName}</span><span>运行：{lastRun}</span></div>
        <div className="workspace-actions">
          <button className="icon-button" title="打开本地项目" onClick={() => projectFileInputRef.current?.click()}><FolderOpen size={16} /></button>
          <button className="icon-button" title="保存项目文件" onClick={saveProjectFile}><Save size={16} /></button>
          <button className="secondary-button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> 导入数据</button>
          <button className="primary-button" onClick={runFactor} disabled={isRunning}>{isRunning ? <span className="spinner" /> : <Play size={15} />} {isRunning ? '运行中' : '运行检查'}</button>
          <input ref={fileInputRef} className="hidden-input" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={onFileChange} />
          <input ref={projectFileInputRef} className="hidden-input" type="file" accept=".json,.wdz-factor.json,application/json" onChange={onProjectFileChange} />
        </div>
      </div>

      <main className="main-layout">
        <aside className="left-rail">
          <div className="rail-heading"><span>积木</span><button className="icon-button small" title="搜索积木"><Search size={15} /></button></div>
          <div className="library-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索积木" /></div>
          {blockCategories.map((category) => {
            const items = filteredLibrary.filter((item) => item.categoryId === category.id)
            if (items.length === 0) return null
            const collapsed = Boolean(collapsedCategories[category.id])
            const total = blockDefinitions.filter((item) => item.categoryId === category.id).length
            return <div className="library-group" key={category.id}>
              <button className="group-title" onClick={() => setCollapsedCategories((current) => ({ ...current, [category.id]: !current[category.id] }))}>
                <span className="group-title-name"><ChevronRight size={13} className={collapsed ? '' : 'group-chevron-open'} />{category.label}</span>
                <span className="group-count">{search ? `${items.length}/${total}` : total}</span>
              </button>
              {!collapsed && <div className="group-items">{items.map((item) => <LibraryButton key={item.id} item={item} onClick={() => addLibraryNode(item)} />)}</div>}
            </div>
          })}
          <div className="library-group custom-library-group">
            <button className="group-title" onClick={() => setCollapsedCategories((current) => ({ ...current, custom: !current.custom }))}>
              <span className="group-title-name"><ChevronRight size={13} className={collapsedCategories.custom ? '' : 'group-chevron-open'} />自定义积木</span>
              <span className="group-count">{customBlocks.length}</span>
            </button>
            {!collapsedCategories.custom && <div className="group-items">
              {customBlocks.map((block) => <button className="library-button" key={block.id} onClick={() => addCustomBlockNode(block)} title={block.description}>
                <span className="library-symbol" style={{ color: '#6f7eb8', borderColor: '#6f7eb855' }}>{block.symbol}</span>
                <span className="library-button-copy"><strong>{block.name}</strong><small>{block.expression}</small></span>
                <Plus size={13} />
              </button>)}
              {!customBlocks.length && <div className="custom-library-empty">先创建一个公式积木，它会出现在这里。</div>}
            </div>}
          </div>
          <div className="rail-footer"><button className="create-block-button" onClick={() => setShowCustomBlockModal(true)}><Plus size={15} /> 创建自定义积木</button><div className="rail-note"><Sparkles size={14} /> AI 建议只生成草稿，加入画布前由你确认</div></div>
        </aside>

        <section className="canvas-area">
          {view === 'workspace' && <>
            <div className="canvas-header"><div><div className="eyebrow">FACTOR WORKSPACE</div><h1>把一个想法拆成可验证的积木</h1></div><div className="canvas-header-actions"><button className="text-button" onClick={undoGraph} disabled={!graphHistory.length}><RotateCcw size={15} /> 撤销</button><button className="text-button" onClick={runFactor}><ClipboardCheck size={15} /> 检查定义</button></div></div>
            <div className="canvas-flow">
              <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ factor: FactorNodeCard }} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={handleConnect} isValidConnection={isValidConnection} onNodeClick={handleNodeClick} fitView fitViewOptions={{ padding: 0.25 }} minZoom={0.5} maxZoom={1.5}>
                <Background variant={BackgroundVariant.Lines} gap={28} size={1} color="#d9e0de" />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap pannable zoomable nodeColor={(node) => (node.data as FactorNodeData)?.accent ?? '#7c9696'} maskColor="rgba(245, 247, 248, 0.72)" position="bottom-right" />
                <Panel position="top-right" className="canvas-panel"><span className="canvas-live-dot" /> 计算图 · {nodes.length} 个积木</Panel>
              </ReactFlow>
            </div>
            <div className="formula-strip"><div className="formula-label"><Code2 size={15} /> 当前表达式</div><code>{expression || '等待连接输出积木'}</code><span className={`formula-status ${compilation.warnings.length ? 'formula-status-warning' : ''}`}>{compilation.warnings.length ? <><CircleHelp size={13} /> 需核对</> : <><Check size={13} /> DAG 已编译</>}</span><button className="copy-button" title="复制表达式" onClick={() => navigator.clipboard?.writeText(expression)}><FileDown size={15} /></button></div>
          </>}
          {view === 'library' && <LibraryView onOpenFactor={openFactor} />}
          {view === 'data' && <DataView
            rows={rows}
            originalRows={originalRows}
            cleanedRows={cleanedRows}
            dataName={dataName}
            quality={quality}
            originalQuality={originalQuality}
            cleanedQuality={cleanedQuality}
            currentDataVersion={currentDataVersion}
            parseReport={parseReport}
            cleaningOptions={cleaningOptions}
            cleaningSummary={cleaningSummary}
            runResult={runResult}
            onImport={() => fileInputRef.current?.click()}
            onUseVersion={useDataVersion}
            onCleaningOptionsChange={updateCleaningOptions}
            onApplyCleaning={applyCleaning}
            onUndoCleaning={undoCleaning}
            onRun={runFactor}
          />}
          {view === 'export' && <ExportView expression={expression} code={pythonCode} onCopy={(value) => navigator.clipboard?.writeText(value)} onDownload={saveProjectFile} />}
        </section>

        <aside className="right-rail">
          <div className="inspector-tabs"><button className={`inspector-tab ${inspectorTab === 'node' ? 'inspector-tab-active' : ''}`} onClick={() => setInspectorTab('node')}>节点检查器</button><button className={`inspector-tab ${inspectorTab === 'intent' ? 'inspector-tab-active' : ''}`} onClick={() => setInspectorTab('intent')}>意图核对</button></div>
          {inspectorTab === 'intent'
            ? <IntentReviewPanel text={intentText} confirmed={intentConfirmed} checks={intentChecks} onTextChange={(value) => { setIntentText(value); setIntentConfirmed(false) }} onGenerate={generateIntentDescription} onCheckChange={(key, value) => { setIntentChecks((current) => ({ ...current, [key]: value })); setIntentConfirmed(false) }} onConfirm={confirmIntent} />
            : selectedNodeItem && selectedDefinition
              ? <NodeInspector node={selectedNodeItem} definition={selectedDefinition} incoming={selectedIncoming} outgoing={selectedOutgoing} nodes={nodes} onParameterChange={(patch) => updateNodeParameters(selectedNodeItem.id, patch)} />
              : <EmptyInspector />}
          <div className="assistant-box"><div className="assistant-top"><div className="assistant-icon"><Lightbulb size={16} /></div><div><strong>王大粘助手</strong><span>只提建议，不替你确认</span></div></div><p>我会根据当前图提出一个可以观察的并行分支，但不会替你改图或确认含义。</p><button className="assistant-button" onClick={() => setAssistantSuggestionVisible((value) => !value)}><Sparkles size={15} /> {assistantSuggestionVisible ? '收起候选积木' : '生成候选积木'}</button>{assistantSuggestionVisible && <div className="assistant-suggestion"><strong>成交量</strong><span>理由：它可以和当前价格强弱分支并列，帮助观察量价关系。</span><div><button className="secondary-button" onClick={() => addLibraryNode(getBlockDefinition('field_volume')!)}>确认并加入画布</button><button className="text-button" onClick={() => setAssistantSuggestionVisible(false)}>先不加入</button></div></div>}</div>
        </aside>
      </main>

      <section className="bottom-dock">
        <div className="dock-tabs"><button className={`dock-tab ${dockTab === 'results' ? 'dock-tab-active' : ''}`} onClick={() => setDockTab('results')}><ClipboardCheck size={15} /> 检查结果</button><button className={`dock-tab ${dockTab === 'data' ? 'dock-tab-active' : ''}`} onClick={() => setDockTab('data')}><Database size={15} /> 数据预览 <span className="tab-count">{quality.rows}</span></button><button className={`dock-tab ${dockTab === 'code' ? 'dock-tab-active' : ''}`} onClick={() => setDockTab('code')}><Code2 size={15} /> 代码</button></div>
        {dockTab === 'results' && <>
          <div className="dock-content"><div className="run-summary"><div className={`summary-icon ${runResult?.status === 'passed' ? 'summary-success' : runResult?.status === 'blocked' ? 'summary-blocked' : 'summary-warning'}`}>{runResult?.status === 'passed' ? <Check size={16} /> : <CircleHelp size={16} />}</div><div><strong>{runResult ? (runResult.status === 'passed' ? '测试通过' : runResult.status === 'blocked' ? '暂不能本地测试' : '测试有警告') : '尚未运行测试'}</strong><span>{runResult ? `${runResult.validValues} 个有效值 · ${runResult.missingValues} 个空值` : '导入数据后运行当前因子检查'}</span></div></div><div className="quality-chips"><span><Database size={14} /> {quality.rows} 行</span><span><Layers3 size={14} /> {quality.assets} 个标的</span><span><GitBranch size={14} /> {quality.dates} 个交易日</span><span className={quality.missingValues || quality.duplicateKeys || quality.zeroPrices || quality.outOfOrderRows || invalidNumberErrors ? 'chip-warning' : ''}><CircleHelp size={14} /> {quality.missingValues ? `${quality.missingValues} 个缺失值` : quality.duplicateKeys ? `${quality.duplicateKeys} 个重复键` : quality.zeroPrices ? `${quality.zeroPrices} 行零价格` : quality.outOfOrderRows ? `${quality.outOfOrderRows} 行乱序` : invalidNumberErrors ? `${invalidNumberErrors} 个非法数字` : '质量检查通过'}</span></div><button className="dock-run-button" onClick={runFactor}><Play size={14} /> 运行检查</button></div>
          {showMore && <div className="dock-details"><div>数据版本：{currentDataVersion === 'cleaned' ? '清洗副本' : '原始数据'}</div><div>数据质量：{quality.issues.length ? quality.issues.join('；') : '质量检查通过'}</div><div>因子输出：{runResult ? `${runResult.validValues} 个有效值` : '尚未测试'}</div><div>最近输出：{runResult?.points.at(-1) ? formatNumber(runResult.points.at(-1)?.factor ?? null) : '—'}</div></div>}
          <button className="dock-expand" onClick={() => setShowMore((value) => !value)}>{showMore ? '收起详情' : '查看运行详情'} <ChevronDown size={14} className={showMore ? 'rotate-180' : ''} /></button>
        </>}
        {dockTab === 'data' && <DockDataPreview rows={rows} quality={quality} onOpen={() => setView('data')} />}
        {dockTab === 'code' && <DockCodePreview expression={expression} code={pythonCode} onCopy={(value) => navigator.clipboard?.writeText(value)} />}
      </section>
      {showCustomBlockModal && <CustomBlockModal draft={customBlockDraft} onChange={setCustomBlockDraft} onClose={() => setShowCustomBlockModal(false)} onCreate={createCustomBlock} />}
    </div>
  )
}

function LibraryButton({ item, onClick }: { item: BlockDefinition; onClick: () => void }) {
  return <button className="library-button" onClick={onClick} title={item.description}>
    <span className="library-symbol" style={{ color: item.accent, borderColor: `${item.accent}55` }}>{item.symbol}</span>
    <span className="library-button-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
    <Plus size={13} />
  </button>
}

function LibraryView({ onOpenFactor }: { onOpenFactor: (factor: FactorDefinition) => void }) {
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<'all' | 'Alpha158' | 'Alpha360'>('all')
  const allFactors = [...alpha158Factors, ...alpha360Factors]
  const filteredFactors = allFactors.filter((factor) => {
    const matchesFamily = family === 'all' || factor.family === `Qlib ${family}`
    const text = `${factor.name} ${factor.expression} ${factor.description}`.toLowerCase()
    return matchesFamily && (!query || text.includes(query.toLowerCase()))
  })
  return <div className="secondary-view">
    <div className="secondary-header"><div><div className="eyebrow">FACTOR LIBRARY</div><h1>先学习已有因子，再拆成自己的想法</h1><p>开源因子保留来源、原始表达式和可展开的原子 DAG，不再用占位卡片代替适配。</p></div></div>
    <div className="factor-library-grid factor-source-summary">
      <article className="factor-library-card factor-library-card-featured"><div className="library-card-top"><span className="library-card-tag">Qlib Alpha158</span><span className="library-card-status"><Check size={13} /> 已转译</span></div><h2>158 个可展开因子</h2><p>9 个 K 线结构、4 个价格字段、29 类滚动算子与 5 个窗口组合。</p><code>KMID · MA5 · CORR60</code><div className="library-card-footer"><span>逐项可核验</span><span>原子 DAG</span><button className="text-button" onClick={() => onOpenFactor(alpha158Factors[0])}>打开示例 <Link2 size={14} /></button></div></article>
      <article className="factor-library-card"><div className="library-card-top"><span className="library-card-tag">Qlib Alpha360</span><span className="library-card-status"><Check size={13} /> 已转译</span></div><h2>360 个历史字段因子</h2><p>收盘、开盘、最高、最低、VWAP、成交量六类字段，逐一展开为历史引用积木。</p><code>CLOSE59 · CLOSE0 · VOLUME0</code><div className="library-card-footer"><span>6 个字段</span><span>60 个滞后</span><button className="text-button" onClick={() => onOpenFactor(alpha360Factors[0])}>打开示例 <Link2 size={14} /></button></div></article>
    </div>
    <div className="factor-source-browser">
      <div className="source-browser-heading"><div><strong>开源因子清单</strong><span>{filteredFactors.length} 个匹配 · {allFactors.length} 个已登记</span></div><div className="source-browser-controls"><label className="library-search inline-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、公式或含义" /></label><select value={family} onChange={(event) => setFamily(event.target.value as typeof family)}><option value="all">全部来源</option><option value="Alpha158">Alpha158</option><option value="Alpha360">Alpha360</option></select></div></div>
      <div className="factor-source-list">{filteredFactors.map((factor) => <article className="factor-source-row" key={factor.id}><div className="factor-source-name"><strong>{factor.name}</strong><span>{factor.family}</span></div><code>{factor.expression}</code><p>{factor.description}</p><button className="text-button" onClick={() => onOpenFactor(factor)}>展开 DAG <GitBranch size={14} /></button></article>)}</div>
    </div>
  </div>
}

function ParameterControl({ parameter, value, onChange }: { parameter: BlockParameter; value: ParameterValue; onChange: (value: ParameterValue) => void }) {
  if (parameter.type === 'select') {
    return <select value={String(value)} onChange={(event) => { const option = parameter.options?.find((item) => String(item.value) === event.target.value); onChange(option?.value ?? event.target.value) }}>
      {parameter.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
    </select>
  }
  if (parameter.type === 'boolean') return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
  return <input type={parameter.type === 'number' ? 'number' : 'text'} value={String(value)} min={parameter.min} max={parameter.max} step={parameter.step} onChange={(event) => onChange(parameter.type === 'number' ? Number(event.target.value) : event.target.value)} />
}

function NodeInspector({
  node,
  definition,
  incoming,
  outgoing,
  nodes,
  onParameterChange,
}: {
  node: FactorNode
  definition: BlockDefinition
  incoming: Edge[]
  outgoing: Edge[]
  nodes: FactorNode[]
  onParameterChange: (patch: Record<string, ParameterValue>) => void
}) {
  const getSourceTitle = (edge: Edge | undefined) => edge ? nodes.find((item) => item.id === edge.source)?.data.title ?? edge.source : '未连接'
  return <>
    <div className="inspector-heading"><div className="inspector-icon" style={{ color: node.data.accent || definition.accent, background: `${node.data.accent || definition.accent}18`, borderColor: `${node.data.accent || definition.accent}33` }}>{node.data.symbol || definition.symbol}</div><div><div className="inspector-title">{node.data.title || definition.title}</div><div className="inspector-subtitle">{node.data.subtitle || definition.subtitle} · {definition.semantic}</div></div></div>
    <div className="inspector-block"><div className="block-label">这块积木在做什么</div><p>{node.data.description || definition.description}</p>{node.data.blockId === 'custom_formula' && <div className="custom-expression-preview"><span>当前公式</span><code>{node.data.customExpression || 'x'}</code></div>}<div className="semantic-line"><span>程序语义</span><code>{definition.semantic}</code><strong>已注册</strong></div></div>
    <div className="inspector-block"><div className="block-label">输入端口</div><div className="inspector-port-list">{definition.inputs.length === 0 ? <div className="port-empty">这是数据源积木，不需要上游输入。</div> : definition.inputs.map((port) => { const edge = incoming.find((item) => item.targetHandle === port.id) ?? (definition.inputs.length === 1 ? incoming[0] : undefined); return <div className="inspector-port-row" key={port.id}><div><strong>{port.label}</strong><span>{port.description}</span></div><code className={edge ? 'port-connected' : 'port-missing'}>{edge ? getSourceTitle(edge) : '未连接'}</code></div> })}</div></div>
    <div className="inspector-block"><div className="block-label">输出端口</div><div className="inspector-port-row"><div><strong>{definition.output.label}</strong><span>{definition.output.description}</span></div><code className={outgoing.length ? 'port-connected' : 'port-missing'}>{outgoing.length ? `${outgoing.length} 条连接` : '未连接'}</code></div></div>
    {definition.parameters.length > 0 && <div className="inspector-block"><div className="block-label">参数</div><div className="parameter-hint"><Settings2 size={13} /> 下面的数值可以直接编辑；也可以把“数字常数”积木接到对应端口，接线会优先于默认值。</div>{definition.parameters.map((item) => { const connectedPort = incoming.find((edge) => edge.targetHandle === item.id || (item.id === 'threshold' && edge.targetHandle === 'right') || (item.id === 'exponent' && edge.targetHandle === 'right')); return <label className="field-label" key={item.id}>{item.label}<span>{item.description} 默认 {String(item.default)}{item.min !== undefined || item.max !== undefined ? ` · 范围 ${item.min ?? '不限'} 到 ${item.max ?? '不限'}` : ''}{connectedPort ? ' · 已被端口连接覆盖' : ''}</span><ParameterControl parameter={item} value={node.data.parameters?.[item.id] ?? item.default} onChange={(value) => onParameterChange({ [item.id]: value })} /></label> })}</div>}
  </>
}

function IntentReviewPanel({
  text,
  confirmed,
  checks,
  onTextChange,
  onGenerate,
  onCheckChange,
  onConfirm,
}: {
  text: string
  confirmed: boolean
  checks: IntentReview['checks']
  onTextChange: (value: string) => void
  onGenerate: () => void
  onCheckChange: (key: keyof IntentReview['checks'], value: boolean) => void
  onConfirm: () => void
}) {
  return <div className="intent-panel">
    <div className="intent-heading"><div><strong>把图翻译成人话</strong><span>这是草稿，最终含义由你确认。</span></div><button className="text-button" onClick={onGenerate}><Sparkles size={14} /> 生成草稿</button></div>
    <textarea className="intent-textarea" value={text} onChange={(event) => onTextChange(event.target.value)} placeholder="先生成当前图描述，或直接写下你想表达的因子逻辑。" />
    <div className="intent-checks">
      <label className="intent-check"><input type="checkbox" checked={checks.logic} onChange={(event) => onCheckChange('logic', event.target.checked)} /><span><strong>逻辑顺序</strong><small>积木连接顺序和你的描述一致</small></span></label>
      <label className="intent-check"><input type="checkbox" checked={checks.parameters} onChange={(event) => onCheckChange('parameters', event.target.checked)} /><span><strong>参数设置</strong><small>窗口、阈值和数值都已核对</small></span></label>
      <label className="intent-check"><input type="checkbox" checked={checks.data} onChange={(event) => onCheckChange('data', event.target.checked)} /><span><strong>数据口径</strong><small>字段、时间范围和缺失值处理一致</small></span></label>
    </div>
    <button className="intent-confirm-button" disabled={!text.trim() || !checks.logic || !checks.parameters || !checks.data} onClick={onConfirm}><Check size={15} /> {confirmed ? '已确认与当前因子一致' : '确认这段描述与当前因子一致'}</button>
    <div className={`intent-status ${confirmed ? 'intent-status-confirmed' : 'intent-status-pending'}`}>{confirmed ? <><Check size={14} /> 已确认。图或参数变化后需要重新确认。</> : <><CircleHelp size={14} /> 尚未确认。请逐项核对后再确认。</>}</div>
  </div>
}

function DockDataPreview({ rows, quality, onOpen }: { rows: FactorRow[]; quality: ReturnType<typeof qualitySummary>; onOpen: () => void }) {
  return <div className="dock-preview dock-data-preview"><div className="dock-preview-summary"><span>当前数据 {quality.rows} 行 · {quality.assets} 个标的</span><button className="text-button" onClick={onOpen}>打开数据工作台 <ChevronRight size={14} /></button></div><div className="dock-mini-table">{rows.slice(0, 3).map((row, index) => <div className="dock-mini-row" key={`${row.timestamp}-${row.asset}-${index}`}><code>{row.timestamp}</code><strong>{row.asset}</strong><span>开 {row.open?.toFixed(2) ?? '—'}</span><span>收 {row.close?.toFixed(2) ?? '—'}</span><span>量 {row.volume?.toFixed(0) ?? '—'}</span></div>)}</div></div>
}

function DockCodePreview({ expression, code, onCopy }: { expression: string; code: string; onCopy: (value: string) => void }) {
  return <div className="dock-preview dock-code-preview"><div className="dock-code-expression"><span>数学表达式</span><code>{expression || '等待连接输出积木'}</code><button className="copy-button" title="复制表达式" onClick={() => onCopy(expression)}><FileDown size={14} /></button></div><pre><code>{code || '等待生成纯 Python 函数'}</code></pre><button className="text-button" onClick={() => onCopy(code)}>复制纯 Python <FileDown size={14} /></button></div>
}

function CustomBlockModal({
  draft,
  onChange,
  onClose,
  onCreate,
}: {
  draft: { name: string; symbol: string; description: string; expression: string }
  onChange: (draft: { name: string; symbol: string; description: string; expression: string }) => void
  onClose: () => void
  onCreate: () => void
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="custom-block-modal" role="dialog" aria-modal="true" aria-labelledby="custom-block-title">
      <div className="modal-heading"><div><strong id="custom-block-title">创建自定义积木</strong><span>把一个可复用的数学想法保存到自己的积木库。</span></div><button className="icon-button" title="关闭" onClick={onClose}><X size={16} /></button></div>
      <div className="modal-fields"><label>名称<input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="例如：放大两倍" /></label><label>积木符号<input value={draft.symbol} onChange={(event) => onChange({ ...draft, symbol: event.target.value })} maxLength={8} placeholder="fx" /></label><label className="modal-field-wide">给新手看的说明<textarea value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="例如：把输入序列乘以 2。" /></label><label className="modal-field-wide">公式<textarea className="formula-input" value={draft.expression} onChange={(event) => onChange({ ...draft, expression: event.target.value })} placeholder="x * 2" /></label></div>
      <div className="formula-hint"><Code2 size={14} /><span><strong>x</strong> 代表输入序列。现在支持基本运算、括号和已登记函数，例如 <code>x * 2</code>、<code>(x - 1) / (x + 1)</code>。</span></div>
      <div className="modal-actions"><button className="text-button" onClick={onClose}>取消</button><button className="primary-button" onClick={onCreate}><Plus size={15} /> 创建并加入画布</button></div>
    </section>
  </div>
}

function DataView({
  rows,
  originalRows,
  cleanedRows,
  dataName,
  quality,
  originalQuality,
  cleanedQuality,
  currentDataVersion,
  parseReport,
  cleaningOptions,
  cleaningSummary,
  runResult,
  onImport,
  onUseVersion,
  onCleaningOptionsChange,
  onApplyCleaning,
  onUndoCleaning,
  onRun,
}: {
  rows: FactorRow[]
  originalRows: FactorRow[]
  cleanedRows: FactorRow[] | null
  dataName: string
  quality: ReturnType<typeof qualitySummary>
  originalQuality: ReturnType<typeof qualitySummary>
  cleanedQuality: ReturnType<typeof qualitySummary> | null
  currentDataVersion: 'original' | 'cleaned'
  parseReport: DataParseResult | null
  cleaningOptions: CleaningOptions
  cleaningSummary: CleaningResult | null
  runResult: FactorRunResult | null
  onImport: () => void
  onUseVersion: (version: 'original' | 'cleaned') => void
  onCleaningOptionsChange: (patch: Partial<CleaningOptions>) => void
  onApplyCleaning: () => void
  onUndoCleaning: () => void
  onRun: () => void
}) {
  const activeQuality = currentDataVersion === 'cleaned' && cleanedQuality ? cleanedQuality : originalQuality
  const fieldMap = parseReport?.fieldMap
  const invalidNumberCount = activeQuality.invalidNumbers + (currentDataVersion === 'original' ? parseReport?.errors.filter((issue) => issue.includes('不是有效数字')).length ?? 0 : 0)
  return <div className="secondary-view data-view">
    <div className="secondary-header"><div><div className="eyebrow">DATA INTAKE</div><h1>你的数据，先看清楚再计算</h1><p>原始文件不会被覆盖。先检查字段和质量，再生成清洗副本和测试结果。</p></div><button className="primary-button" onClick={onImport}><Upload size={15} /> 导入 CSV / TSV</button></div>
    <div className="data-overview">
      <div className="data-file-card"><div className="file-icon"><FileSpreadsheet size={20} /></div><div><strong>{dataName}</strong><span>{currentDataVersion === 'cleaned' ? '当前使用：清洗副本' : '当前使用：原始数据'} · 本地文件</span></div><span className="data-ready"><Check size={14} /> 原始数据保留</span></div>
      <div className="data-version-switcher"><button className={currentDataVersion === 'original' ? 'data-version-active' : ''} onClick={() => onUseVersion('original')}><span>原始数据</span><strong>{originalRows.length.toLocaleString()} 行</strong><small>{originalQuality.issues.length ? `${originalQuality.issues.length} 类问题` : '质量检查通过'}</small></button><button className={currentDataVersion === 'cleaned' ? 'data-version-active' : ''} disabled={!cleanedRows} onClick={() => onUseVersion('cleaned')}><span>清洗副本</span><strong>{cleanedRows ? cleanedRows.length.toLocaleString() : '—'} 行</strong><small>{cleanedQuality ? (cleanedQuality.issues.length ? `${cleanedQuality.issues.length} 类问题` : '可用于测试') : '还没有清洗副本'}</small></button></div>
      <div className="metric-row metric-row-wide"><Metric label="数据行" value={activeQuality.rows.toLocaleString()} /><Metric label="标的" value={activeQuality.assets.toString()} /><Metric label="日期" value={activeQuality.dates.toString()} /><Metric label="重复键" value={activeQuality.duplicateKeys.toString()} tone={activeQuality.duplicateKeys ? 'warning' : 'normal'} /><Metric label="缺失值" value={activeQuality.missingValues.toString()} tone={activeQuality.missingValues ? 'warning' : 'normal'} /><Metric label="非法数字" value={invalidNumberCount.toString()} tone={invalidNumberCount ? 'warning' : 'normal'} /><Metric label="零价格" value={activeQuality.zeroPrices.toString()} tone={activeQuality.zeroPrices ? 'warning' : 'normal'} /><Metric label="乱序行" value={activeQuality.outOfOrderRows.toString()} tone={activeQuality.outOfOrderRows ? 'warning' : 'normal'} /></div>
    </div>
    <div className="data-workbench-grid">
      <section className="data-panel"><div className="data-panel-heading"><div><strong>字段识别</strong><span>导入时自动映射，导出前可核对</span></div><span className="data-panel-status">{parseReport ? `${parseReport.sourceRows} 行已读取` : '示例数据'}</span></div><div className="field-map-grid">{(['timestamp', 'asset', 'open', 'high', 'low', 'close', 'volume', 'amount', 'vwap'] as const).map((field) => <div className="field-map-item" key={field}><span>{field}</span><strong>{fieldMap?.[field] ?? (field === 'high' || field === 'low' || field === 'volume' || field === 'amount' || field === 'vwap' ? '未提供' : '示例字段')}</strong></div>)}</div>{parseReport?.errors.length ? <div className="data-issues data-issues-error"><strong>解析需要处理</strong>{parseReport.errors.slice(0, 4).map((issue) => <span key={issue}>{issue}</span>)}</div> : null}{parseReport?.warnings.length ? <div className="data-issues"><strong>导入提醒</strong>{parseReport.warnings.map((issue) => <span key={issue}>{issue}</span>)}</div> : null}</section>
      <section className="data-panel"><div className="data-panel-heading"><div><strong>清洗副本</strong><span>规则只作用于副本，原始数据可随时切回</span></div><button className="text-button" onClick={onUndoCleaning} disabled={!cleanedRows}><RotateCcw size={14} /> 撤销清洗</button></div><div className="cleaning-controls"><label>重复键<select value={cleaningOptions.duplicate} onChange={(event) => onCleaningOptionsChange({ duplicate: event.target.value as CleaningOptions['duplicate'] })}><option value="keep-first">保留首条</option><option value="keep-last">保留末条</option><option value="keep-all">暂不处理</option></select></label><label>缺失值<select value={cleaningOptions.missing} onChange={(event) => onCleaningOptionsChange({ missing: event.target.value as CleaningOptions['missing'] })}><option value="keep">保留并提示</option><option value="drop-row">删除整行</option><option value="forward-fill">按标的前值填充</option><option value="fill-value">使用固定值</option></select></label>{cleaningOptions.missing === 'fill-value' && <label>固定值<input type="number" value={String(cleaningOptions.fillValue ?? 0)} step="0.01" onChange={(event) => onCleaningOptionsChange({ fillValue: Number(event.target.value) })} /></label>}</div><button className="secondary-button" onClick={onApplyCleaning}><ClipboardCheck size={15} /> 生成清洗副本</button>{cleaningSummary && <div className="cleaning-result"><strong>本次处理：删除 {cleaningSummary.removedRows} 行，修改 {cleaningSummary.changedCells} 个单元格</strong><span>{cleaningSummary.appliedRules.length ? cleaningSummary.appliedRules.join('；') : '没有需要修改的数据'}</span></div>}</section>
    </div>
    <section className="data-test-panel"><div className="data-panel-heading"><div><strong>因子测试</strong><span>当前画布 · {currentDataVersion === 'cleaned' ? '清洗副本' : '原始数据'}</span></div><button className="primary-button" onClick={onRun}><Play size={15} /> 运行检查</button></div>{runResult ? <div className={`data-test-result data-test-result-${runResult.status}`}><div className="data-test-result-title"><strong>{runResult.status === 'passed' ? '本地测试通过' : runResult.status === 'blocked' ? '当前图暂不能本地执行' : '本地测试完成，但需要核对'}</strong><code>{runResult.expression || '未生成表达式'}</code></div><div className="test-result-metrics"><Metric label="有效输出" value={runResult.validValues.toString()} tone={runResult.validValues ? 'normal' : 'warning'} /><Metric label="空值输出" value={runResult.missingValues.toString()} tone={runResult.missingValues ? 'warning' : 'normal'} /><Metric label="警告" value={runResult.warnings.length.toString()} tone={runResult.warnings.length ? 'warning' : 'normal'} /></div>{runResult.warnings.length > 0 && <div className="data-issues"><strong>需要确认</strong>{runResult.warnings.slice(0, 5).map((warning) => <span key={warning}>{warning}</span>)}</div>}{runResult.points.length > 0 && <div className="test-preview"><span>最近输出</span>{runResult.points.slice(-6).map((point, index) => <code key={`${point.timestamp}-${point.asset}-${index}`}>{point.timestamp} / {point.asset}：{formatNumber(point.factor)}</code>)}</div>}</div> : <div className="data-test-empty"><ClipboardCheck size={18} /><span>运行后这里会显示真实有效值、空值、警告和结果预览。</span></div>}</section>
    <div className="data-table-wrap"><div className="table-heading"><strong>{currentDataVersion === 'cleaned' ? '清洗数据' : '当前数据'} · 前 8 行预览</strong><span>字段：timestamp · asset · open · high · low · close · volume</span></div><table><thead><tr><th>timestamp</th><th>asset</th><th>open</th><th>high</th><th>low</th><th>close</th><th>volume</th><th>close / open</th></tr></thead><tbody>{rows.slice(0, 8).map((row, index) => <tr key={`${row.timestamp}-${row.asset}-${index}`}><td>{row.timestamp}</td><td><span className="asset-code">{row.asset}</span></td><td>{row.open?.toFixed(2) ?? '—'}</td><td>{row.high?.toFixed(2) ?? '—'}</td><td>{row.low?.toFixed(2) ?? '—'}</td><td>{row.close?.toFixed(2) ?? '—'}</td><td>{row.volume?.toFixed(0) ?? '—'}</td><td className="value-emphasis">{row.open !== null && row.open !== 0 && row.close !== null ? `${((row.close / row.open - 1) * 100).toFixed(2)}%` : '—'}</td></tr>)}</tbody></table></div>
  </div>
}

function ExportView({ expression, code, onCopy, onDownload }: { expression: string; code: string; onCopy: (value: string) => void; onDownload: () => void }) {
  return <div className="secondary-view"><div className="secondary-header"><div><div className="eyebrow">TAKE IT WITH YOU</div><h1>把因子带到你的量化环境</h1><p>先导出计算定义和输入契约，再在 Backtrader、Qlib、vn.py 或自有系统中接入。</p></div><button className="primary-button" onClick={onDownload}><Download size={15} /> 下载项目包</button></div><div className="export-grid"><article className="export-card export-card-main"><div className="export-card-header"><div className="export-icon"><Code2 size={18} /></div><div><strong>纯计算函数</strong><span>由当前 DAG 编译 · 无交易框架依赖</span></div></div><pre><code>{code}</code></pre><button className="secondary-button" onClick={() => onCopy(code)}><FileDown size={15} /> 复制代码</button></article><article className="export-card"><div className="export-card-header"><div className="export-icon export-icon-amber"><GitBranch size={18} /></div><div><strong>数学表达式</strong><span>由当前 DAG 编译 · 适合阅读与迁移</span></div></div><code className="export-expression">{expression}</code><button className="text-button" onClick={() => onCopy(expression)}>复制表达式 <FileDown size={14} /></button></article><article className="export-card"><div className="export-card-header"><div className="export-icon export-icon-green"><ClipboardCheck size={18} /></div><div><strong>验证清单</strong><span>跟代码一起带走</span></div></div><ul className="export-checklist"><li><Check size={14} /> 输入字段和单位</li><li><Check size={14} /> 窗口与缺失值口径</li><li><Check size={14} /> 参考样例与容差</li><li><Check size={14} /> 算子版本与依赖</li></ul></article></div></div>
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warning' }) {
  return <div className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong></div>
}

function EmptyInspector() {
  return <div className="empty-inspector"><MousePointer2 size={20} /><strong>选择一个积木</strong><span>查看它的含义、参数和输入输出。</span></div>
}

export default App

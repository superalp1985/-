import type { FactorSettings } from './factor'
import { canonicalBlockId, getBlockDefinition, type BlockPort, type ParameterValue } from './blocks'
import { PYTHON_RUNTIME_HELPERS } from './pythonRuntime'

export type GraphNode = {
  id: string
  data: {
    blockId?: string
    kind?: 'input' | 'operator' | 'output'
    title?: string
    parameters?: Record<string, ParameterValue>
    customExpression?: string
  }
}

export type GraphEdge = {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type GraphCompileResult = {
  expression: string
  warnings: string[]
}

export function isLocalCalculationSupported(expression: string): boolean {
  const normalized = expression.replace(/\s+/g, '').replace(/\(Close\/Open\)/g, 'Close/Open')
  return normalized.startsWith('Cs_ZScore(Ts_Rank(Close/Open,')
}

type CompiledNode = {
  expression: string
  reference?: string
  lines: string[]
}

function nodeBlockId(node: GraphNode): string {
  return canonicalBlockId(node.data.blockId ?? node.id) ?? node.data.blockId ?? node.id
}

function nodeLabel(node: GraphNode): string {
  return node.data.title ?? getBlockDefinition(nodeBlockId(node))?.title ?? node.id
}

function sanitizeIdentifier(value: string): string {
  const identifier = value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^\d+/, '')
  return identifier || 'value'
}

function parameter(node: GraphNode, id: string, fallback: ParameterValue): ParameterValue {
  return node.data.parameters?.[id] ?? fallback
}

function numberParameter(node: GraphNode, id: string, fallback: number): number {
  const value = parameter(node, id, fallback)
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanParameter(node: GraphNode, id: string, fallback: boolean): boolean {
  const value = parameter(node, id, fallback)
  return typeof value === 'boolean' ? value : fallback
}

function formatParameter(value: ParameterValue): string {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value !== 0 && Math.abs(value) < 1e-8) return value.toExponential().replace('e+', 'e')
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)))
}

function combineInputs(inputs: string[], operator: string): string {
  if (inputs.length === 0) return 'value'
  if (inputs.length === 1) return inputs[0]
  return `(${inputs.join(` ${operator} `)})`
}

function inputSourcesFor(
  node: GraphNode,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  warnings: Set<string>,
): Map<string, GraphNode> {
  const definition = getBlockDefinition(nodeBlockId(node))
  const sources = new Map<string, GraphNode>()
  if (!definition || definition.inputs.length === 0) return sources

  const incoming = edges.filter((edge) => edge.target === node.id)
  let legacyIndex = 0
  for (const edge of incoming) {
    let port: BlockPort | undefined
    if (edge.targetHandle) {
      port = definition.inputs.find((candidate) => candidate.id === edge.targetHandle)
      if (!port) {
        warnings.add(`${nodeLabel(node)}：输入端口 ${edge.targetHandle} 不存在`)
        continue
      }
    } else {
      port = definition.inputs[legacyIndex]
      legacyIndex += 1
    }
    const source = nodes.get(edge.source)
    if (!port || !source) continue
    if (sources.has(port.id)) warnings.add(`${nodeLabel(node)}：输入端口 ${port.label} 有多条连接，已保留最后一条`)
    sources.set(port.id, source)
  }
  return sources
}

function checkRequiredInputs(node: GraphNode, sources: Map<string, GraphNode>, warnings: Set<string>) {
  const definition = getBlockDefinition(nodeBlockId(node))
  if (!definition) return
  for (const port of definition.inputs) {
    if (port.required !== false && !sources.has(port.id)) warnings.add(`${nodeLabel(node)}：缺少输入端口 ${port.label}`)
  }
}

function expressionForNode(node: GraphNode, inputs: Map<string, string>, settings: FactorSettings, warnings: Set<string>): string {
  const blockId = nodeBlockId(node)
  const firstPort = getBlockDefinition(blockId)?.inputs[0]?.id ?? 'series'
  const first = inputs.get(firstPort)
  const input = (port: string, fallback: string) => inputs.get(port) ?? fallback
  const window = Math.max(2, Math.round(numberParameter(node, 'window', settings.window)))
  const minSamples = Math.max(1, Math.min(window, Math.round(numberParameter(node, 'min_samples', settings.minSamples))))
  const descending = booleanParameter(node, 'descending', settings.descending)
  const direction = descending ? 'desc' : 'asc'
  const parameterText = (id: string, fallback: ParameterValue) => formatParameter(parameter(node, id, fallback))

  switch (blockId) {
    case 'market_data': return 'MarketData'
    case 'field_open': return 'Open'
    case 'field_high': return 'High'
    case 'field_low': return 'Low'
    case 'field_close': return 'Close'
    case 'field_volume': return 'Volume'
    case 'field_amount': return 'Amount'
    case 'field_vwap': return 'VWAP'
    case 'constant': return parameterText('value', 1)
    case 'close_open_ratio': return 'Close / Open'
    case 'add': return combineInputs([input('left', 'value'), input('right', 'value')], '+')
    case 'subtract': return combineInputs([input('left', 'value'), input('right', 'value')], '-')
    case 'multiply': return combineInputs([input('left', 'value'), input('right', 'value')], '*')
    case 'divide': return combineInputs([input('left', 'value'), input('right', 'value')], '/')
    case 'power': return `Pow(${input('left', 'value')}, ${input('right', parameterText('exponent', 2))})`
    case 'abs': return `Abs(${first ?? 'value'})`
    case 'negate': return `(-${first ?? 'value'})`
    case 'log': return `Log(${first ?? 'value'})`
    case 'exp': return `Exp(${first ?? 'value'})`
    case 'sqrt': return `Sqrt(${first ?? 'value'})`
    case 'sign': return `Sign(${first ?? 'value'})`
    case 'maximum': return `Maximum(${input('left', 'value')}, ${input('right', 'value')})`
    case 'minimum': return `Minimum(${input('left', 'value')}, ${input('right', 'value')})`
    case 'clip': return `Clip(${input('series', 'value')}, ${input('low', parameterText('low', -1))}, ${input('high', parameterText('high', 1))})`
    case 'greater': return `(${input('left', 'value')} > ${input('right', parameterText('threshold', 0))})`
    case 'less': return `(${input('left', 'value')} < ${input('right', parameterText('threshold', 0))})`
    case 'equal': return `(${input('left', 'value')} == ${input('right', parameterText('threshold', 0))})`
    case 'and': return `(${input('left', 'false')} AND ${input('right', 'false')})`
    case 'or': return `(${input('left', 'false')} OR ${input('right', 'false')})`
    case 'not': return `(NOT ${first ?? 'false'})`
    case 'where': return `Where(${input('condition', 'false')}, ${input('when_true', 'value')}, ${input('when_false', 'value')})`
    case 'fill_missing': return `FillMissing(${input('series', 'value')}, ${input('value', parameterText('value', 0))})`
    case 'custom_formula': {
      const customExpression = node.data.customExpression?.trim()
      if (!customExpression) {
        warnings.add(`${nodeLabel(node)}：自定义公式为空`)
        return input('series', 'value')
      }
      if (!/\bx\b/.test(customExpression)) warnings.add(`${nodeLabel(node)}：自定义公式应使用 x 表示输入序列`)
      return customExpression.replace(/\bx\b/g, input('series', 'value'))
    }
    case 'ts_ref': return `Ref(${first ?? 'value'}, ${parameterText('lag', 1)})`
    case 'ts_delta': return `Delta(${first ?? 'value'}, ${parameterText('lag', 1)})`
    case 'ts_pct_change': return `PctChange(${first ?? 'value'}, ${parameterText('lag', 1)})`
    case 'ts_mean': return `Ts_Mean(${first ?? 'MarketData'}, ${window})`
    case 'ts_sum': return `Ts_Sum(${first ?? 'MarketData'}, ${window})`
    case 'ts_std': return `Ts_Std(${first ?? 'MarketData'}, ${window})`
    case 'ts_min': return `Ts_Min(${first ?? 'MarketData'}, ${window})`
    case 'ts_max': return `Ts_Max(${first ?? 'MarketData'}, ${window})`
    case 'ts_rank': return `Ts_Rank(${first ?? 'Close / Open'}, ${window}, ${direction}, min_samples=${minSamples})`
    case 'ts_quantile': return `Ts_Quantile(${first ?? 'MarketData'}, ${window}, ${parameterText('quantile', 0.8)})`
    case 'ts_corr': return `Ts_Corr(${input('left', 'value')}, ${input('right', 'value')}, ${window}, std_tolerance=${parameterText('std_tolerance', 0)})`
    case 'ts_cov': return `Ts_Cov(${input('left', 'value')}, ${input('right', 'value')}, ${window})`
    case 'ts_slope': return `Ts_Slope(${first ?? 'MarketData'}, ${window})`
    case 'ts_rsquare': return `Ts_Rsquare(${first ?? 'MarketData'}, ${window}, std_tolerance=${parameterText('std_tolerance', 0)})`
    case 'ts_argmax': return `Ts_ArgMax(${first ?? 'MarketData'}, ${window})`
    case 'ts_argmin': return `Ts_ArgMin(${first ?? 'MarketData'}, ${window})`
    case 'ts_skew': return `Ts_Skew(${first ?? 'MarketData'}, ${window})`
    case 'ts_kurt': return `Ts_Kurt(${first ?? 'MarketData'}, ${window})`
    case 'ts_residual': return `Ts_Residual(${first ?? 'MarketData'}, ${window})`
    case 'cs_rank': return `Cs_Rank(${first ?? 'MarketData'})`
    case 'cs_zscore': return `Cs_ZScore(${first ?? 'MarketData'})`
    case 'cs_mean': return `Cs_Mean(${first ?? 'MarketData'})`
    case 'cs_std': return `Cs_Std(${first ?? 'MarketData'})`
    case 'cs_min': return `Cs_Min(${first ?? 'MarketData'})`
    case 'cs_max': return `Cs_Max(${first ?? 'MarketData'})`
    case 'cs_center': return `Cs_Center(${first ?? 'MarketData'})`
    case 'cs_scale': return `Cs_Scale(${first ?? 'MarketData'})`
    case 'cs_neutralize': return `Cs_Neutralize(${input('series', 'value')}, ${input('exposure', 'value')})`
    case 'factor_output': return first ?? 'factor_value'
    default:
      warnings.add(`${nodeLabel(node)}：尚未注册程序语义`)
      return nodeLabel(node)
  }
}

function createExpressionCompiler(nodes: GraphNode[], edges: GraphEdge[], settings: FactorSettings) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const memo = new Map<string, string>()
  const warnings = new Set<string>()
  const visiting = new Set<string>()

  const compile = (node: GraphNode): string => {
    const cached = memo.get(node.id)
    if (cached) return cached
    if (visiting.has(node.id)) {
      warnings.add(`${nodeLabel(node)}：检测到循环连线`)
      return nodeLabel(node)
    }
    visiting.add(node.id)
    const sources = inputSourcesFor(node, nodeMap, edges, warnings)
    checkRequiredInputs(node, sources, warnings)
    const compiledInputs = new Map<string, string>()
    for (const [portId, source] of sources) compiledInputs.set(portId, compile(source))
    const expression = expressionForNode(node, compiledInputs, settings, warnings)
    visiting.delete(node.id)
    memo.set(node.id, expression)
    return expression
  }

  return { compile, nodeMap, warnings }
}

export function compileGraphExpression(nodes: GraphNode[], edges: GraphEdge[], settings: FactorSettings): GraphCompileResult {
  const compiler = createExpressionCompiler(nodes, edges, settings)
  const output = nodes.find((node) => nodeBlockId(node) === 'factor_output' || node.data.kind === 'output')
  if (!output) return { expression: '', warnings: ['未找到因子输出积木'] }
  return { expression: compiler.compile(output), warnings: [...compiler.warnings] }
}

function preferredVariable(node: GraphNode, blockId: string): string {
  if (node.id === 'ratio' || blockId === 'close_open_ratio') return 'ratio'
  if (node.id === 'ts-rank') return 'ts_rank'
  if (node.id === 'cs-zscore') return 'factor_value'
  return `node_${sanitizeIdentifier(node.id)}`
}

function pythonInput(input: CompiledNode | undefined, fallback: string): string {
  return input?.reference ?? input?.expression ?? fallback
}

function compilePythonNode(
  node: GraphNode,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  settings: FactorSettings,
  cache: Map<string, CompiledNode>,
  visiting: Set<string>,
  warnings: Set<string>,
): CompiledNode {
  const cached = cache.get(node.id)
  if (cached) return cached
  if (visiting.has(node.id)) {
    warnings.add(`${nodeLabel(node)}：检测到循环连线`)
    return { expression: nodeLabel(node), lines: [] }
  }
  visiting.add(node.id)
  const sourceNodes = inputSourcesFor(node, nodes, edges, warnings)
  checkRequiredInputs(node, sourceNodes, warnings)
  const inputs = new Map<string, CompiledNode>()
  for (const [portId, source] of sourceNodes) inputs.set(portId, compilePythonNode(source, nodes, edges, settings, cache, visiting, warnings))
  const inputAt = (portId: string, fallback: string) => pythonInput(inputs.get(portId), fallback)
  const expressionAt = (portId: string, fallback: string) => inputs.get(portId)?.expression ?? fallback
  const allInputs = [...inputs.values()]
  const allLines = () => allInputs.flatMap((input) => input.lines)
  const blockId = nodeBlockId(node)
  const variable = preferredVariable(node, blockId)
  const window = Math.max(2, Math.round(numberParameter(node, 'window', settings.window)))
  const minSamples = Math.max(1, Math.min(window, Math.round(numberParameter(node, 'min_samples', settings.minSamples))))
  const descending = booleanParameter(node, 'descending', settings.descending)
  const windowArg = window === settings.window && node.data.parameters?.window === undefined ? 'window' : String(window)
  const minSamplesArg = minSamples === settings.minSamples && node.data.parameters?.min_samples === undefined ? 'min_samples' : String(minSamples)
  const descendingArg = node.data.parameters?.descending === undefined ? 'descending' : (descending ? 'True' : 'False')
  const result = (expression: string, lines: string[] = [], reference = variable): CompiledNode => ({ expression, reference, lines })
  let compiled: CompiledNode

  switch (blockId) {
    case 'market_data': compiled = { expression: 'MarketData', reference: 'df', lines: [] }; break
    case 'field_open': compiled = { expression: 'Open', reference: 'df["open"]', lines: [] }; break
    case 'field_high': compiled = { expression: 'High', reference: 'df["high"]', lines: [] }; break
    case 'field_low': compiled = { expression: 'Low', reference: 'df["low"]', lines: [] }; break
    case 'field_close': compiled = { expression: 'Close', reference: 'df["close"]', lines: [] }; break
    case 'field_volume': compiled = { expression: 'Volume', reference: 'df["volume"]', lines: [] }; break
    case 'field_amount': compiled = { expression: 'Amount', reference: 'df["amount"]', lines: [] }; break
    case 'field_vwap': compiled = { expression: 'VWAP', reference: 'df["vwap"]', lines: [] }; break
    case 'constant': {
      const value = parameter(node, 'value', 1)
      compiled = { expression: formatParameter(value), reference: formatParameter(value), lines: [] }
      break
    }
    case 'close_open_ratio': compiled = result('Close / Open', ['ratio = safe_divide(df["close"], df["open"])'], 'ratio'); break
    case 'add': compiled = result(`(${expressionAt('left', 'value')} + ${expressionAt('right', 'value')})`, [...allLines(), `${variable} = ${inputAt('left', 'df')} + ${inputAt('right', 'df')}`]); break
    case 'subtract': compiled = result(`(${expressionAt('left', 'value')} - ${expressionAt('right', 'value')})`, [...allLines(), `${variable} = ${inputAt('left', 'df')} - ${inputAt('right', 'df')}`]); break
    case 'multiply': compiled = result(`(${expressionAt('left', 'value')} * ${expressionAt('right', 'value')})`, [...allLines(), `${variable} = ${inputAt('left', 'df')} * ${inputAt('right', 'df')}`]); break
    case 'divide': compiled = result(`(${expressionAt('left', 'value')} / ${expressionAt('right', 'value')})`, [...allLines(), `${variable} = safe_divide(${inputAt('left', 'df')}, ${inputAt('right', 'df')})`]); break
    case 'power': {
      const exponentExpression = expressionAt('right', String(numberParameter(node, 'exponent', 2)))
      const exponentReference = inputAt('right', String(numberParameter(node, 'exponent', 2)))
      compiled = result(`Pow(${expressionAt('left', 'value')}, ${exponentExpression})`, [...allLines(), `${variable} = ${inputAt('left', 'df')} ** ${exponentReference}`])
      break
    }
    case 'abs': compiled = result(`Abs(${expressionAt('series', 'value')})`, [...allLines(), `${variable} = np.abs(${inputAt('series', 'df')})`]); break
    case 'negate': compiled = result(`(-${expressionAt('series', 'value')})`, [...allLines(), `${variable} = -(${inputAt('series', 'df')})`]); break
    case 'log': compiled = result(`Log(${expressionAt('series', 'value')})`, [...allLines(), `${variable} = finite_result(np.log(${inputAt('series', 'df')}))`]); break
    case 'exp': compiled = result(`Exp(${expressionAt('series', 'value')})`, [...allLines(), `${variable} = np.exp(${inputAt('series', 'df')})`]); break
    case 'sqrt': compiled = result(`Sqrt(${expressionAt('series', 'value')})`, [...allLines(), `${variable} = np.sqrt(${inputAt('series', 'df')})`]); break
    case 'sign': compiled = result(`Sign(${expressionAt('series', 'value')})`, [...allLines(), `${variable} = np.sign(${inputAt('series', 'df')})`]); break
    case 'maximum': compiled = result(`Maximum(${expressionAt('left', 'value')}, ${expressionAt('right', 'value')})`, [...allLines(), `${variable} = np.maximum(${inputAt('left', 'df')}, ${inputAt('right', 'df')})`]); break
    case 'minimum': compiled = result(`Minimum(${expressionAt('left', 'value')}, ${expressionAt('right', 'value')})`, [...allLines(), `${variable} = np.minimum(${inputAt('left', 'df')}, ${inputAt('right', 'df')})`]); break
    case 'clip': compiled = result(`Clip(${expressionAt('series', 'value')}, ${expressionAt('low', String(numberParameter(node, 'low', -1)))}, ${expressionAt('high', String(numberParameter(node, 'high', 1)))})`, [...allLines(), `${variable} = np.clip(${inputAt('series', 'df')}, ${inputAt('low', String(numberParameter(node, 'low', -1)))}, ${inputAt('high', String(numberParameter(node, 'high', 1)))})`]); break
    case 'greater': compiled = result(`(${expressionAt('left', 'value')} > ${expressionAt('right', String(numberParameter(node, 'threshold', 0)))})`, [...allLines(), `${variable} = ${inputAt('left', 'df')} > ${inputAt('right', String(numberParameter(node, 'threshold', 0)))}`]); break
    case 'less': compiled = result(`(${expressionAt('left', 'value')} < ${expressionAt('right', String(numberParameter(node, 'threshold', 0)))})`, [...allLines(), `${variable} = ${inputAt('left', 'df')} < ${inputAt('right', String(numberParameter(node, 'threshold', 0)))}`]); break
    case 'equal': compiled = result(`(${expressionAt('left', 'value')} == ${expressionAt('right', String(numberParameter(node, 'threshold', 0)))})`, [...allLines(), `${variable} = ${inputAt('left', 'df')} == ${inputAt('right', String(numberParameter(node, 'threshold', 0)))}`]); break
    case 'and': compiled = result(`(${expressionAt('left', 'false')} AND ${expressionAt('right', 'false')})`, [...allLines(), `${variable} = ${inputAt('left', 'False')} & ${inputAt('right', 'False')}`]); break
    case 'or': compiled = result(`(${expressionAt('left', 'false')} OR ${expressionAt('right', 'false')})`, [...allLines(), `${variable} = ${inputAt('left', 'False')} | ${inputAt('right', 'False')}`]); break
    case 'not': compiled = result(`(NOT ${expressionAt('condition', 'false')})`, [...allLines(), `${variable} = ~(${inputAt('condition', 'False')})`]); break
    case 'where': compiled = result(`Where(${expressionAt('condition', 'false')}, ${expressionAt('when_true', 'value')}, ${expressionAt('when_false', 'value')})`, [...allLines(), `${variable} = np.where(${inputAt('condition', 'False')}, ${inputAt('when_true', 'df')}, ${inputAt('when_false', 'df')})`]); break
    case 'fill_missing': compiled = result(`FillMissing(${expressionAt('series', 'value')}, ${expressionAt('value', String(numberParameter(node, 'value', 0)))})`, [...allLines(), `${variable} = fill_missing(${inputAt('series', 'df')}, ${inputAt('value', String(numberParameter(node, 'value', 0)))})`]); break
    case 'custom_formula': {
      const customExpression = node.data.customExpression?.trim() || 'x'
      const pythonExpression = customExpression.replace(/\bx\b/g, inputAt('series', 'df'))
      compiled = result(customExpression.replace(/\bx\b/g, expressionAt('series', 'value')), [...allLines(), `${variable} = ${pythonExpression}`])
      break
    }
    case 'ts_ref': compiled = result(`Ref(${expressionAt('series', 'value')}, ${numberParameter(node, 'lag', 1)})`, [...allLines(), `${variable} = shift_by_asset(${inputAt('series', 'df')}, periods=${numberParameter(node, 'lag', 1)})`]); break
    case 'ts_delta': compiled = result(`Delta(${expressionAt('series', 'value')}, ${numberParameter(node, 'lag', 1)})`, [...allLines(), `${variable} = ${inputAt('series', 'df')} - shift_by_asset(${inputAt('series', 'df')}, periods=${numberParameter(node, 'lag', 1)})`]); break
    case 'ts_pct_change': compiled = result(`PctChange(${expressionAt('series', 'value')}, ${numberParameter(node, 'lag', 1)})`, [...allLines(), `${variable} = pct_change_by_asset(${inputAt('series', 'df')}, periods=${numberParameter(node, 'lag', 1)})`]); break
    case 'ts_mean': compiled = result(`Ts_Mean(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_mean(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_sum': compiled = result(`Ts_Sum(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_sum(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_std': compiled = result(`Ts_Std(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_std(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_min': compiled = result(`Ts_Min(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_min(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_max': compiled = result(`Ts_Max(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_max(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_rank': compiled = result(`Ts_Rank(${expressionAt('series', 'Close / Open')}, ${window}, ${descending ? 'desc' : 'asc'}, min_samples=${minSamples})`, [...allLines(), `${variable} = rolling_rank(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg}, descending=${descendingArg})`], variable); break
    case 'ts_quantile': compiled = result(`Ts_Quantile(${expressionAt('series', 'MarketData')}, ${window}, ${numberParameter(node, 'quantile', 0.8)})`, [...allLines(), `${variable} = rolling_quantile(${inputAt('series', 'df')}, window=${windowArg}, quantile=${numberParameter(node, 'quantile', 0.8)}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_corr': compiled = result(`Ts_Corr(${expressionAt('left', 'value')}, ${expressionAt('right', 'value')}, ${window}, std_tolerance=${numberParameter(node, 'std_tolerance', 0)})`, [...allLines(), `${variable} = rolling_corr(${inputAt('left', 'df')}, ${inputAt('right', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg}, std_tolerance=${numberParameter(node, 'std_tolerance', 0)})`]); break
    case 'ts_cov': compiled = result(`Ts_Cov(${expressionAt('left', 'value')}, ${expressionAt('right', 'value')}, ${window})`, [...allLines(), `${variable} = rolling_cov(${inputAt('left', 'df')}, ${inputAt('right', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_slope': compiled = result(`Ts_Slope(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_slope(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_rsquare': compiled = result(`Ts_Rsquare(${expressionAt('series', 'MarketData')}, ${window}, std_tolerance=${numberParameter(node, 'std_tolerance', 0)})`, [...allLines(), `${variable} = rolling_rsquare(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg}, std_tolerance=${numberParameter(node, 'std_tolerance', 0)})`]); break
    case 'ts_argmax': compiled = result(`Ts_ArgMax(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_argmax(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_argmin': compiled = result(`Ts_ArgMin(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_argmin(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_skew': compiled = result(`Ts_Skew(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_skew(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_kurt': compiled = result(`Ts_Kurt(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_kurt(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'ts_residual': compiled = result(`Ts_Residual(${expressionAt('series', 'MarketData')}, ${window})`, [...allLines(), `${variable} = rolling_residual(${inputAt('series', 'df')}, window=${windowArg}, by="asset", min_samples=${minSamplesArg})`]); break
    case 'cs_rank': compiled = result(`Cs_Rank(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = cross_sectional_rank(${inputAt('series', 'df')}, by="timestamp")`]); break
    case 'cs_zscore': compiled = result(`Cs_ZScore(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = cross_sectional_zscore(${inputAt('series', 'df')}, by="timestamp")`], variable); break
    case 'cs_mean': compiled = result(`Cs_Mean(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = cross_sectional_mean(${inputAt('series', 'df')}, by="timestamp")`]); break
    case 'cs_std': compiled = result(`Cs_Std(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = cross_sectional_std(${inputAt('series', 'df')}, by="timestamp")`]); break
    case 'cs_min': compiled = result(`Cs_Min(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = cross_sectional_min(${inputAt('series', 'df')}, by="timestamp")`]); break
    case 'cs_max': compiled = result(`Cs_Max(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = cross_sectional_max(${inputAt('series', 'df')}, by="timestamp")`]); break
    case 'cs_center': compiled = result(`Cs_Center(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = ${inputAt('series', 'df')} - cross_sectional_mean(${inputAt('series', 'df')}, by="timestamp")`]); break
    case 'cs_scale': compiled = result(`Cs_Scale(${expressionAt('series', 'MarketData')})`, [...allLines(), `${variable} = cross_sectional_scale(${inputAt('series', 'df')}, by="timestamp")`]); break
    case 'cs_neutralize': compiled = result(`Cs_Neutralize(${expressionAt('series', 'value')}, ${expressionAt('exposure', 'value')})`, [...allLines(), `${variable} = cross_sectional_neutralize(${inputAt('series', 'df')}, ${inputAt('exposure', 'df')}, by="timestamp")`]); break
    case 'factor_output': compiled = inputs.get('value') ?? { expression: 'factor_value', reference: 'factor_value', lines: [] }; break
    default:
      warnings.add(`${nodeLabel(node)}：尚未注册程序语义`)
      compiled = { expression: nodeLabel(node), lines: [`# WARNING: ${nodeLabel(node)} has no registered program meaning`] }
  }

  visiting.delete(node.id)
  cache.set(node.id, compiled)
  return compiled
}

export function compileGraphPython(nodes: GraphNode[], edges: GraphEdge[], settings: FactorSettings): string {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const output = nodes.find((node) => nodeBlockId(node) === 'factor_output' || node.data.kind === 'output')
  if (!output) {
    return `def compute_factor(df, window=${settings.window}, min_samples=${settings.minSamples}, descending=${settings.descending ? 'True' : 'False'}):\n    raise ValueError("未找到因子输出积木")`
  }
  const cache = new Map<string, CompiledNode>()
  const warnings = new Set<string>()
  const compiled = compilePythonNode(output, nodeMap, edges, settings, cache, new Set(), warnings)
  const warningLines = [...warnings].map((warning) => `    # WARNING: ${warning}`)
  const lines = [
    'import numpy as np',
    'import pandas as pd',
    '',
    `def compute_factor(df, window=${settings.window}, min_samples=${settings.minSamples}, descending=${settings.descending ? 'True' : 'False'}):`,
    PYTHON_RUNTIME_HELPERS,
    '',
    `    # Graph expression: ${compiled.expression}`,
    ...warningLines,
    ...compiled.lines.map((line) => `    ${line}`),
    `    return restore_output(${compiled.reference ?? compiled.expression})`,
  ]
  return lines.join('\n')
}

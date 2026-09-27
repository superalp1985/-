import { canonicalBlockId, getBlockDefinition, type BlockPort, type ParameterValue } from './blocks'
import type { GraphEdge, GraphNode } from './graph'
import type { FactorPoint, FactorRow, FactorSettings } from './factor'

type RuntimeValue = number | boolean | null
type RuntimeVector = RuntimeValue[]
type RuntimeData = RuntimeValue | RuntimeVector

export type GraphCalculationResult = {
  supported: boolean
  points: FactorPoint[]
  warnings: string[]
}

function nodeBlockId(node: GraphNode): string {
  return canonicalBlockId(node.data.blockId ?? node.id) ?? node.data.blockId ?? node.id
}

function nodeLabel(node: GraphNode): string {
  return node.data.title ?? getBlockDefinition(nodeBlockId(node))?.title ?? node.id
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

function numeric(value: RuntimeValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  return null
}

function truthy(value: RuntimeValue): boolean | null {
  if (value === null) return null
  return typeof value === 'boolean' ? value : value !== 0
}

function vector(value: RuntimeData, length: number): RuntimeVector {
  return Array.isArray(value) ? value : Array.from({ length }, () => value)
}

function unary(value: RuntimeData, length: number, operation: (value: RuntimeValue) => RuntimeValue): RuntimeData {
  if (!Array.isArray(value)) return operation(value)
  return value.map(operation)
}

function binary(
  left: RuntimeData,
  right: RuntimeData,
  length: number,
  operation: (left: RuntimeValue, right: RuntimeValue) => RuntimeValue,
): RuntimeData {
  if (!Array.isArray(left) && !Array.isArray(right)) return operation(left, right)
  const leftValues = vector(left, length)
  const rightValues = vector(right, length)
  return leftValues.map((value, index) => operation(value, rightValues[index]))
}

function applyNumericBinary(left: RuntimeValue, right: RuntimeValue, operation: (left: number, right: number) => number): RuntimeValue {
  const leftNumber = numeric(left)
  const rightNumber = numeric(right)
  if (leftNumber === null || rightNumber === null) return null
  const result = operation(leftNumber, rightNumber)
  return Number.isFinite(result) ? result : null
}

function compare(left: RuntimeValue, right: RuntimeValue, operation: (left: number, right: number) => boolean): RuntimeValue {
  const leftNumber = numeric(left)
  const rightNumber = numeric(right)
  return leftNumber === null || rightNumber === null ? null : operation(leftNumber, rightNumber)
}

function inputSourcesFor(
  node: GraphNode,
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  warnings: Set<string>,
  markUnsupported: () => void,
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
        markUnsupported()
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
  for (const port of definition.inputs) {
    if (port.required !== false && !sources.has(port.id)) {
      warnings.add(`${nodeLabel(node)}：缺少输入端口 ${port.label}`)
      markUnsupported()
    }
  }
  return sources
}

function groupedIndices(rows: FactorRow[], field: 'asset' | 'timestamp'): number[][] {
  const groups = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const indexes = groups.get(row[field]) ?? []
    indexes.push(index)
    groups.set(row[field], indexes)
  })
  const result = [...groups.values()]
  if (field === 'asset') {
    result.forEach((indexes) => indexes.sort((left, right) => rows[left].timestamp.localeCompare(rows[right].timestamp) || left - right))
  }
  return result
}

function rollingUnary(
  values: RuntimeData,
  rows: FactorRow[],
  window: number,
  minSamples: number,
  operation: (sample: number[]) => number | null,
  preservePositions = false,
): RuntimeVector {
  const input = vector(values, rows.length)
  const result: RuntimeVector = Array.from({ length: rows.length }, () => null)
  for (const indexes of groupedIndices(rows, 'asset')) {
    indexes.forEach((rowIndex, position) => {
      const windowIndexes = indexes.slice(Math.max(0, position - window + 1), position + 1)
      const windowValues = windowIndexes.map((index) => numeric(input[index]) ?? Number.NaN)
      const sample = windowValues.filter(Number.isFinite)
      if (sample.length >= minSamples) result[rowIndex] = operation(preservePositions ? windowValues : sample)
    })
  }
  return result
}

function rollingPair(
  left: RuntimeData,
  right: RuntimeData,
  rows: FactorRow[],
  window: number,
  minSamples: number,
  operation: (left: number[], right: number[]) => number | null,
): RuntimeVector {
  const leftValues = vector(left, rows.length)
  const rightValues = vector(right, rows.length)
  const result: RuntimeVector = Array.from({ length: rows.length }, () => null)
  for (const indexes of groupedIndices(rows, 'asset')) {
    indexes.forEach((rowIndex, position) => {
      const windowIndexes = indexes.slice(Math.max(0, position - window + 1), position + 1)
      const pairs = windowIndexes
        .map((index) => [numeric(leftValues[index]), numeric(rightValues[index])] as const)
        .filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null)
      if (pairs.length >= minSamples) result[rowIndex] = operation(pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1]))
    })
  }
  return result
}

function rollingRank(sample: number[], descending: boolean): number | null {
  if (!sample.length) return null
  const current = sample[sample.length - 1]
  const base = sample.filter((value) => descending ? value < current : value > current).length
  const equal = sample.filter((value) => value === current).length
  return (base + (equal + 1) / 2) / sample.length
}

function quantile(sample: number[], probability: number): number | null {
  if (!sample.length) return null
  const values = [...sample].sort((left, right) => left - right)
  const position = Math.max(0, Math.min(1, probability)) * (values.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return values[lower] + (values[upper] - values[lower]) * (position - lower)
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length < 2 || right.length !== left.length) return null
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  const covariance = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0)
  const leftVariance = left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0)
  const rightVariance = right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0)
  if (leftVariance === 0 || rightVariance === 0) return null
  return covariance / Math.sqrt(leftVariance * rightVariance)
}

function covariance(left: number[], right: number[]): number | null {
  if (!left.length || left.length !== right.length) return null
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
  return left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0) / left.length
}

function slope(sample: number[]): number | null {
  const valid = sample.map((value, index) => ({ value, index })).filter(({ value }) => Number.isFinite(value))
  if (valid.length < 2) return null
  const xMean = valid.reduce((sum, point) => sum + point.index, 0) / valid.length
  const yMean = valid.reduce((sum, point) => sum + point.value, 0) / valid.length
  const denominator = valid.reduce((sum, point) => sum + (point.index - xMean) ** 2, 0)
  if (denominator === 0) return null
  return valid.reduce((sum, point) => sum + (point.index - xMean) * (point.value - yMean), 0) / denominator
}

function extremePosition(sample: number[], maximum: boolean): number {
  // Qlib uses raw NumPy argmax/argmin: first tie (or first NaN), then one-based.
  const missing = sample.findIndex(Number.isNaN)
  if (missing !== -1) return missing + 1
  return sample.indexOf(maximum ? Math.max(...sample) : Math.min(...sample)) + 1
}

function rsquare(sample: number[]): number | null {
  if (sample.length < 2) return null
  const correlationValue = correlation(sample.map((_, index) => index), sample)
  return correlationValue === null ? null : correlationValue ** 2
}

function skew(sample: number[]): number | null {
  if (sample.length < 3) return null
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length
  const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sample.length - 1)
  if (variance === 0) return null
  const third = sample.reduce((sum, value) => sum + (value - mean) ** 3, 0) / sample.length
  return (sample.length / ((sample.length - 1) * (sample.length - 2))) * third / Math.pow(variance, 1.5)
}

function kurtosis(sample: number[]): number | null {
  if (sample.length < 4) return null
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length
  const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sample.length - 1)
  if (variance === 0) return null
  const fourth = sample.reduce((sum, value) => sum + (value - mean) ** 4, 0) / sample.length
  const n = sample.length
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * fourth / (variance ** 2) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
}

function residual(sample: number[]): number | null {
  const current = sample.at(-1)
  const trend = slope(sample)
  if (current === undefined || trend === null) return null
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length
  const xMean = (sample.length - 1) / 2
  const intercept = mean - trend * xMean
  return current - (trend * (sample.length - 1) + intercept)
}

function crossSection(values: RuntimeData, rows: FactorRow[], operation: (sample: number[], indexes: number[]) => Map<number, number | null>): RuntimeVector {
  const input = vector(values, rows.length)
  const result: RuntimeVector = Array.from({ length: rows.length }, () => null)
  for (const indexes of groupedIndices(rows, 'timestamp')) {
    const sample = indexes.map((index) => numeric(input[index]))
    const computed = operation(sample.filter((value): value is number => value !== null), indexes)
    indexes.forEach((index) => {
      result[index] = computed.get(index) ?? null
    })
  }
  return result
}

function crossSectionRank(values: RuntimeData, rows: FactorRow[]): RuntimeVector {
  const input = vector(values, rows.length)
  const result: RuntimeVector = Array.from({ length: rows.length }, () => null)
  for (const indexes of groupedIndices(rows, 'timestamp')) {
    const valid = indexes.filter((index) => numeric(input[index]) !== null)
    valid.forEach((index) => {
      const current = numeric(input[index])!
      const less = valid.filter((other) => numeric(input[other])! < current).length
      const equal = valid.filter((other) => numeric(input[other])! === current).length
      result[index] = (less + (equal + 1) / 2) / valid.length
    })
  }
  return result
}

function crossSectionZScore(values: RuntimeData, rows: FactorRow[]): RuntimeVector {
  const input = vector(values, rows.length)
  const result: RuntimeVector = Array.from({ length: rows.length }, () => null)
  for (const indexes of groupedIndices(rows, 'timestamp')) {
    const valid = indexes.map((index) => numeric(input[index])).filter((value): value is number => value !== null)
    if (!valid.length) continue
    const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length
    const standardDeviation = Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length)
    if (standardDeviation === 0) continue
    indexes.forEach((index) => {
      const value = numeric(input[index])
      result[index] = value === null ? null : (value - mean) / standardDeviation
    })
  }
  return result
}

function crossSectionSimple(values: RuntimeData, rows: FactorRow[], operation: (values: number[]) => number | null): RuntimeVector {
  const input = vector(values, rows.length)
  return crossSection(values, rows, (sample, indexes) => {
    const computed = operation(sample)
    return new Map(indexes.map((index) => [index, computed]))
  }).map((value, index) => numeric(input[index]) === null ? null : value)
}

function crossSectionNeutralize(series: RuntimeData, exposure: RuntimeData, rows: FactorRow[]): RuntimeVector {
  const values = vector(series, rows.length)
  const exposures = vector(exposure, rows.length)
  const result: RuntimeVector = Array.from({ length: rows.length }, () => null)
  for (const indexes of groupedIndices(rows, 'timestamp')) {
    const valid = indexes.filter((index) => numeric(values[index]) !== null && numeric(exposures[index]) !== null)
    const x = valid.map((index) => numeric(exposures[index])!)
    const y = valid.map((index) => numeric(values[index])!)
    const xMean = x.length ? x.reduce((sum, value) => sum + value, 0) / x.length : 0
    const yMean = y.length ? y.reduce((sum, value) => sum + value, 0) / y.length : 0
    const denominator = x.reduce((sum, value) => sum + (value - xMean) ** 2, 0)
    if (valid.length < 2 || denominator === 0) continue
    const beta = x.reduce((sum, value, index) => sum + (value - xMean) * (y[index] - yMean), 0) / denominator
    const alpha = yMean - beta * xMean
    valid.forEach((index) => {
      result[index] = numeric(values[index])! - (alpha + beta * numeric(exposures[index])!)
    })
  }
  return result
}

type FormulaToken = { kind: 'number' | 'identifier' | 'operator' | 'punctuation' | 'eof'; value: string }
type FormulaAst =
  | { kind: 'number'; value: number }
  | { kind: 'identifier'; value: string }
  | { kind: 'call'; name: string; args: FormulaAst[] }
  | { kind: 'binary'; operator: string; left: FormulaAst; right: FormulaAst }
  | { kind: 'unary'; operator: string; value: FormulaAst }

function tokenizeFormula(expression: string): FormulaToken[] {
  const tokens: FormulaToken[] = []
  let index = 0
  while (index < expression.length) {
    const rest = expression.slice(index)
    const whitespace = rest.match(/^\s+/)
    if (whitespace) {
      index += whitespace[0].length
      continue
    }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
    if (number) {
      tokens.push({ kind: 'number', value: number[0] })
      index += number[0].length
      continue
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/)
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier[0] })
      index += identifier[0].length
      continue
    }
    const operator = rest.match(/^(?:\*\*|>=|<=|==|!=|&&|\|\||[+\-*/%^><!])/)
    if (operator) {
      tokens.push({ kind: 'operator', value: operator[0] })
      index += operator[0].length
      continue
    }
    if ('(),'.includes(rest[0])) {
      tokens.push({ kind: 'punctuation', value: rest[0] })
      index += 1
      continue
    }
    throw new Error(`无法识别表达式字符：${rest[0]}`)
  }
  tokens.push({ kind: 'eof', value: '' })
  return tokens
}

class FormulaParser {
  private index = 0

  constructor(private readonly tokens: FormulaToken[]) {}

  parse(): FormulaAst {
    const result = this.parseExpression(0)
    if (this.peek().kind !== 'eof') throw new Error(`表达式末尾存在无法解析内容：${this.peek().value}`)
    return result
  }

  private peek(): FormulaToken { return this.tokens[this.index] }
  private take(): FormulaToken {
    const token = this.tokens[this.index]
    this.index += 1
    return token
  }

  private parseExpression(minPrecedence: number): FormulaAst {
    let left = this.parsePrefix()
    const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 3, '<': 3, '>=': 3, '<=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '%': 5, '**': 6, '^': 6 }
    while (this.peek().kind === 'operator' && (precedence[this.peek().value] ?? -1) >= minPrecedence) {
      const operator = this.take().value
      const currentPrecedence = precedence[operator]
      const right = this.parseExpression(operator === '**' || operator === '^' ? currentPrecedence : currentPrecedence + 1)
      left = { kind: 'binary', operator, left, right }
    }
    return left
  }

  private parsePrefix(): FormulaAst {
    const token = this.take()
    if (token.kind === 'number') return { kind: 'number', value: Number(token.value) }
    if (token.kind === 'operator' && ['+', '-', '!'].includes(token.value)) return { kind: 'unary', operator: token.value, value: this.parsePrefix() }
    if (token.kind === 'punctuation' && token.value === '(') {
      const expression = this.parseExpression(0)
      if (this.take().value !== ')') throw new Error('表达式缺少右括号')
      return expression
    }
    if (token.kind === 'identifier') {
      if (this.peek().value !== '(') return { kind: 'identifier', value: token.value }
      this.take()
      const args: FormulaAst[] = []
      if (this.peek().value !== ')') {
        while (true) {
          args.push(this.parseExpression(0))
          if (this.peek().value !== ',') break
          this.take()
        }
      }
      if (this.take().value !== ')') throw new Error(`${token.value} 缺少右括号`)
      return { kind: 'call', name: token.value, args }
    }
    throw new Error(`表达式起始位置无效：${token.value}`)
  }
}

function evaluateFormula(ast: FormulaAst, x: RuntimeValue): RuntimeValue {
  if (ast.kind === 'number') return ast.value
  if (ast.kind === 'identifier') {
    const normalized = ast.value.toLowerCase()
    if (normalized === 'x') return x
    if (normalized === 'pi' || normalized === 'math.pi' || normalized === 'np.pi') return Math.PI
    if (normalized === 'e' || normalized === 'math.e' || normalized === 'np.e') return Math.E
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    throw new Error(`公式中存在未定义变量：${ast.value}`)
  }
  if (ast.kind === 'unary') {
    const value = evaluateFormula(ast.value, x)
    if (ast.operator === '!') {
      const result = truthy(value)
      return result === null ? null : !result
    }
    if (ast.operator === '+') return numeric(value)
    const number = numeric(value)
    return number === null ? null : -number
  }
  if (ast.kind === 'binary') {
    const left = evaluateFormula(ast.left, x)
    const right = evaluateFormula(ast.right, x)
    if (ast.operator === '&&' || ast.operator === '||') {
      const leftTruth = truthy(left)
      const rightTruth = truthy(right)
      if (leftTruth === null || rightTruth === null) return null
      return ast.operator === '&&' ? leftTruth && rightTruth : leftTruth || rightTruth
    }
    if (['==', '!=', '>', '<', '>=', '<='].includes(ast.operator)) {
      const leftNumber = numeric(left)
      const rightNumber = numeric(right)
      if (leftNumber === null || rightNumber === null) return null
      if (ast.operator === '==') return leftNumber === rightNumber
      if (ast.operator === '!=') return leftNumber !== rightNumber
      if (ast.operator === '>') return leftNumber > rightNumber
      if (ast.operator === '<') return leftNumber < rightNumber
      if (ast.operator === '>=') return leftNumber >= rightNumber
      return leftNumber <= rightNumber
    }
    const leftNumber = numeric(left)
    const rightNumber = numeric(right)
    if (leftNumber === null || rightNumber === null) return null
    if (ast.operator === '+') return applyNumericBinary(leftNumber, rightNumber, (a, b) => a + b)
    if (ast.operator === '-') return applyNumericBinary(leftNumber, rightNumber, (a, b) => a - b)
    if (ast.operator === '*') return applyNumericBinary(leftNumber, rightNumber, (a, b) => a * b)
    if (ast.operator === '/') return rightNumber === 0 ? null : applyNumericBinary(leftNumber, rightNumber, (a, b) => a / b)
    if (ast.operator === '%') return rightNumber === 0 ? null : applyNumericBinary(leftNumber, rightNumber, (a, b) => a % b)
    return applyNumericBinary(leftNumber, rightNumber, (a, b) => a ** b)
  }

  const name = ast.name.toLowerCase().replace(/^(np|math)\./, '')
  const args = ast.args.map((arg) => evaluateFormula(arg, x))
  const first = numeric(args[0] ?? null)
  if (name === 'isnan') return first === null
  if (first === null && !['where'].includes(name)) return null
  if (name === 'abs') return Math.abs(first!)
  if (name === 'log' || name === 'ln') return first! > 0 ? Math.log(first!) : null
  if (name === 'log1p') return first! > -1 ? Math.log1p(first!) : null
  if (name === 'exp') return Number.isFinite(Math.exp(first!)) ? Math.exp(first!) : null
  if (name === 'sqrt') return first! >= 0 ? Math.sqrt(first!) : null
  if (name === 'sign') return Math.sign(first!)
  if (name === 'max' || name === 'maximum') {
    const values = args.map(numeric).filter((value): value is number => value !== null)
    return values.length === args.length ? Math.max(...values) : null
  }
  if (name === 'min' || name === 'minimum') {
    const values = args.map(numeric).filter((value): value is number => value !== null)
    return values.length === args.length ? Math.min(...values) : null
  }
  if (name === 'pow') {
    const exponent = numeric(args[1] ?? null)
    return exponent === null ? null : (Number.isFinite(first! ** exponent) ? first! ** exponent : null)
  }
  if (name === 'clip') {
    const low = numeric(args[1] ?? null)
    const high = numeric(args[2] ?? null)
    return low === null || high === null ? null : Math.min(high, Math.max(low, first!))
  }
  if (name === 'where' || name === 'ifelse') {
    const condition = truthy(args[0] ?? null)
    return condition === null ? null : condition ? (args[1] ?? null) : (args[2] ?? null)
  }
  throw new Error(`公式中不支持函数：${ast.name}`)
}

function evaluateCustomFormula(expression: string, input: RuntimeData, length: number): RuntimeVector {
  const ast = new FormulaParser(tokenizeFormula(expression)).parse()
  return vector(input, length).map((value) => evaluateFormula(ast, value))
}

function fieldValues(rows: FactorRow[], field: 'open' | 'high' | 'low' | 'close' | 'volume' | 'amount' | 'vwap'): RuntimeVector {
  return rows.map((row) => {
    const value = row[field]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  })
}

function minMax(values: number[], mode: 'min' | 'max'): number | null {
  return values.length ? (mode === 'min' ? Math.min(...values) : Math.max(...values)) : null
}

export function calculateGraphFactor(
  rows: FactorRow[],
  edges: GraphEdge[],
  nodes: GraphNode[],
  settings: FactorSettings,
): GraphCalculationResult {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const cache = new Map<string, RuntimeData>()
  const warnings = new Set<string>()
  const visiting = new Set<string>()
  let supported = true
  const markUnsupported = () => { supported = false }

  const evaluate = (node: GraphNode): RuntimeData => {
    const cached = cache.get(node.id)
    if (cached !== undefined) return cached
    if (visiting.has(node.id)) {
      warnings.add(`${nodeLabel(node)}：检测到循环连线`)
      markUnsupported()
      return Array.from({ length: rows.length }, () => null)
    }
    visiting.add(node.id)
    const sources = inputSourcesFor(node, nodeMap, edges, warnings, markUnsupported)
    const inputs = new Map<string, RuntimeData>()
    for (const [portId, source] of sources) inputs.set(portId, evaluate(source))
    const inputAt = (portId: string, fallback: RuntimeData = Array.from({ length: rows.length }, () => null)) => inputs.get(portId) ?? fallback
    const blockId = nodeBlockId(node)
    const window = Math.max(2, Math.round(numberParameter(node, 'window', settings.window)))
    const minSamples = Math.max(1, Math.min(window, Math.round(numberParameter(node, 'min_samples', settings.minSamples))))
    const descending = booleanParameter(node, 'descending', settings.descending)
    let value: RuntimeData

    switch (blockId) {
      case 'market_data': value = Array.from({ length: rows.length }, () => null); break
      case 'field_open': value = fieldValues(rows, 'open'); break
      case 'field_high': value = fieldValues(rows, 'high'); break
      case 'field_low': value = fieldValues(rows, 'low'); break
      case 'field_close': value = fieldValues(rows, 'close'); break
      case 'field_volume': value = fieldValues(rows, 'volume'); break
      case 'field_amount': value = fieldValues(rows, 'amount'); break
      case 'field_vwap': value = fieldValues(rows, 'vwap'); break
      case 'constant': value = numberParameter(node, 'value', 1); break
      case 'close_open_ratio': value = rows.map((row) => row.open !== null && row.open !== 0 && row.close !== null ? row.close / row.open : null); break
      case 'add': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => applyNumericBinary(left, right, (a, b) => a + b)); break
      case 'subtract': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => applyNumericBinary(left, right, (a, b) => a - b)); break
      case 'multiply': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => applyNumericBinary(left, right, (a, b) => a * b)); break
      case 'divide': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => numeric(right) === 0 ? null : applyNumericBinary(left, right, (a, b) => a / b)); break
      case 'power': value = binary(inputAt('left'), inputAt('right', numberParameter(node, 'exponent', 2)), rows.length, (left, right) => applyNumericBinary(left, right, (a, b) => a ** b)); break
      case 'abs': value = unary(inputAt('series'), rows.length, (item) => numeric(item) === null ? null : Math.abs(numeric(item)!)); break
      case 'negate': value = unary(inputAt('series'), rows.length, (item) => numeric(item) === null ? null : -numeric(item)!); break
      case 'log': value = unary(inputAt('series'), rows.length, (item) => numeric(item) !== null && numeric(item)! > 0 ? Math.log(numeric(item)!) : null); break
      case 'exp': value = unary(inputAt('series'), rows.length, (item) => numeric(item) !== null && Number.isFinite(Math.exp(numeric(item)!)) ? Math.exp(numeric(item)!) : null); break
      case 'sqrt': value = unary(inputAt('series'), rows.length, (item) => numeric(item) !== null && numeric(item)! >= 0 ? Math.sqrt(numeric(item)!) : null); break
      case 'sign': value = unary(inputAt('series'), rows.length, (item) => numeric(item) === null ? null : Math.sign(numeric(item)!)); break
      case 'maximum': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => applyNumericBinary(left, right, Math.max)); break
      case 'minimum': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => applyNumericBinary(left, right, Math.min)); break
      case 'clip': {
        const low = inputAt('low', numberParameter(node, 'low', -1))
        const high = inputAt('high', numberParameter(node, 'high', 1))
        value = binary(binary(inputAt('series'), low, rows.length, (item, bound) => applyNumericBinary(item, bound, Math.max)), high, rows.length, (item, bound) => applyNumericBinary(item, bound, Math.min))
        break
      }
      case 'greater': value = binary(inputAt('left'), inputAt('right', numberParameter(node, 'threshold', 0)), rows.length, (left, right) => compare(left, right, (a, b) => a > b)); break
      case 'less': value = binary(inputAt('left'), inputAt('right', numberParameter(node, 'threshold', 0)), rows.length, (left, right) => compare(left, right, (a, b) => a < b)); break
      case 'equal': value = binary(inputAt('left'), inputAt('right', numberParameter(node, 'threshold', 0)), rows.length, (left, right) => compare(left, right, (a, b) => a === b)); break
      case 'and': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => { const a = truthy(left); const b = truthy(right); return a === null || b === null ? null : a && b }); break
      case 'or': value = binary(inputAt('left'), inputAt('right'), rows.length, (left, right) => { const a = truthy(left); const b = truthy(right); return a === null || b === null ? null : a || b }); break
      case 'not': value = unary(inputAt('condition'), rows.length, (item) => { const result = truthy(item); return result === null ? null : !result }); break
      case 'where': {
        const conditions = vector(inputAt('condition'), rows.length)
        const whenTrue = vector(inputAt('when_true'), rows.length)
        const whenFalse = vector(inputAt('when_false'), rows.length)
        value = conditions.map((condition, index) => {
          const result = truthy(condition)
          return result === null ? null : result ? whenTrue[index] : whenFalse[index]
        })
        break
      }
      case 'fill_missing': value = binary(inputAt('series'), inputAt('value', numberParameter(node, 'value', 0)), rows.length, (item, replacement) => item ?? replacement); break
      case 'custom_formula': {
        const expression = node.data.customExpression?.trim()
        if (!expression) {
          warnings.add(`${nodeLabel(node)}：自定义公式为空`)
          markUnsupported()
          value = Array.from({ length: rows.length }, () => null)
          break
        }
        try {
          value = evaluateCustomFormula(expression, inputAt('series'), rows.length)
        } catch (error) {
          warnings.add(`${nodeLabel(node)}：自定义公式无法执行（${error instanceof Error ? error.message : '未知错误'}）`)
          markUnsupported()
          value = Array.from({ length: rows.length }, () => null)
        }
        break
      }
      case 'ts_ref': {
        const input = vector(inputAt('series'), rows.length)
        value = Array.from({ length: rows.length }, () => null)
        const lag = Math.max(1, Math.round(numberParameter(node, 'lag', 1)))
        for (const indexes of groupedIndices(rows, 'asset')) indexes.forEach((index, position) => { if (position >= lag) (value as RuntimeVector)[index] = input[indexes[position - lag]] })
        break
      }
      case 'ts_delta': {
        const input = vector(inputAt('series'), rows.length)
        const lag = Math.max(1, Math.round(numberParameter(node, 'lag', 1)))
        value = Array.from({ length: rows.length }, () => null)
        for (const indexes of groupedIndices(rows, 'asset')) indexes.forEach((index, position) => { if (position >= lag) (value as RuntimeVector)[index] = applyNumericBinary(input[index], input[indexes[position - lag]], (a, b) => a - b) })
        break
      }
      case 'ts_pct_change': {
        const input = vector(inputAt('series'), rows.length)
        const lag = Math.max(1, Math.round(numberParameter(node, 'lag', 1)))
        value = Array.from({ length: rows.length }, () => null)
        for (const indexes of groupedIndices(rows, 'asset')) indexes.forEach((index, position) => { if (position >= lag) { const previous = numeric(input[indexes[position - lag]]); (value as RuntimeVector)[index] = previous === null || previous === 0 ? null : applyNumericBinary(input[index], previous, (a, b) => a / b - 1) } })
        break
      }
      case 'ts_mean': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => sample.reduce((sum, item) => sum + item, 0) / sample.length); break
      case 'ts_sum': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => sample.reduce((sum, item) => sum + item, 0)); break
      case 'ts_std': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => { if (sample.length < 2) return null; const mean = sample.reduce((sum, item) => sum + item, 0) / sample.length; return Math.sqrt(sample.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (sample.length - 1)) }); break
      case 'ts_min': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => minMax(sample, 'min')); break
      case 'ts_max': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => minMax(sample, 'max')); break
      case 'ts_rank': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => rollingRank(sample, descending)); break
      case 'ts_quantile': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => quantile(sample, numberParameter(node, 'quantile', 0.8))); break
      case 'ts_corr': value = rollingPair(inputAt('left'), inputAt('right'), rows, window, minSamples, correlation); break
      case 'ts_cov': value = rollingPair(inputAt('left'), inputAt('right'), rows, window, minSamples, covariance); break
      case 'ts_slope': value = rollingUnary(inputAt('series'), rows, window, minSamples, slope, true); break
      case 'ts_rsquare': value = rollingUnary(inputAt('series'), rows, window, minSamples, rsquare); break
      case 'ts_argmax': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => extremePosition(sample, true), true); break
      case 'ts_argmin': value = rollingUnary(inputAt('series'), rows, window, minSamples, (sample) => extremePosition(sample, false), true); break
      case 'ts_skew': value = rollingUnary(inputAt('series'), rows, window, minSamples, skew); break
      case 'ts_kurt': value = rollingUnary(inputAt('series'), rows, window, minSamples, kurtosis); break
      case 'ts_residual': value = rollingUnary(inputAt('series'), rows, window, minSamples, residual); break
      case 'cs_rank': value = crossSectionRank(inputAt('series'), rows); break
      case 'cs_zscore': value = crossSectionZScore(inputAt('series'), rows); break
      case 'cs_mean': value = crossSectionSimple(inputAt('series'), rows, (sample) => sample.reduce((sum, item) => sum + item, 0) / sample.length); break
      case 'cs_std': value = crossSectionSimple(inputAt('series'), rows, (sample) => { const mean = sample.reduce((sum, item) => sum + item, 0) / sample.length; return Math.sqrt(sample.reduce((sum, item) => sum + (item - mean) ** 2, 0) / sample.length) }); break
      case 'cs_min': value = crossSectionSimple(inputAt('series'), rows, (sample) => minMax(sample, 'min')); break
      case 'cs_max': value = crossSectionSimple(inputAt('series'), rows, (sample) => minMax(sample, 'max')); break
      case 'cs_center': value = binary(inputAt('series'), crossSectionSimple(inputAt('series'), rows, (sample) => sample.reduce((sum, item) => sum + item, 0) / sample.length), rows.length, (left, right) => applyNumericBinary(left, right, (a, b) => a - b)); break
      case 'cs_scale': {
        const input = vector(inputAt('series'), rows.length)
        value = crossSection(input, rows, (sample, indexes) => {
          const denominator = sample.reduce((sum, item) => sum + Math.abs(item), 0)
          return new Map(indexes.map((index) => {
            const item = numeric(input[index])
            return [index, denominator === 0 || item === null ? null : item / denominator]
          }))
        })
        break
      }
      case 'cs_neutralize': value = crossSectionNeutralize(inputAt('series'), inputAt('exposure'), rows); break
      case 'factor_output': value = inputAt('value'); break
      default:
        warnings.add(`${nodeLabel(node)}：尚未注册本地执行语义`)
        markUnsupported()
        value = Array.from({ length: rows.length }, () => null)
    }

    visiting.delete(node.id)
    cache.set(node.id, value)
    return value
  }

  const output = nodes.find((node) => nodeBlockId(node) === 'factor_output' || node.data.kind === 'output')
  if (!output) {
    return { supported: false, points: [], warnings: ['未找到因子输出积木'] }
  }
  const outputValues = vector(evaluate(output), rows.length)
  const ratioNode = nodes.find((node) => nodeBlockId(node) === 'close_open_ratio')
  const rankNode = nodes.find((node) => nodeBlockId(node) === 'ts_rank')
  const ratioValues = ratioNode ? vector(evaluate(ratioNode), rows.length) : Array.from({ length: rows.length }, () => null)
  const rankValues = rankNode ? vector(evaluate(rankNode), rows.length) : Array.from({ length: rows.length }, () => null)
  const points = rows.map((row, index) => ({
    ...row,
    ratio: numeric(ratioValues[index]),
    tsRank: numeric(rankValues[index]),
    factor: numeric(outputValues[index]),
  }))
  return { supported, points, warnings: [...warnings] }
}

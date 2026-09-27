import type { Edge } from '@xyflow/react'
import type { ProjectNode } from './project'
import { defaultBlockParameters, getBlockDefinition, type ParameterValue } from './blocks'

export const factorSources = {
  qlib: 'Qlib',
} as const

export type FactorSource = typeof factorSources[keyof typeof factorSources]

export type FactorDefinition = {
  id: string
  name: string
  family: string
  source: FactorSource
  expression: string
  description: string
  verification: 'source-transcribed' | 'source-transformed'
}

const qlibFactor = (
  family: string,
  name: string,
  expression: string,
  description: string,
): FactorDefinition => ({
  id: `qlib-${family.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${name.toLowerCase()}`,
  name,
  family: family === 'alpha158' ? 'Qlib Alpha158' : 'Qlib Alpha360',
  source: factorSources.qlib,
  expression,
  description,
  verification: 'source-transcribed',
})

const alpha158Kline: Array<[string, string, string]> = [
  ['KMID', '($close-$open)/$open', '实体长度相对开盘价。'],
  ['KLEN', '($high-$low)/$open', '最高价到最低价的振幅相对开盘价。'],
  ['KMID2', '($close-$open)/($high-$low+1e-12)', '实体长度占整根 K 线振幅的比例。'],
  ['KUP', '($high-Greater($open,$close))/$open', '上影线相对开盘价。'],
  ['KUP2', '($high-Greater($open,$close))/($high-$low+1e-12)', '上影线占整根 K 线振幅的比例。'],
  ['KLOW', '(Less($open,$close)-$low)/$open', '下影线相对开盘价。'],
  ['KLOW2', '(Less($open,$close)-$low)/($high-$low+1e-12)', '下影线占整根 K 线振幅的比例。'],
  ['KSFT', '(2*$close-$high-$low)/$open', '收盘价相对当日高低点中点的位置。'],
  ['KSFT2', '(2*$close-$high-$low)/($high-$low+1e-12)', '收盘位置在当日振幅中的标准化结果。'],
]

const alpha158Price: Array<[string, string, string]> = [
  ['OPEN', '$open/$close', '开盘价相对当前收盘价。'],
  ['HIGH', '$high/$close', '最高价相对当前收盘价。'],
  ['LOW', '$low/$close', '最低价相对当前收盘价。'],
  ['VWAP', '$vwap/$close', '成交量加权平均价相对当前收盘价。'],
]

const rollingFeatures: Array<[string, (window: number) => string, string]> = [
  ['ROC', (window) => `Ref($close,${window})/$close`, '历史收盘价相对当前收盘价。'],
  ['MA', (window) => `Mean($close,${window})/$close`, '历史收盘均值相对当前收盘价。'],
  ['STD', (window) => `Std($close,${window})/$close`, '历史收盘波动相对当前收盘价。'],
  ['BETA', (window) => `Slope($close,${window})/$close`, '历史收盘线性趋势斜率相对当前收盘价。'],
  ['RSQR', (window) => `Rsquare($close,${window})`, '历史收盘线性趋势拟合度。'],
  ['RESI', (window) => `Resi($close,${window})/$close`, '历史趋势残差相对当前收盘价。'],
  ['MAX', (window) => `Max($high,${window})/$close`, '历史窗口最高价相对当前收盘价。'],
  ['MIN', (window) => `Min($low,${window})/$close`, '历史窗口最低价相对当前收盘价。'],
  ['QTLU', (window) => `Quantile($close,${window},0.8)/$close`, '历史收盘 80% 分位数相对当前值。'],
  ['QTLD', (window) => `Quantile($close,${window},0.2)/$close`, '历史收盘 20% 分位数相对当前值。'],
  ['RANK', (window) => `Rank($close,${window})`, '当前收盘在历史窗口中的百分位。'],
  ['RSV', (window) => `($close-Min($low,${window}))/(Max($high,${window})-Min($low,${window})+1e-12)`, '当前收盘在历史高低区间中的位置。'],
  ['IMAX', (window) => `IdxMax($high,${window})/${window}`, '最高价首次出现的位置除以窗口长度，位置从最老观测起按 1 编号。'],
  ['IMIN', (window) => `IdxMin($low,${window})/${window}`, '最低价首次出现的位置除以窗口长度，位置从最老观测起按 1 编号。'],
  ['IMXD', (window) => `(IdxMax($high,${window})-IdxMin($low,${window}))/${window}`, '高点位置减低点位置再除以窗口长度；正值表示高点晚于低点。'],
  ['CORR', (window) => `Corr($close,Log($volume+1),${window})`, '收盘价与对数成交量的历史相关性。'],
  ['CORD', (window) => `Corr($close/Ref($close,1),Log($volume/Ref($volume,1)+1),${window})`, '价格变化率与对数成交量变化率的历史相关性。'],
  ['CNTP', (window) => `Mean($close>Ref($close,1),${window})`, '窗口内上涨观测的占比。'],
  ['CNTN', (window) => `Mean($close<Ref($close,1),${window})`, '窗口内下跌观测的占比。'],
  ['CNTD', (window) => `Mean($close>Ref($close,1),${window})-Mean($close<Ref($close,1),${window})`, '上涨占比减下跌占比。'],
  ['SUMP', (window) => `Sum(Greater($close-Ref($close,1),0),${window})/(Sum(Abs($close-Ref($close,1)),${window})+1e-12)`, '正向价格变化在绝对变化中的占比。'],
  ['SUMN', (window) => `Sum(Greater(Ref($close,1)-$close,0),${window})/(Sum(Abs($close-Ref($close,1)),${window})+1e-12)`, '负向价格变化在绝对变化中的占比。'],
  ['SUMD', (window) => `(Sum(Greater($close-Ref($close,1),0),${window})-Sum(Greater(Ref($close,1)-$close,0),${window}))/(Sum(Abs($close-Ref($close,1)),${window})+1e-12)`, '正负价格变化总量之差相对绝对变化总量。'],
  ['VMA', (window) => `Mean($volume,${window})/($volume+1e-12)`, '历史平均成交量相对当前成交量。'],
  ['VSTD', (window) => `Std($volume,${window})/($volume+1e-12)`, '历史成交量波动相对当前成交量。'],
  ['WVMA', (window) => `Std(Abs($close/Ref($close,1)-1)*$volume,${window})/(Mean(Abs($close/Ref($close,1)-1)*$volume,${window})+1e-12)`, '成交量加权价格变化波动相对均值。'],
  ['VSUMP', (window) => `Sum(Greater($volume-Ref($volume,1),0),${window})/(Sum(Abs($volume-Ref($volume,1)),${window})+1e-12)`, '成交量上升观测在绝对变化中的占比。'],
  ['VSUMN', (window) => `Sum(Greater(Ref($volume,1)-$volume,0),${window})/(Sum(Abs($volume-Ref($volume,1)),${window})+1e-12)`, '成交量下降观测在绝对变化中的占比。'],
  ['VSUMD', (window) => `(Sum(Greater($volume-Ref($volume,1),0),${window})-Sum(Greater(Ref($volume,1)-$volume,0),${window}))/(Sum(Abs($volume-Ref($volume,1)),${window})+1e-12)`, '成交量正负变化总量之差相对绝对变化总量。'],
]

export const alpha158Factors: FactorDefinition[] = [
  ...alpha158Kline.map(([name, expression, description]) => qlibFactor('alpha158', name, expression, description)),
  ...alpha158Price.map(([name, expression, description]) => ({
    ...qlibFactor('alpha158', name, expression, `${description} 对应 Qlib 官方字段名 ${name}0，工坊保留简称。`),
    verification: 'source-transformed' as const,
  })),
  ...rollingFeatures.flatMap(([name, expression, description]) => [5, 10, 20, 30, 60].map((window) => qlibFactor(
    'alpha158',
    `${name}${window}`,
    expression(window),
    `${description} 窗口 ${window}。`,
  ))),
]

export const alpha360Factors: FactorDefinition[] = [
  ...(['CLOSE', 'OPEN', 'HIGH', 'LOW', 'VWAP', 'VOLUME'] as const).flatMap((name) => {
    const field = `$${name.toLowerCase()}`
    return Array.from({ length: 60 }, (_, index) => 59 - index).map((lag) => qlibFactor(
      'alpha360',
      `${name}${lag}`,
      name === 'VOLUME'
        ? (lag === 0 ? `${field}/(${field}+1e-12)` : `Ref(${field},${lag})/(${field}+1e-12)`)
        : (lag === 0 ? `${field}/$close` : `Ref(${field},${lag})/$close`),
      `${name} 的历史第 ${lag} 个观测。`,
    ))
  }),
]

type Token = { kind: 'field' | 'identifier' | 'number' | 'operator' | 'punctuation' | 'eof'; value: string }

type AstNode =
  | { kind: 'field'; name: string }
  | { kind: 'number'; value: number }
  | { kind: 'call'; name: string; args: AstNode[] }
  | { kind: 'binary'; operator: string; left: AstNode; right: AstNode }
  | { kind: 'unary'; operator: string; value: AstNode }

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < expression.length) {
    const rest = expression.slice(index)
    const whitespace = rest.match(/^\s+/)
    if (whitespace) {
      index += whitespace[0].length
      continue
    }
    const field = rest.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)
    if (field) {
      tokens.push({ kind: 'field', value: field[0] })
      index += field[0].length
      continue
    }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
    if (number) {
      tokens.push({ kind: 'number', value: number[0] })
      index += number[0].length
      continue
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier[0] })
      index += identifier[0].length
      continue
    }
    const operator = rest.match(/^(?:<=|>=|==|!=|[+\-*/<>])/)
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

class ExpressionParser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): AstNode {
    const result = this.parseExpression(0)
    if (this.peek().kind !== 'eof') throw new Error(`表达式末尾存在无法解析内容：${this.peek().value}`)
    return result
  }

  private peek(): Token {
    return this.tokens[this.index]
  }

  private take(): Token {
    const token = this.tokens[this.index]
    this.index += 1
    return token
  }

  private parseExpression(minPrecedence: number): AstNode {
    let left = this.parsePrefix()
    const precedence: Record<string, number> = { '==': 1, '!=': 1, '>': 1, '<': 1, '>=': 1, '<=': 1, '+': 2, '-': 2, '*': 3, '/': 3 }
    while (this.peek().kind === 'operator' && (precedence[this.peek().value] ?? -1) >= minPrecedence) {
      const operator = this.take().value
      const right = this.parseExpression((precedence[operator] ?? 0) + 1)
      left = { kind: 'binary', operator, left, right }
    }
    return left
  }

  private parsePrefix(): AstNode {
    const token = this.take()
    if (token.kind === 'number') return { kind: 'number', value: Number(token.value) }
    if (token.kind === 'field') return { kind: 'field', name: token.value.slice(1).toLowerCase() }
    if (token.kind === 'operator' && token.value === '-') return { kind: 'unary', operator: '-', value: this.parsePrefix() }
    if (token.kind === 'punctuation' && token.value === '(') {
      const expression = this.parseExpression(0)
      if (this.take().value !== ')') throw new Error('表达式缺少右括号')
      return expression
    }
    if (token.kind === 'identifier') {
      if (this.take().value !== '(') throw new Error(`只支持函数调用：${token.value}`)
      const args: AstNode[] = []
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

function fieldBlockId(name: string): string {
  return name === 'open' || name === 'high' || name === 'low' || name === 'close' || name === 'volume' || name === 'amount' || name === 'vwap'
    ? `field_${name}`
    : 'field_close'
}

function numberValue(node: AstNode | undefined, fallback: number): number {
  return node?.kind === 'number' && Number.isFinite(node.value) ? node.value : fallback
}

function qlibCallDefinition(name: string): { blockId: string; parameters: Record<string, ParameterValue>; inputIndexes?: number[] } {
  const normalized = name.toLowerCase()
  const mapping: Record<string, string> = {
    ref: 'ts_ref', delta: 'ts_delta', pctchange: 'ts_pct_change', mean: 'ts_mean', sum: 'ts_sum', std: 'ts_std',
    min: 'ts_min', max: 'ts_max', rank: 'ts_rank', quantile: 'ts_quantile', corr: 'ts_corr', cov: 'ts_cov',
    slope: 'ts_slope', rsquare: 'ts_rsquare', idxmax: 'ts_argmax', idxmin: 'ts_argmin', skew: 'ts_skew',
    kurt: 'ts_kurt', resi: 'ts_residual', greater: 'maximum', less: 'minimum', abs: 'abs', log: 'log',
  }
  return { blockId: mapping[normalized] ?? 'constant', parameters: {} }
}

function binaryBlockId(operator: string): string {
  return ({ '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '>': 'greater', '<': 'less', '>=': 'greater', '<=': 'less', '==': 'equal', '!=': 'equal' } as Record<string, string>)[operator] ?? 'add'
}

function titleFor(blockId: string): string {
  return getBlockDefinition(blockId)?.title ?? blockId
}

export type BuiltFactorGraph = {
  nodes: ProjectNode[]
  edges: Edge[]
}

export function buildFactorGraph(factor: FactorDefinition): BuiltFactorGraph {
  const nodes: ProjectNode[] = []
  const edges: Edge[] = []
  let nodeIndex = 0
  let yIndex = 0

  const addNode = (blockId: string, parameters: Record<string, ParameterValue> = {}, depth = 0): string => {
    const definition = getBlockDefinition(blockId)
    if (!definition) throw new Error(`因子使用了未注册积木：${blockId}`)
    const id = `factor-node-${nodeIndex += 1}-${blockId}`
    const mergedParameters = { ...defaultBlockParameters(blockId), ...parameters }
    nodes.push({
      id,
      type: 'factor',
      position: { x: depth * 270 + 40, y: yIndex * 135 + 50 },
      data: {
        blockId,
        kind: definition.kind,
        title: definition.title,
        subtitle: definition.subtitle,
        description: definition.description,
        accent: definition.accent,
        symbol: definition.symbol,
        status: 'ready',
        parameters: mergedParameters,
      },
    })
    yIndex += 1
    return id
  }

  const connect = (source: string, target: string, targetHandle: string) => {
    edges.push({
      id: `edge-${source}-${target}-${targetHandle}`,
      source,
      target,
      sourceHandle: 'value',
      targetHandle,
      animated: true,
      style: { stroke: '#7c9696', strokeWidth: 2 },
    })
  }

  const visit = (node: AstNode, depth: number): string => {
    if (node.kind === 'field') return addNode(fieldBlockId(node.name), {}, depth)
    if (node.kind === 'number') return addNode('constant', { value: node.value }, depth)
    if (node.kind === 'unary') {
      const child = visit(node.value, depth)
      const current = addNode('negate', {}, depth + 1)
      connect(child, current, 'series')
      return current
    }
    if (node.kind === 'binary') {
      const left = visit(node.left, depth)
      const right = visit(node.right, depth)
      const current = addNode(binaryBlockId(node.operator), {}, depth + 1)
      const definition = getBlockDefinition(binaryBlockId(node.operator))!
      connect(left, current, definition.inputs[0].id)
      connect(right, current, definition.inputs[1].id)
      if (node.operator === '>' || node.operator === '<') {
        // NumPy comparisons used by Qlib count missing operands as false.
        const filled = addNode('fill_missing', { value: 0 }, depth + 2)
        connect(current, filled, 'series')
        return filled
      }
      return current
    }

    const definition = qlibCallDefinition(node.name)
    const blockId = definition.blockId === 'constant' ? 'abs' : definition.blockId
    const inputNodes: string[] = []
    const parameters: Record<string, ParameterValue> = {}
    const blockDefinition = getBlockDefinition(blockId)!
    if (blockDefinition.parameters.some((item) => item.id === 'min_samples')) {
      parameters.min_samples = 1
    }
    if (blockId === 'ts_corr' || blockId === 'ts_rsquare') parameters.std_tolerance = 2e-5
    node.args.forEach((arg, index) => {
      if (arg.kind === 'number') {
        if (blockId === 'ts_quantile' && index === 2) parameters.quantile = arg.value
        else if (blockId === 'ts_ref' || blockId === 'ts_delta' || blockId === 'ts_pct_change') parameters.lag = arg.value
        else if (index === 1 && blockDefinition.parameters.some((item) => item.id === 'window')) parameters.window = arg.value
        else if (index === 2 && blockDefinition.parameters.some((item) => item.id === 'window')) parameters.window = arg.value
        else inputNodes.push(visit(arg, depth))
      } else {
        inputNodes.push(visit(arg, depth))
      }
    })
    const current = addNode(blockId, parameters, depth + 1)
    const inputPorts = blockDefinition.inputs
    inputNodes.forEach((child, index) => connect(child, current, inputPorts[index]?.id ?? inputPorts[0]?.id ?? 'series'))
    return current
  }

  const ast = new ExpressionParser(tokenize(factor.expression)).parse()
  const root = visit(ast, 0)
  const outputId = addNode('factor_output', {}, nodes.length ? 1 : 0)
  connect(root, outputId, 'value')
  return { nodes, edges }
}

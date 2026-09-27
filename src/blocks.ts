export type BlockKind = 'input' | 'operator' | 'output'
export type PortType = 'table' | 'series' | 'scalar' | 'boolean'
export type ParameterValue = string | number | boolean

export type BlockPort = {
  id: string
  label: string
  type: PortType
  description: string
  required?: boolean
  multiple?: boolean
}

export type BlockParameter = {
  id: string
  label: string
  description: string
  type: 'number' | 'select' | 'boolean' | 'text'
  default: ParameterValue
  min?: number
  max?: number
  step?: number
  options?: Array<{ label: string; value: ParameterValue }>
}

export type BlockDefinition = {
  id: string
  categoryId: string
  kind: BlockKind
  title: string
  subtitle: string
  description: string
  accent: string
  symbol: string
  inputs: BlockPort[]
  output: BlockPort
  parameters: BlockParameter[]
  semantic: string
}

export type BlockCategory = {
  id: string
  label: string
  description: string
  accent: string
}

const seriesInput = (id: string, label: string, description: string, required = true): BlockPort => ({
  id,
  label,
  type: 'series',
  description,
  required,
})

const scalarInput = (id: string, label: string, description: string, required = true): BlockPort => ({
  id,
  label,
  type: 'scalar',
  description,
  required,
})

const booleanInput = (id: string, label: string, description: string, required = true): BlockPort => ({
  id,
  label,
  type: 'boolean',
  description,
  required,
})

const output = (id: string, label: string, type: PortType, description: string): BlockPort => ({ id, label, type, description })

const parameter = (
  id: string,
  label: string,
  description: string,
  type: BlockParameter['type'],
  defaultValue: ParameterValue,
  extra: Partial<BlockParameter> = {},
): BlockParameter => ({ id, label, description, type, default: defaultValue, ...extra })

export const blockCategories: BlockCategory[] = [
  { id: 'data', label: '数据字段', description: '从数据表取出一列，作为因子的原材料。', accent: '#5b7bb7' },
  { id: 'constants', label: '常数与参数', description: '把数字、窗口和阈值明确放进计算图。', accent: '#8b6bb8' },
  { id: 'math', label: '数学运算', description: '把加减乘除、函数和数值变换拆成最小动作。', accent: '#d5795f' },
  { id: 'logic', label: '比较与逻辑', description: '把条件、比较、缺失值处理变成可检查的连接。', accent: '#b46b9d' },
  { id: 'timeseries', label: '时序算子', description: '沿着同一标的的历史时间顺序计算。', accent: '#c99642' },
  { id: 'crosssection', label: '截面算子', description: '在同一时间点横向比较不同标的。', accent: '#4a9a8a' },
  { id: 'output', label: '输出', description: '把已经确认的计算结果命名为一个因子。', accent: '#8067ad' },
]

const dataBlocks: BlockDefinition[] = [
  {
    id: 'market_data', categoryId: 'data', kind: 'input', title: '市场数据', subtitle: '整张数据表',
    description: '代表当前项目导入的数据表，包含日期、标的和行情字段。', accent: '#5b7bb7', symbol: 'DATA',
    inputs: [], output: output('table', '数据表', 'table', '当前项目的数据表'), parameters: [], semantic: 'MarketData',
  },
  {
    id: 'field_open', categoryId: 'data', kind: 'input', title: '开盘价', subtitle: '一列行情数据',
    description: '取出每个标的在每个时间点的开盘价。', accent: '#5b7bb7', symbol: 'OPEN', inputs: [],
    output: output('value', '开盘价', 'series', '开盘价序列'), parameters: [], semantic: 'Open',
  },
  {
    id: 'field_high', categoryId: 'data', kind: 'input', title: '最高价', subtitle: '一列行情数据',
    description: '取出每个标的在每个时间点的最高价。', accent: '#5b7bb7', symbol: 'HIGH', inputs: [],
    output: output('value', '最高价', 'series', '最高价序列'), parameters: [], semantic: 'High',
  },
  {
    id: 'field_low', categoryId: 'data', kind: 'input', title: '最低价', subtitle: '一列行情数据',
    description: '取出每个标的在每个时间点的最低价。', accent: '#5b7bb7', symbol: 'LOW', inputs: [],
    output: output('value', '最低价', 'series', '最低价序列'), parameters: [], semantic: 'Low',
  },
  {
    id: 'field_close', categoryId: 'data', kind: 'input', title: '收盘价', subtitle: '一列行情数据',
    description: '取出每个标的在每个时间点的收盘价。', accent: '#5b7bb7', symbol: 'CLOSE', inputs: [],
    output: output('value', '收盘价', 'series', '收盘价序列'), parameters: [], semantic: 'Close',
  },
  {
    id: 'field_volume', categoryId: 'data', kind: 'input', title: '成交量', subtitle: '一列行情数据',
    description: '取出每个标的在每个时间点的成交量。', accent: '#5b7bb7', symbol: 'VOL', inputs: [],
    output: output('value', '成交量', 'series', '成交量序列'), parameters: [], semantic: 'Volume',
  },
  {
    id: 'field_amount', categoryId: 'data', kind: 'input', title: '成交额', subtitle: '一列行情数据',
    description: '取出每个标的在每个时间点的成交额。', accent: '#5b7bb7', symbol: 'AMT', inputs: [],
    output: output('value', '成交额', 'series', '成交额序列'), parameters: [], semantic: 'Amount',
  },
  {
    id: 'field_vwap', categoryId: 'data', kind: 'input', title: '成交均价', subtitle: '一列行情数据',
    description: '取出数据源提供的成交量加权平均价（VWAP）。', accent: '#5b7bb7', symbol: 'VWAP', inputs: [],
    output: output('value', '成交均价', 'series', 'VWAP 序列'), parameters: [], semantic: 'VWAP',
  },
]

const constantBlocks: BlockDefinition[] = [
  {
    id: 'constant', categoryId: 'constants', kind: 'operator', title: '数字常数', subtitle: '固定数值',
    description: '输出一个固定数字，常用于阈值、偏移量和防止除零的小量。', accent: '#8b6bb8', symbol: '123', inputs: [],
    output: output('value', '数字', 'scalar', '固定数字'), parameters: [parameter('value', '数值', '这个积木输出的固定数字。', 'number', 1, { step: 0.01 })], semantic: 'Constant',
  },
]

const binaryMath = (
  id: string,
  title: string,
  symbol: string,
  description: string,
  semantic: string,
): BlockDefinition => ({
  id, categoryId: 'math', kind: 'operator', title, subtitle: '逐行计算', description, accent: '#d5795f', symbol,
  inputs: [seriesInput('left', '左值', '左侧输入序列。'), seriesInput('right', '右值', '右侧输入序列或数字。')],
  output: output('value', '结果', 'series', '逐行计算结果'), parameters: [], semantic,
})

const unaryMath = (
  id: string,
  title: string,
  symbol: string,
  description: string,
  semantic: string,
  parameters: BlockParameter[] = [],
): BlockDefinition => ({
  id, categoryId: 'math', kind: 'operator', title, subtitle: '逐行计算', description, accent: '#d5795f', symbol,
  inputs: [seriesInput('series', '数值', '要变换的输入序列。')], output: output('value', '结果', 'series', '逐行计算结果'), parameters, semantic,
})

const realMathBlocks: BlockDefinition[] = [
  binaryMath('add', '加法', '+', '把两个序列逐行相加。', 'Add'),
  binaryMath('subtract', '减法', '−', '把右边序列从左边序列中逐行减去。', 'Subtract'),
  binaryMath('multiply', '乘法', '×', '把两个序列逐行相乘。', 'Multiply'),
  binaryMath('divide', '除法', '÷', '把左边序列逐行除以右边序列。', 'Divide'),
  {
    id: 'power', categoryId: 'math', kind: 'operator', title: '乘方', subtitle: '逐行计算',
    description: '把左边序列逐行做右边次方；右端没有连接时使用可编辑的指数参数。', accent: '#d5795f', symbol: 'xʸ',
    inputs: [seriesInput('left', '底数', '要做乘方的输入序列。'), scalarInput('right', '指数', '可以连接数字常数；未连接时使用下面的参数。', false)],
    output: output('value', '结果', 'series', '逐行乘方结果'), parameters: [parameter('exponent', '默认指数', '右端没有连接数字时使用的指数。', 'number', 2, { step: 0.1 })], semantic: 'Power',
  },
  unaryMath('abs', '绝对值', '|x|', '把负数变成正数，保留数值大小。', 'Abs'),
  unaryMath('negate', '取相反数', '−x', '把每个值乘以 -1。', 'Negate'),
  unaryMath('log', '自然对数', 'ln', '对输入取自然对数，非正值按数据引擎规则处理。', 'Log'),
  unaryMath('exp', '指数', 'eˣ', '计算 e 的输入次方。', 'Exp'),
  unaryMath('sqrt', '平方根', '√x', '对非负输入求平方根。', 'Sqrt'),
  unaryMath('sign', '符号', 'sign', '正数输出 1，负数输出 -1，零输出 0。', 'Sign'),
  binaryMath('maximum', '逐行取大', 'max', '两个输入逐行比较，保留较大的值。', 'Maximum'),
  binaryMath('minimum', '逐行取小', 'min', '两个输入逐行比较，保留较小的值。', 'Minimum'),
  {
    id: 'clip', categoryId: 'math', kind: 'operator', title: '限制范围', subtitle: '逐行计算',
    description: '把输入限制在最小值和最大值之间；边界可以连接数字常数，也可以直接编辑。', accent: '#d5795f', symbol: 'CLIP',
    inputs: [seriesInput('series', '数值', '要限制的序列。'), scalarInput('low', '最小值', '允许的下限；连接后覆盖参数。', false), scalarInput('high', '最大值', '允许的上限；连接后覆盖参数。', false)],
    output: output('value', '结果', 'series', '限制后的序列'), parameters: [
      parameter('low', '默认最小值', '未连接最小值积木时使用的下限。', 'number', -1, { step: 0.01 }),
      parameter('high', '默认最大值', '未连接最大值积木时使用的上限。', 'number', 1, { step: 0.01 }),
    ], semantic: 'Clip',
  },
]

const comparisonThreshold = parameter('threshold', '默认比较值', '右侧没有连接序列或数字积木时使用的比较值。', 'number', 0, { step: 0.01 })

const logicBlocks: BlockDefinition[] = [
  {
    id: 'greater', categoryId: 'logic', kind: 'operator', title: '大于', subtitle: '逐行比较', description: '判断左边是否大于右边，输出真或假。', accent: '#b46b9d', symbol: '>',
    inputs: [seriesInput('left', '左值', '左侧待比较序列。'), seriesInput('right', '右值', '右侧待比较序列或数字；未连接时使用参数。', false)], output: output('condition', '条件', 'boolean', '逐行布尔条件'), parameters: [comparisonThreshold], semantic: 'Greater',
  },
  {
    id: 'less', categoryId: 'logic', kind: 'operator', title: '小于', subtitle: '逐行比较', description: '判断左边是否小于右边，输出真或假。', accent: '#b46b9d', symbol: '<',
    inputs: [seriesInput('left', '左值', '左侧待比较序列。'), seriesInput('right', '右值', '右侧待比较序列或数字；未连接时使用参数。', false)], output: output('condition', '条件', 'boolean', '逐行布尔条件'), parameters: [comparisonThreshold], semantic: 'Less',
  },
  {
    id: 'equal', categoryId: 'logic', kind: 'operator', title: '等于', subtitle: '逐行比较', description: '判断两个输入是否相等。', accent: '#b46b9d', symbol: '=',
    inputs: [seriesInput('left', '左值', '左侧待比较序列。'), seriesInput('right', '右值', '右侧待比较序列或数字；未连接时使用参数。', false)], output: output('condition', '条件', 'boolean', '逐行布尔条件'), parameters: [comparisonThreshold], semantic: 'Equal',
  },
  {
    id: 'and', categoryId: 'logic', kind: 'operator', title: '并且', subtitle: '组合条件', description: '只有两个条件都为真时才输出真。', accent: '#b46b9d', symbol: 'AND',
    inputs: [booleanInput('left', '条件 A', '第一个布尔条件。'), booleanInput('right', '条件 B', '第二个布尔条件。')], output: output('condition', '条件', 'boolean', '组合后的布尔条件'), parameters: [], semantic: 'And',
  },
  {
    id: 'or', categoryId: 'logic', kind: 'operator', title: '或者', subtitle: '组合条件', description: '任意一个条件为真时输出真。', accent: '#b46b9d', symbol: 'OR',
    inputs: [booleanInput('left', '条件 A', '第一个布尔条件。'), booleanInput('right', '条件 B', '第二个布尔条件。')], output: output('condition', '条件', 'boolean', '组合后的布尔条件'), parameters: [], semantic: 'Or',
  },
  {
    id: 'not', categoryId: 'logic', kind: 'operator', title: '不是', subtitle: '反转条件', description: '把真变成假，把假变成真。', accent: '#b46b9d', symbol: 'NOT',
    inputs: [booleanInput('condition', '条件', '要反转的布尔条件。')], output: output('condition', '条件', 'boolean', '反转后的布尔条件'), parameters: [], semantic: 'Not',
  },
  {
    id: 'where', categoryId: 'logic', kind: 'operator', title: '条件选择', subtitle: '按条件选值', description: '条件为真时取左值，否则取右值。', accent: '#b46b9d', symbol: '?',
    inputs: [booleanInput('condition', '条件', '决定选择哪一侧的条件。'), seriesInput('when_true', '为真时', '条件为真时输出的序列。'), seriesInput('when_false', '为假时', '条件为假时输出的序列。')], output: output('value', '结果', 'series', '条件选择结果'), parameters: [], semantic: 'Where',
  },
  {
    id: 'fill_missing', categoryId: 'logic', kind: 'operator', title: '填充缺失值', subtitle: '数据清洗', description: '当输入为空时使用指定数字，避免缺失值继续扩散。', accent: '#b46b9d', symbol: 'FILL',
    inputs: [seriesInput('series', '数值', '可能包含缺失值的序列。'), scalarInput('value', '填充值', '可以连接数字常数；未连接时使用参数。', false)], output: output('value', '结果', 'series', '填充后的序列'), parameters: [parameter('value', '默认填充值', '未连接数字常数时使用的数字。', 'number', 0, { step: 0.01 })], semantic: 'FillMissing',
  },
]

const windowParameter = parameter('window', '窗口长度', '向历史回看多少个观测。', 'number', 5, { min: 2, max: 5000, step: 1 })
const minSamplesParameter = parameter('min_samples', '最少有效样本', '有效样本不足时输出空值。', 'number', 5, { min: 1, max: 5000, step: 1 })
const directionParameter = parameter('descending', '排名方向', '决定数值越大还是越小排名越靠前。', 'select', true, { options: [{ label: '越大越强', value: true }, { label: '越小越强', value: false }] })

const timeSeries = (id: string, title: string, symbol: string, description: string, semantic: string, parameters: BlockParameter[] = [windowParameter, minSamplesParameter]): BlockDefinition => ({
  id, categoryId: 'timeseries', kind: 'operator', title, subtitle: '按标的回看历史', description, accent: '#c99642', symbol,
  inputs: [seriesInput('series', '序列', '沿同一标的的时间顺序计算。')], output: output('value', '结果', 'series', '时序计算结果'), parameters, semantic,
})

const pairTimeSeries = (id: string, title: string, symbol: string, description: string, semantic: string): BlockDefinition => ({
  id, categoryId: 'timeseries', kind: 'operator', title, subtitle: '按标的回看历史', description, accent: '#c99642', symbol,
  inputs: [seriesInput('left', '序列 A', '第一个历史序列。'), seriesInput('right', '序列 B', '第二个历史序列。')], output: output('value', '结果', 'series', '时序计算结果'), parameters: [windowParameter, minSamplesParameter], semantic,
})

const timeSeriesBlocks: BlockDefinition[] = [
  timeSeries('ts_ref', '历史引用', 'REF', '取同一标的前 N 个观测的值。', 'Ref', [parameter('lag', '回看期数', '向历史回看多少期。', 'number', 1, { min: 1, max: 5000, step: 1 })]),
  timeSeries('ts_delta', '历史差值', 'Δ', '用当前值减去 N 个观测前的值。', 'Delta', [parameter('lag', '回看期数', '向历史回看多少期。', 'number', 1, { min: 1, max: 5000, step: 1 })]),
  timeSeries('ts_pct_change', '历史涨跌幅', '%', '计算当前值相对 N 个观测前值的变化比例。', 'PctChange', [parameter('lag', '回看期数', '向历史回看多少期。', 'number', 1, { min: 1, max: 5000, step: 1 })]),
  timeSeries('ts_mean', '时序均值', 'MEAN', '对同一标的的历史窗口求平均。', 'Mean'),
  timeSeries('ts_sum', '时序求和', 'SUM', '对同一标的的历史窗口求和。', 'Sum'),
  timeSeries('ts_std', '时序标准差', 'STD', '衡量同一标的历史窗口内的波动程度。', 'Std'),
  timeSeries('ts_min', '时序最小值', 'MIN', '取同一标的历史窗口中的最小值。', 'Min'),
  timeSeries('ts_max', '时序最大值', 'MAX', '取同一标的历史窗口中的最大值。', 'Max'),
  timeSeries('ts_rank', '时序排名', 'RANK', '把当前值放进同一标的的历史窗口中，输出相对位置。', 'Rank', [windowParameter, minSamplesParameter, directionParameter]),
  timeSeries('ts_quantile', '时序分位数', 'QTL', '取历史窗口中指定分位点的数值，使用线性插值。', 'Quantile', [windowParameter, minSamplesParameter, parameter('quantile', '分位点', '0 到 1 之间，例如 0.8。', 'number', 0.8, { min: 0, max: 1, step: 0.05 })]),
  pairTimeSeries('ts_corr', '时序相关性', 'CORR', '衡量两个序列在同一标的历史窗口内的相关性。', 'Corr'),
  pairTimeSeries('ts_cov', '时序协方差', 'COV', '衡量两个序列在历史窗口内的共同变化。', 'Cov'),
  timeSeries('ts_slope', '趋势斜率', 'SLOPE', '用历史窗口拟合一条直线，输出变化斜率。', 'Slope'),
  timeSeries('ts_rsquare', '趋势拟合度', 'R²', '输出历史窗口线性趋势的 R²。', 'Rsquare'),
  timeSeries('ts_argmax', '最大值位置', 'IMAX', '从窗口最老观测起按 1 编号，输出最大值首次出现的位置；须先处理缺失值。', 'IdxMax'),
  timeSeries('ts_argmin', '最小值位置', 'IMIN', '从窗口最老观测起按 1 编号，输出最小值首次出现的位置；须先处理缺失值。', 'IdxMin'),
  timeSeries('ts_skew', '偏度', 'SKEW', '衡量历史窗口分布的左右偏斜程度。', 'Skew'),
  timeSeries('ts_kurt', '峰度', 'KURT', '衡量历史窗口分布尾部和尖峰程度。', 'Kurt'),
  timeSeries('ts_residual', '趋势残差', 'RESI', '输出当前值相对历史线性趋势的残差。', 'Resi'),
]

const crossSectionBlocks: BlockDefinition[] = [
  {
    id: 'cs_rank', categoryId: 'crosssection', kind: 'operator', title: '截面排名', subtitle: '按日期横向比较', description: '在同一时间点，把所有标的按输入值排序。', accent: '#4a9a8a', symbol: 'CS RANK',
    inputs: [seriesInput('series', '序列', '在同一时间点横向比较的序列。')], output: output('value', '结果', 'series', '截面百分位排名'), parameters: [], semantic: 'Cs_Rank',
  },
  {
    id: 'cs_zscore', categoryId: 'crosssection', kind: 'operator', title: '截面 ZScore', subtitle: '按日期标准化', description: '在同一时间点减去截面均值，再除以截面标准差。', accent: '#4a9a8a', symbol: 'Z',
    inputs: [seriesInput('series', '序列', '在同一时间点标准化的序列。')], output: output('value', '结果', 'series', '截面 ZScore'), parameters: [], semantic: 'Cs_ZScore',
  },
  {
    id: 'cs_mean', categoryId: 'crosssection', kind: 'operator', title: '截面均值', subtitle: '按日期横向聚合', description: '计算同一时间点所有标的的平均值。', accent: '#4a9a8a', symbol: 'CS MEAN',
    inputs: [seriesInput('series', '序列', '需要横向聚合的序列。')], output: output('value', '结果', 'series', '截面均值'), parameters: [], semantic: 'Cs_Mean',
  },
  {
    id: 'cs_std', categoryId: 'crosssection', kind: 'operator', title: '截面标准差', subtitle: '按日期横向聚合', description: '计算同一时间点所有标的的离散程度。', accent: '#4a9a8a', symbol: 'CS STD',
    inputs: [seriesInput('series', '序列', '需要横向聚合的序列。')], output: output('value', '结果', 'series', '截面标准差'), parameters: [], semantic: 'Cs_Std',
  },
  {
    id: 'cs_min', categoryId: 'crosssection', kind: 'operator', title: '截面最小值', subtitle: '按日期横向聚合', description: '取同一时间点所有标的中的最小值。', accent: '#4a9a8a', symbol: 'CS MIN',
    inputs: [seriesInput('series', '序列', '需要横向聚合的序列。')], output: output('value', '结果', 'series', '截面最小值'), parameters: [], semantic: 'Cs_Min',
  },
  {
    id: 'cs_max', categoryId: 'crosssection', kind: 'operator', title: '截面最大值', subtitle: '按日期横向聚合', description: '取同一时间点所有标的中的最大值。', accent: '#4a9a8a', symbol: 'CS MAX',
    inputs: [seriesInput('series', '序列', '需要横向聚合的序列。')], output: output('value', '结果', 'series', '截面最大值'), parameters: [], semantic: 'Cs_Max',
  },
  {
    id: 'cs_center', categoryId: 'crosssection', kind: 'operator', title: '截面去均值', subtitle: '按日期横向处理', description: '每个值减去同一时间点的截面均值。', accent: '#4a9a8a', symbol: 'CENTER',
    inputs: [seriesInput('series', '序列', '需要去均值的序列。')], output: output('value', '结果', 'series', '去均值后的序列'), parameters: [], semantic: 'Cs_Center',
  },
  {
    id: 'cs_scale', categoryId: 'crosssection', kind: 'operator', title: '截面缩放', subtitle: '按日期横向处理', description: '把每个值除以同一时间点的截面绝对值总和。', accent: '#4a9a8a', symbol: 'SCALE',
    inputs: [seriesInput('series', '序列', '需要缩放的序列。')], output: output('value', '结果', 'series', '缩放后的序列'), parameters: [], semantic: 'Cs_Scale',
  },
  {
    id: 'cs_neutralize', categoryId: 'crosssection', kind: 'operator', title: '截面中性化', subtitle: '按日期回归处理', description: '使用暴露变量解释输入，把剩余部分作为中性化结果。', accent: '#4a9a8a', symbol: 'NEUTRAL',
    inputs: [seriesInput('series', '因子', '需要中性化的因子。'), seriesInput('exposure', '暴露', '用于回归解释的暴露序列。')], output: output('value', '结果', 'series', '中性化残差'), parameters: [], semantic: 'Cs_Neutralize',
  },
]

const outputBlocks: BlockDefinition[] = [
  {
    id: 'factor_output', categoryId: 'output', kind: 'output', title: '因子输出', subtitle: '命名结果',
    description: '把上游计算结果标记为最终因子，可预览、保存和导出。', accent: '#8067ad', symbol: 'OUT',
    inputs: [seriesInput('value', '因子值', '最终要输出的序列。')], output: output('factor', '因子', 'series', '最终因子序列'), parameters: [], semantic: 'FactorOutput',
  },
]

export const blockDefinitions: BlockDefinition[] = [
  ...dataBlocks,
  ...constantBlocks,
  ...realMathBlocks,
  ...logicBlocks,
  ...timeSeriesBlocks,
  ...crossSectionBlocks,
  ...outputBlocks,
]

const compatibilityDefinitions: Record<string, BlockDefinition> = {
  custom_formula: {
    id: 'custom_formula', categoryId: 'custom', kind: 'operator', title: '自定义公式', subtitle: '可复用表达式',
    description: '用 x 代表输入序列，例如 x * 2；创建后可以反复加入画布。', accent: '#6f7eb8', symbol: 'fx',
    inputs: [seriesInput('series', '输入', '自定义公式中的 x 所代表的序列。')], output: output('value', '结果', 'series', '自定义公式结果'), parameters: [], semantic: 'CustomFormula',
  },
  close_open_ratio: {
    id: 'close_open_ratio', categoryId: 'math', kind: 'operator', title: '收开比（兼容）', subtitle: '旧项目复合积木',
    description: '旧项目中的收盘价除以开盘价。新项目请用“收盘价 + 开盘价 + 除法”三个原子积木重建。', accent: '#d5795f', symbol: 'C/O',
    inputs: [], output: output('value', '收开比', 'series', '收盘价除以开盘价'), parameters: [], semantic: 'CloseOpenRatio',
  },
}

const aliases: Record<string, string> = {
  open_field: 'field_open',
  high_field: 'field_high',
  low_field: 'field_low',
  close_field: 'field_close',
  volume_field: 'field_volume',
  amount_field: 'field_amount',
  vwap_field: 'field_vwap',
  condition: 'where',
}

const blockMap = new Map(blockDefinitions.map((block) => [block.id, block]))

export function getBlockDefinition(blockId: string | undefined): BlockDefinition | undefined {
  if (!blockId) return undefined
  const direct = blockMap.get(blockId) ?? compatibilityDefinitions[blockId]
  if (direct) return direct
  return blockMap.get(aliases[blockId])
}

export function canonicalBlockId(blockId: string | undefined): string | undefined {
  if (!blockId) return undefined
  return aliases[blockId] ?? blockId
}

export function defaultBlockParameters(blockId: string | undefined): Record<string, ParameterValue> {
  const definition = getBlockDefinition(blockId)
  return Object.fromEntries((definition?.parameters ?? []).map((item) => [item.id, item.default]))
}

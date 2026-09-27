# 第六章：量价相关

本章只讲两个家族：CORR 看价格水平与对数成交量，CORD 看价格比值与加一取对数后的成交量比值。`5、10、20、30、60` 是窗口参数，不另外重复写文章。手算统一用最后五组观测，画布拆解统一用 20 日版本。

## 阅读顺序

1. [CORR：价格高的时候，成交量也大吗？](01-CORR-价格高的时候成交量也大吗.md)
2. [CORD：价格变化与成交量变化同步吗？](02-CORD-价格变化与成交量变化同步吗.md)

## 本章手算数据

| 交易日 | 收盘价 Close | 成交量 Volume | 用途 |
| --- | ---: | ---: | --- |
| 第 0 天 | 10.00 | 100 | 仅供 CORD 第 1 天取前值 |
| 第 1 天 | 10.40 | 120 | 第一组配对 |
| 第 2 天 | 10.20 | 90 | 第二组配对 |
| 第 3 天 | 10.20 | 90 | 第三组配对 |
| 第 4 天 | 10.80 | 150 | 第四组配对 |
| 第 5 天，今天 | 10.60 | 130 | 第五组配对 |

两篇的相关窗口都只用第 1 至第 5 天，包含今天。CORR5 不需要第 0 天；CORD5 需要六条原始行情，才能得到五组相邻观测比值。`Ref(...,1)` 是前一个观测位置，不是前一个自然日。价格口径、成交量单位和日期对齐必须一致。

## 公式与核算

| 家族 | Qlib Alpha158 原式 | 本例五日结果 |
| --- | --- | ---: |
| CORR | `Corr($close,Log($volume+1),n)` | 0.974795267636 |
| CORD | `Corr($close/Ref($close,1),Log($volume/Ref($volume,1)+1),n)` | 0.960674338579 |

结果已用 Python `Decimal` 以 50 位精度从原始数据求自然对数、均值、离差乘积与平方和，并用 `statistics.correlation` 交叉核对。表内展示值经过舍入，不应拿舍入值要求末位完全一致。

CORR 的加一在对数内部；CORD 是 `ln(1+V_t/V_(t-1))`，不是 `ln(V_t/V_(t-1))`，也不是 `ln(1+成交量pct_change)`。价格比值虽未减一，但 Pearson 中心化会抵消整列减一；对数内部的加一不是这种平移。

工坊用 `Ts_Corr` 标明时序相关，以 `Close`、`Volume` 命名字段；Qlib 原式使用 `Corr`、`$close`、`$volume`。本章两种因子导入时都显式设置 `min_samples=1`、`std_tolerance=2e-5`。通用相关积木的近常数阈值默认 `0`，不是 Qlib 的默认；手搭时要核对参数，而非只看公式名字。RSQR 的 Qlib 导入同样显式设置该阈值，检查的是其输入价格序列。

## 共同边界

- 按标的、按日期配对计算 Pearson，不跨股票拼样本；数值没有因果、领先方向或未来收益的含义。
- 水平序列的共同趋势可能制造伪相关；改用比值也不保证消除伪相关。异常观测仍会影响结果。
- Qlib 正整数窗口调用 `rolling(n,min_periods=1).corr(...)`，但数学上仍至少需要两组有效配对且两列有变化。两组样本若有定义，相关就会达到正负一，不能当成可靠证据。
- `Corr` 随后分别检查两侧各自窗口标准差，任一侧满足 `np.isclose(std,0,atol=2e-5)` 就置为 `NaN`。因此不只严格常数会被排除；缺失分布不同时，这个独立标准差检查也不等于只对配对样本检查。
- 缺失观测按日期成对排除，不分别压缩两列再拼接。CORD 应先在对齐的序列上取历史值，不能通过删掉缺失行把跨缺口变化冒充单期变化。
- 昨日成交量为零时，CORD 的除法已经无效，后续加一不能补救。应先核查并清洗，不能把 `inf` 变成有效信号；今日零量且昨日正量则得到 `ln(1)=0`，是否纳入还需研究者明确数据规则。
- 日线包含今天收盘和全天成交量，最终读数须等这些数据可用；不要用于解释当天更早已执行的交易。

## 配图与画布

每篇配有两张图：五日手算图与对应 20 日因子的真实 DAG 截图。手算复核时只将相关窗口改为 `5`，保留 `min_samples=1`、`std_tolerance=2e-5`；CORD 的两个历史引用仍为 `1`，并保留第零天行情。

| 文章 | 手算图 | 真实 DAG 图 |
| --- | --- | --- |
| CORR | `images/01-corr-example.png` | `images/01-corr-dag.png` |
| CORD | `images/02-cord-example.png` | `images/02-cord-dag.png` |

## 固定来源

源码核对日期：2026-09-27。以下均固定到 Microsoft Qlib 提交 `be725493eb1a6bbb42bf11b37aa7669f59610ff1`，已实际获取并核对，不使用浮动分支地址。

- [Alpha158 字段和表达式：loader.py](https://github.com/microsoft/qlib/blob/be725493eb1a6bbb42bf11b37aa7669f59610ff1/qlib/contrib/data/loader.py#L221-L228)
- [Log：ops.py](https://github.com/microsoft/qlib/blob/be725493eb1a6bbb42bf11b37aa7669f59610ff1/qlib/data/ops.py#L167-L182)
- [Div：ops.py](https://github.com/microsoft/qlib/blob/be725493eb1a6bbb42bf11b37aa7669f59610ff1/qlib/data/ops.py#L418-L435)
- [Ref：ops.py](https://github.com/microsoft/qlib/blob/be725493eb1a6bbb42bf11b37aa7669f59610ff1/qlib/data/ops.py#L781-L824)
- [PairRolling 与 Corr：ops.py](https://github.com/microsoft/qlib/blob/be725493eb1a6bbb42bf11b37aa7669f59610ff1/qlib/data/ops.py#L1387-L1498)

[返回专栏](../README.md)

本文只讨论因子定义与研究方法，不构成投资建议。

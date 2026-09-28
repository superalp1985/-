# Codex++ 打字卡半天：1.3.0 的一次排查，以及上游已经合并的修复

> 2026 年 9 月 28 日补充：查过上游仓库后，发现这个问题并不只有我们遇到。社区已有 [Issue #2255](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2255) 和 [Issue #2256](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2256)，`dongyu23` 提交的 [PR #2271](https://github.com/BigPizzaV3/CodexPlusPlus/pull/2271) 已于 9 月 22 日合并。当天核对时，[最新正式 Release](https://github.com/BigPizzaV3/CodexPlusPlus/releases/latest) 仍是 9 月 10 日发布的 `v1.3.0`，早于这次合并。代码修好和安装包发出来，是两件事。
>
> 下面的用户脚本只是旧版应急绕过，不是上游源码修复，也不是无副作用的通用补丁。原文对根因和回滚效果说得太满，这次一并纠正。

下面记录这台机器遇到的现象、上游源码里的问题，以及临时处理的限制。

我用 Codex++ 的时候，遇到过一个很难受的毛病：

输入框会间歇性卡住。字打出去了，界面没反应；等几秒，刚才敲的内容突然一起冒出来。刚开始我以为是模型服务慢，后来发现没发消息的时候也会卡，排查方向才转到桌面端和 Codex++ 的兼容逻辑上。

这台机器上的组合是：

```text
Codex++  1.3.0
build    diag-20260518-1
Codex    26.917.9434.0
```

这个版本组合是排查线索，不是单凭版本号就能下的诊断。

## 先给结论

Codex++ 1.3.0 里有一段兼容逻辑，会根据脚本文本反查 Codex 前端 asset 的地址，函数名是 `codexAppAssetUrlFromScriptText`。这里的 asset，就是前端打包出来的 JavaScript 文件。

上游 #2255、#2256 的报告记录了在 Codex `26.911`、`26.915` 上反复扫描资源的现象。进一步对照 `v1.3.0` 源码，能确认一个具体缺陷：模型请求补丁安装失败后，provider 分支提前返回，绕过了原本“失败 8 次就停止”的判断。

因此，兼容代码找不到目标模块时，可能一直重试、一直做资源查找。我们的 `26.917.9434.0` 上也出现了输入卡顿，但这次没有留下完整的性能录制，不能把上游测到的 CPU 占用、请求次数直接当成这台机器的实测数据。

也不能据此说所有打字卡顿都来自这个问题。相同症状，还得结合调用栈、请求记录和禁用脚本的对照来看。

## 怎么确认是不是同一个问题

先查版本，不要凭感觉。

打开 PowerShell：

```powershell
Get-AppxPackage OpenAI.Codex | Select-Object Name, Version
```

正常会看到：

```text
Name            Version
----            -------
OpenAI.Codex    26.917.9434.0
```

再查 Codex++：

```powershell
$exe = "$env:LOCALAPPDATA\Programs\Codex++\codex-plus-plus.exe"
(Get-Item -LiteralPath $exe).VersionInfo |
  Select-Object FileVersion, ProductVersion
```

如果版本是 `1.3.0`，先对上第一半。

然后观察症状。下面几条可以帮助缩小范围，不能单独当成确诊依据：

- 输入文字时界面间歇性没有反馈，停顿后又一次性补出来。
- 暂停输入后能恢复，但继续打字又卡。
- 任务管理器里宿主 Codex 的主进程或渲染进程 CPU 异常升高。我们这台机器上宿主显示为 `ChatGPT.exe`，不能只盯着 `codex-plus-plus.exe`。
- 打开开发者工具后，能看到 `app://-/assets/*.js` 被反复请求。
- 调用栈里出现 `codexAppAssetUrlFromScriptText`。
- 模型回答本身不一定慢，卡的是输入和界面刷新。

如果卡顿发生时还能看到持续的资源扫描，再去查这条兼容路径才有依据。只看到版本一样、打字慢，还不足以排除其他原因。

## 为什么重试会停不下来

Codex++ 不是独立重写 Codex，而是在 Codex 前端上做兼容补丁。Codex 每次更新，它依赖的内部结构都可能变化。

`codexAppAssetUrlFromScriptText` 接收的是模块名前缀。它逐个读取候选脚本，再用正则找目标模块的引用地址。找不到，才返回空结果。这个函数自身的循环是有限的，问题在于上层会不会反复调用相关发现逻辑。

在 [v1.3.0 的源码](https://github.com/BigPizzaV3/CodexPlusPlus/blob/v1.3.0/assets/inject/renderer-inject.js#L7019-L7058) 中，`noteAppServerModelRequestPatchMiss` 先增加失败计数，但遇到 provider 分支就安排 250 毫秒后的重试并返回，后面的 8 次上限没有机会执行。

所以，不是“文件哈希变了就一定卡”，而是目标模块没找到之后，这条失败路径没有正确停下来。资源发现还涉及缓存、动态导入和其他调用方，不能把每一轮重试都简单等同于一次全量 fetch。

PR #2271 修的是这一层：所有模式都遵守失败次数上限，达到上限就停掉该层适配并清理重试计时器；provider 重试加入退避，移除几段写死的旧文件哈希，并补了回归测试。

这里的“修复”也有边界：找不到模块时安静停下，不代表那个版本的所有适配功能都恢复了。上游 PR 附有 `26.915.4065.0` 的验证记录；我还没有在 `26.917.9434.0` 上运行包含该修复的构建。

## 先看发布记录，再考虑临时脚本

官方项目是 [BigPizzaV3/CodexPlusPlus](https://github.com/BigPizzaV3/CodexPlusPlus)，不是脚本市场仓库。

截至 2026 年 9 月 28 日，正式发布页仍指向 `v1.3.0`。重装同一个版本，不会自动带上后来合并到主分支的修复。等包含 PR #2271 的正式版本发布后，再按发布说明升级和验证；会自行构建的人也应记录所用提交，不能只看显示的版本号。

暂时仍需使用旧版时，下面这个用户脚本可以作为应急选项。使用前先看清它实际做了什么。

脚本放在仓库里：

[00-codex-asset-rescan-guard.js](https://github.com/superalp1985/-/blob/main/tools/codexplus/00-codex-asset-rescan-guard.js)

它不会修改 Codex 安装目录，但会改变页面运行状态：

1. 只在 Codex++ `1.3.0`、build `diag-20260518-1` 下启用。
2. 只拦截 `app://-/assets/*.js`，并且调用栈必须包含 `codexAppAssetUrlFromScriptText`。
3. 对命中的请求返回 HTTP 200 和空 JavaScript，跳过这次真实文件读取。返回空内容本身并不保证上层停止重试。
4. 写入三个“补丁已安装”标记，启动后的前 10 秒里每 250 毫秒重写一次，让对应安装路径提前返回。

第四件事不能省略不讲。标记分别是：

```js
window.__codexPlusAppServerModelRequestPatchInstalled = "7"
window.__codexServiceTierRequestOverrideInstalled = "9"
window.__codexDictationSupportPatched = "1"
```

它们可能让模型请求、service tier 和听写相关适配被跳过。若这些功能出现异常，应停用 guard，完整重启后再检查。不能一边跳过兼容逻辑，一边承诺功能完全不受影响。

未命中的请求会交给安装 guard 之前的 `fetch`。脚本只检查 Codex++ 的版本和 build，**没有检查宿主 Codex 的版本**；同为 `1.3.0` 也不代表该装这个脚本。包含上游修复的自编译版本尤其不应直接套用。

## 安装办法

仓库里有一个 PowerShell 安装脚本：

[install-asset-rescan-guard.ps1](https://github.com/superalp1985/-/blob/main/tools/codexplus/install-asset-rescan-guard.ps1)

在项目目录执行：

```powershell
pwsh -File .\tools\codexplus\install-asset-rescan-guard.ps1
```

安装器会：

- 把 guard 脚本复制到 `%APPDATA%\Codex++\user_scripts`。
- 备份现有的 `user_scripts.json`。
- 打开 `user:00-codex-asset-rescan-guard.js`。
- 把用户脚本总开关设为开启。如果之前关闭了总开关，原本逐项启用的其他脚本也可能一起恢复运行，安装前应检查。
- 提示重启 Codex++ 和 Codex。

如果不想运行安装脚本，也可以手动放文件，然后在 Codex++ Manager 的用户脚本页面启用。对应的配置项是：

```json
"user:00-codex-asset-rescan-guard.js": true
```

放好以后，完全退出 Codex++ 和 Codex，再启动。只关窗口不算，托盘进程也退掉。

## 怎么确认它真的生效

重启后打开 Codex++ 的开发者工具，在 Console 里执行：

```js
window.__CODEX_PLUS_VERSION__
window.__CODEX_PLUS_BUILD__
window.__codexAssetRescanGuard
window.__codexAssetRescanGuard.blockedRequests
window.__codexAssetRescanGuard.lastBlockedUrl
```

能看到 guard 对象，说明脚本已经加载。

如果 `blockedRequests` 从零开始增长，只能说明命中了这条扫描路径，不等于已经证明它是唯一的卡顿来源。计数为零也不能单独证明问题消失，因为安装标记可能已经让相关路径提前返回。

如果 guard 是 `undefined`，检查三件事：

1. 脚本是否在 `%APPDATA%\Codex++\user_scripts` 下。
2. `user_scripts.json` 里是否把它设成了 `true`。
3. Codex++ 版本和 build 是否仍然完全匹配。

Codex++ 版本或 build 不匹配时，脚本会主动不运行。这个保护不包含宿主版本检查，也不能代替兼容性验证。

## 还想再稳一点

先记下其他用户脚本的启用状态，再临时关闭它们，只留 guard，重启后观察同样的会话和输入操作。若卡顿缓解，再逐个恢复原来的脚本。十分钟没卡是短时观察结果，不是长期稳定保证。

我这边之前同时开了 Context Used Meter、Context Ring Restore 和 List Pagebuster。它们不一定直接造成这个循环，但都会往页面逻辑上加东西。排障时一次只开一个，变量才清楚。

脚本提供了 `restore()`：

```js
window.__codexAssetRescanGuard.restore()
```

它只会在 `fetch` 仍由本 guard 包装时恢复先前的函数，并清掉自己的计时器。它**不会还原上述三个标记，也不会清除 guard 对象或把 `enabled` 改成 false**，所以不能用“调用后是否立刻又卡”作完整的开关对照。

真正回滚时，在 Codex++ Manager 里停用 `user:00-codex-asset-rescan-guard.js`，再完整退出并重启 Codex++ 和 Codex。不要只刷新页面：脚本仍启用时，刷新会再加载一次。做对照前先保存工作，不要为了重现卡顿中断正在运行的任务。

## 不要做的事

不要删 Codex 安装目录里的 `app.asar`。

不要把整个 `fetch` 网络请求全部拦掉。

不要为了旧版 Codex++ 永久锁死 Codex 更新。

也不要看到“反复扫描 asset”就认定软件有恶意。这里更像是兼容层跟不上宿主更新，属于版本适配事故。

临时脚本的目标只是绕过部分问题路径。升级到包含上游修复的版本后，应停用 guard 并完整重启，确认卡顿和常用功能，再删除脚本。

## 给上游的反馈怎么写

查完仓库后，我觉得没必要再提一份相同修复的 PR。问题报告和源码修复已经有人做了，应该把出处写清楚。

能补充的是：我们使用的 `26.917.9434.0` 版本组合、输入卡顿的具体表现、临时脚本的限制，以及后续使用正式修复版本的验证结果。没有测过的数据不填，别人测到的请求次数也不拿来当自己的。

计划把这些信息补在 [#2255](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2255) 下，而不是重复开单。截至本次更新，反馈还停留在草稿阶段，尚未在上游发出。

对遇到类似问题的人来说，先核对版本和问题路径，再看上游发布进展，比直接装一段来历不明的补丁更有用。本文的脚本也一样：知道它跳过了什么，再决定要不要用。

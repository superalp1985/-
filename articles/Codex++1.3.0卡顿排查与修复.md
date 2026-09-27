# Codex++ 打字卡半天：1.3.0 和 Codex 26.917.9434.0 的一次兼容事故

下面是我实际排查和处理的版本，命令可以直接照着查。

我用 Codex++ 的时候，遇到过一个很难受的毛病：

输入框会间歇性卡住。字打出去了，界面没反应；等几秒，刚才敲的内容突然一起冒出来。刚开始我以为是模型服务慢，后来发现模型根本没开始跑，卡的是 Codex++ 自己。

这台机器上的组合是：

```text
Codex++  1.3.0
build    diag-20260518-1
Codex    26.917.9434.0
```

版本对不上，就是这个问题的入口。

## 先给结论

Codex++ 1.3.0 里有一段兼容逻辑，会根据脚本文本反查 Codex 前端 asset 的地址，函数名是 `codexAppAssetUrlFromScriptText`。

Codex 升级到 `26.917.9434.0` 后，前端 asset 的结构和旧版逻辑对不上了。这段兼容逻辑没有拿到稳定结果，反而反复扫描 `app://-/assets/*.js`。扫描发生在渲染进程里，输入框自然跟着卡。

不是键盘坏了，不是电脑配置不行，也不是模型响应慢。真正占着前台的是 Codex++ 的旧兼容代码。

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

然后观察症状。符合下面几条，基本就是同一个坑：

- 输入文字时界面间歇性没有反馈，停顿后又一次性补出来。
- 暂停输入后能恢复，但继续打字又卡。
- Task Manager 里 `codex-plus-plus` 的 CPU 会异常升高。
- 打开开发者工具后，能看到 `app://-/assets/*.js` 被反复请求。
- 调用栈里出现 `codexAppAssetUrlFromScriptText`。
- 模型回答本身不一定慢，卡的是输入和界面刷新。

Codex 是新的，Codex++ 还在按旧 asset 结构找脚本。旧逻辑没命中，导致重复扫描。问题不在输入法，也不在 prompt。

## 为什么旧版会死循环

Codex++ 不是独立重写 Codex，而是在 Codex 前端上做兼容补丁。Codex 每次更新，它依赖的内部结构都可能变化。

`codexAppAssetUrlFromScriptText` 原本要做的事很直接：拿到一段脚本文本，反查它属于哪个 `app://-/assets/...js`。旧版 Codex 的 asset 数量、命名和内容都还在预期内时，这条路能走通。

Codex `26.917.9434.0` 改了这里以后，旧逻辑一直找不到稳定结果。结果不是报错退出，而是反复扫 asset。渲染进程的主线程被占住，输入事件只能排队。你会看到“先卡住，再补字”，这就是事件堆到一起后一次性回放。

这种情况最麻烦的地方在于，它看起来像网络卡顿。只看模型状态，会一直查错方向。

## 先升级，再考虑补丁

真正的修复应该来自 Codex++。只要新版明确支持 Codex `26.917.9434.0`，就把旧版卸掉或升级，别长期挂着临时补丁。

如果暂时没有可用新版本，可以用一个用户脚本把重复 asset 扫描截掉。

脚本放在仓库里：

[00-codex-asset-rescan-guard.js](../tools/codexplus/00-codex-asset-rescan-guard.js)

它不是把整个网络请求关掉，也不会修改 Codex 安装目录。它只做三件事：

1. 只在 Codex++ `1.3.0`、build `diag-20260518-1` 下启用。
2. 只拦截 `app://-/assets/*.js`，并且调用栈必须包含 `codexAppAssetUrlFromScriptText`。
3. 对这条无效扫描返回空 JavaScript，让旧兼容逻辑停止反复读文件。

其他正常请求照走。脚本还留了 `restore()`，可以手动恢复当前页面的原生 `fetch`；刷新后 guard 会重新加载。

## 安装办法

仓库里有一个 PowerShell 安装脚本：

[install-asset-rescan-guard.ps1](../tools/codexplus/install-asset-rescan-guard.ps1)

在项目目录执行：

```powershell
pwsh -File .\tools\codexplus\install-asset-rescan-guard.ps1
```

脚本会做四件事：

- 把 guard 脚本复制到 `%APPDATA%\Codex++\user_scripts`。
- 备份现有的 `user_scripts.json`。
- 打开 `user:00-codex-asset-rescan-guard.js`。
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

如果 `blockedRequests` 从零开始增长，说明确实命中了重复 asset 扫描。这通常就是卡顿来源。

如果 guard 是 `undefined`，检查三件事：

1. 脚本是否在 `%APPDATA%\Codex++\user_scripts` 下。
2. `user_scripts.json` 里是否把它设成了 `true`。
3. Codex++ 版本和 build 是否仍然完全匹配。

版本不匹配时，脚本会主动不运行。这是故意的，避免补丁套到不相关版本上。

## 还想再稳一点

先把其他用户脚本全部关掉，只留 guard，重启后试十分钟。确认卡顿消失，再逐个打开其他脚本。

我这边之前同时开了 Context Used Meter、Context Ring Restore 和 List Pagebuster。它们不一定直接造成这个循环，但都会往页面逻辑上加东西。排障时一次只开一个，变量才清楚。

还可以用 `restore()` 验证拦截是否真的在起作用：

```js
window.__codexAssetRescanGuard.restore()
```

执行后当前页面会恢复原生 `fetch`。如果卡顿马上回来，基本就能确认问题路径。

## 不要做的事

不要删 Codex 安装目录里的 `app.asar`。

不要把整个 `fetch` 网络请求全部拦掉。

不要为了旧版 Codex++ 永久锁死 Codex 更新。

也不要看到“反复扫描 asset”就认定软件有恶意。这里更像是兼容层跟不上宿主更新，属于版本适配事故。

补丁只是让旧版先能用。Codex++ 发布正式修复后，升级并删掉这个 guard，才是干净状态。

## 最后

这次卡顿的根因不复杂：

```text
旧 Codex++ 兼容逻辑
  -> 认不出新 Codex 的 asset
  -> 反复扫描 app://-/assets/*.js
  -> 渲染进程被拖住
  -> 输入框先吞字，再补字
```

对上版本、用 guard 截掉无效扫描、重启确认，问题就能先压住。

如果后面 Codex++ 出了支持 Codex `26.917.9434.0` 的版本，优先升级。临时补丁可以救命，但不该变成长期方案。

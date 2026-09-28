# Codex++ #2255 补充反馈草稿

整理日期：2026-09-28。状态：尚未发布。

目标：[BigPizzaV3/CodexPlusPlus #2255](https://github.com/BigPizzaV3/CodexPlusPlus/issues/2255)。

已有相关修复：[PR #2271](https://github.com/BigPizzaV3/CodexPlusPlus/pull/2271)，2026-09-22 合并，merge commit 为 `545de2c3f4c2e9119f51b68110f78ed5c07b31ba`。本稿补充版本和症状，不声称发现了新的根因，也不声称已合并修复无效。

## 待发布内容

补充一组 Windows 上的症状和版本，供后续发布与验证参考：

```text
Codex++: 1.3.0
build: diag-20260518-1
OpenAI.Codex: 26.917.9434.0
```

使用中遇到输入框间歇性不刷新：打字暂时不显示，过几秒再一起出现，较长会话里尤其明显。发生在输入阶段，消息还没发出。

查到本 issue、#2256 和已合并的 #2271 后，对照了 `v1.3.0` 和当前主分支源码：旧版 `noteAppServerModelRequestPatchMiss` 的 provider 分支确实会提前返回，绕过后面的 `maxMisses` 判断；当前主分支已有次数限制和重试退避。感谢 @dongyu23 和维护者处理这条路径。

这条补充的证据边界也说明一下：

- 没有保留这台机器的完整 CPU profile 或定时 fetch 计数，不能把相似症状当成独立确认的同根因复现。
- 尚未在 `26.917.9434.0` 上运行包含 #2271 的构建，本反馈不是说这个 PR 修复后仍然有问题。
- 2026-09-28 查询正式 Releases，latest 仍为 2026-09-10 发布的 `v1.3.0`，早于 9 月 22 日的修复合并。

之前本地使用过一份临时用户脚本绕过扫描路径，代码和限制已公开：

- [用户脚本](https://github.com/superalp1985/-/blob/main/tools/codexplus/00-codex-asset-rescan-guard.js)
- [排查记录与上游进展](https://github.com/superalp1985/-/blob/main/articles/Codex%2B%2B1.3.0%E5%8D%A1%E9%A1%BF%E6%8E%92%E6%9F%A5%E4%B8%8E%E4%BF%AE%E5%A4%8D.md)

这份脚本不适合作为上游修复：除了拦截特定调用栈下的 asset fetch，还会写入 app-server、service tier、dictation 的“已安装”标记，可能跳过相关适配；`restore()` 不会还原这些标记。它只检查 Codex++ 版本和 build，没有检查宿主版本，回滚需要停用脚本并完整重启。

想请维护者在包含 #2271 的正式版本发布说明里标注这条修复，以及“有界失败后停止该层适配、不代表所有新宿主接口都已适配”的限制。这样遇到相同现象的用户能区分“主分支已修复”和“安装包已包含修复”，也方便停用这类临时脚本后再验证。

## 发布前核对

- 重新检查 #2255 / #2256 的后续回复和最新 Release，避免重复已解决的问题。
- 只发布上方“待发布内容”，不要包含此草稿的状态说明。
- 不附本机会话内容、账户配置、密钥、完整日志或个人路径。
- 登录 GitHub 后再提交；不能把本地写好草稿视为已经向上游反馈。

# Changelog

本插件的版本历史。语义化版本（[SemVer](https://semver.org/lang/zh-CN/)）。

## [1.0.0] - 2026-08-16

**首次公开发布**。功能与稳定性达到正式发布标准，包含完整的后台触发机制与宿主崩溃防护。

### Added

- 会话头部铃铛：通知总开关 + 音量滑块（0–100%），实时落盘 `~/.dsh/dsh-notify.json`
- 通知类型：回合完成（仅后台）、回合出错（仅后台）、目标完成（仅后台）、`ask_user_question`（始终）、`approval/asked`（始终）
- 仅后台触发：web 页面可见性 + 桌面壳窗口焦点双通道上报，`foreground = page || shell`
- 双语文案：跟随 Windows 显示语言（zh / en）
- 同会话 5 秒去重、回合完成 800ms 空闲去抖、subagent 会话跳过
- HTTP API：`GET/POST /dsh-notify/config`、`GET/POST /dsh-notify/foreground`（同源校验、原子写盘）
- `notifications` 总开关：关闭后所有通知静默

### Fixed

- **宿主 `apply()` 启动崩溃**：`ReferenceError: webCtx is not defined`——前台状态路由注册块被误置于 `ctx.inject(['webServer'], ...)` 回调之外；已移回回调内，两个路由均在 `webServer` 就绪后注册
- client 端改为 DSH client-bundle 产物格式（`window.__ModuleLoader__.load({ id, factory })`），修复浏览器端 "loaded without registering"

### Changed

- 与 dsh-startup-guard 协作：guard v2 的宿主冒烟（`apply()` 执行检查）+ 崩溃隔离（启动崩溃时下次启动自动禁用本插件而非死循环）
- **冗余清理**（行为不变）：两个 HTTP 路由共享 `sendJson`/`sendText`/`readJsonBody` helper；移除 4 个未被引用的图标文件（仅保留 `dsh.ico`）
- **修复：toast 快捷方式改名**为 "DeepSeek Harness Notify.lnk"——原与桌面应用安装器创建的 "DeepSeek Harness.lnk" 同名，会劫持应用自己的开始菜单入口
- **修复：toast 点击目标校验**——activate.ps1 仅允许打开指向本机 DSH（http/https + 127.0.0.1/localhost）的地址，拒绝任意文件路径/远程地址（Start-Process 安全加固）
- **新增测试套件**（22 例）：配置读写、`isSameOrigin`、`titleOf`、`formatElapsed` 双语、`decideNotify`（总开关/前台抑制/ask 例外/去重）、`buildNotifyArgs`（参数构造）、apply 事件接线（spawn 间谍：done/error/ask/审批/目标完成/subagent 跳过/前台抑制/去重）、两个 HTTP 路由（GET/POST/400/403/405/持久化）；为此将纯决策/参数逻辑抽出为可测函数并加 `__setSpawnForTests` 测试钩子（生产行为不变）

## [0.1.2] - 2026-08-16（内部预发布）

- client 重建为 `__ModuleLoader__.load` 产物格式（引入 1.0.0 修复的宿主侧回归点，已修复）

## [0.1.1] - 2026-08-15（内部预发布）

- 前后台判断基础框架（`pageActive` / `shellActive` 内存态、前台静默、ask/approval 例外）

## [0.1.0] - 2026-08-13（内部预发布）

- 初始实现：对话完成 / 出错 / 目标完成通知、铃铛 UI、配置热更新

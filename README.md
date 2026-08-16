# 🔔 dsh-notify

简体中文 | [English](README.en.md)

> DeepSeek Harness 对话完成通知插件 —— 回合完成、出错、目标完成、提问、审批时，在你**离开应用**时弹出 Windows 通知（toast + 提示音），前台自动静默。零配置，会话头部铃铛即控制中心。

![Check](https://github.com/aokamoaki/dsh-notify/actions/workflows/check.yml/badge.svg) ![version](https://img.shields.io/badge/version-1.0.0-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D22.13-339933) ![dsh](https://img.shields.io/badge/DSH-web-4d6bfe) ![tests](https://img.shields.io/badge/tests-22%20passed-brightgreen)

---

## 📖 简介

在 DeepSeek Harness（DSH）里跑长任务时，你常常切去别的窗口。dsh-notify 会在对话回合结束、出错、目标达成时用 Windows 原生 toast + 提示音提醒你，**只在应用处于后台时打扰**：页面可见或桌面壳任一窗口聚焦时，完成类通知自动静默；而「需要你回来操作」的提问 / 审批类通知**始终提醒**——那正是要打断你的场景。

## ✨ 功能特性

- 🔔 **会话头部铃铛**：通知总开关（点击静音/恢复）+ 音量滑块（0–100%），实时落盘
- 🛌 **仅后台触发**：web 页面可见 **或** 桌面壳任一窗口聚焦时，完成类通知静默
- ⚠️ **提问/审批始终提醒**：`ask_user_question`、`approval/asked` 不因前台而静默
- 🔇 **总开关**：关闭后所有通知（含提问/审批）全部静默，重启仍生效
- 🌐 **双语**：toast 文案跟随 Windows 显示语言（中文 / English）
- ⚙️ **零配置起步**，配置文件热更新，无需重启
- 🧵 **智能去重**：同会话 5 秒内不重复打扰；回合完成仅在 agent 保持空闲时提醒（800ms 去抖）；subagent 内部会话不通知

## 📦 安装

```bash
dsh plugin --profile web add github:aokamoaki/dsh-notify
```

重启 `dsh web` 生效。

**本地开发（link 方式）**：把仓库放到任意目录，然后在 profile 的 `package.json` 中以 link 引入：

```json
"dependencies": { "dsh-notify": "link:C:/path/to/dsh-notify" }
```

并确保 `dsh.profile.bundles` 含 `"dsh-notify"`。

## 🚀 快速开始

安装并重启后**无需任何配置**即生效。默认行为：

- 对话回合完成 → 「对话」完成 · 耗时（仅后台）
- 回合出错 → 「对话」出错 · 耗时（仅后台）
- 目标完成 → 目标完成（仅后台）
- agent 提问（`ask_user_question`）→ 需要你选择（始终）
- 审批请求（`approval/asked`）→ 需要你批准 : 工具名（始终）

不想被打扰？点会话头部的 🔔 铃铛即可一键静音，悬停可调音量。

## ⚙️ 配置

配置文件：`~/.dsh/dsh-notify.json`（不存在时用默认值；铃铛操作实时写回）。

| 字段 | 默认 | 说明 | 控制入口 |
| :-- | :-- | :-- | :-- |
| `notifications` | `true` | 通知总开关（关 = 全部静默） | 铃铛点击 |
| `volume` | `1` | 提示音音量 0–1 | 铃铛滑块 |
| `sound` | `true` | 提示音开关 | 配置文件 |
| `toast` | `true` | 系统弹窗（toast）开关 | 配置文件 |
| `serviceNotify` | `true` | 服务类通知开关（桌面壳读取） | 配置文件 |

## 📡 HTTP API

| 端点 | 方法 | 说明 |
| :-- | :-- | :-- |
| `/dsh-notify/config` | GET | 读取当前配置 |
| `/dsh-notify/config` | POST | 局部更新配置（`{"volume": 0.5}`），原子写盘 |
| `/dsh-notify/foreground` | GET | 前台状态快照（`{page, shell, foreground}`） |
| `/dsh-notify/foreground` | POST | 上报前台状态（`{"page": bool}` 页面 / `{"shell": bool}` 桌面壳） |

> 所有端点仅接受同源请求（`sec-fetch-site` 校验），非浏览器来源会被拒绝。

## 🏗️ 架构

```
web 页面 (lib/client.js)  ──visibilitychange / focus──►  POST /dsh-notify/foreground {page}
桌面壳 (Electron)         ──任意窗口 focus/blur──────►  POST /dsh-notify/foreground {shell}
                                                              │ 合并：foreground = page || shell
宿主插件 (lib/index.js)  ──notify()──┐                        ▼
   session/event、goal/changed 事件  │   done/error/goal 前台静默、ask 始终弹
                                    └─► notify.ps1 ──► Windows toast + 提示音
```

- **host**（`lib/index.js`）：事件驱动；配置 / 前台状态 API；`notify()` 读取配置 → 调用 `notify.ps1`
- **client**（`lib/client.js`）：会话头部铃铛 UI；页面可见性 / 焦点上报
- **notify.ps1**：toast 与提示音执行器（`-SoundType done|error|ask`、`-Volume`、`-NoSound`、`-NoToast`）
- 前台状态为内存态（不落盘）；初始态为后台，确保上报链路故障时**不会静默吞掉通知**

## 🔌 兼容性

- 平台：Windows（toast 经 PowerShell + Windows 通知）
- DSH：web 版（`dsh web`），桌面壳可选（上报 shell 前台状态）
- Node：`>=22.13`

## 🛠️ 开发

```
dsh-notify/
├── lib/
│   ├── index.js      # 宿主入口（事件 + API；纯决策/参数逻辑可单测）
│   ├── client.js     # 浏览器端（铃铛 UI + 前台上报）
│   ├── notify.ps1    # toast / 提示音执行器
│   └── activate.ps1  # toast 点击处理（仅打开本机 DSH 地址，安全校验）
├── test/notify.test.mjs  # 22 个用例（node:test，零依赖，spawn 注入间谍）
├── cordis.patch.yml  # bundle 注册
└── package.json
```

**client 构建约束**：`lib/client.js` 必须是 DSH client-bundle 产物格式——
`window.__ModuleLoader__.load({ id, factory })`，**禁止** import / JSX。修改后保持该包装结构，否则浏览器加载会报 "loaded without registering"。

验证：

```bash
npm run check        # node --check lib/index.js lib/client.js
npm test             # 22 个用例（配置/决策/事件接线/HTTP 路由；不真起 powershell）
npm run pack:check   # 发布包内容检查
```

运行时 API 自检：`curl http://127.0.0.1:3080/dsh-notify/config`。

## 🩺 故障排查

| 现象 | 处理 |
| :-- | :-- |
| 完全收不到通知 | 检查 `~/.dsh/dsh-notify.json` 的 `notifications`/`sound`/`toast` 是否被关闭；页面是否处于可见状态（前台静默是设计行为） |
| 前台也弹通知 | 上报链路可能中断（`/dsh-notify/foreground` 被同源校验拦截）；刷新页面后应恢复 |
| 铃铛不见了 / GUI 启动异常 | 若 dsh-startup-guard 检测到本插件损坏会**自动禁用**并在 `cordis.patch.yml` 追加 `disabled: true`（附原因注释）；修复源码后删除该条目并重启即可 |
| 通知延迟 | 回合完成类有 800ms 去抖 + 空闲判断；同会话 5 秒去重 |

## 📄 许可

[MIT](./LICENSE)

---

*DeepSeek Harness 社区插件，与 DeepSeek 官方无关。*

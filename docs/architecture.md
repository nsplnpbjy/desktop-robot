# 架构说明

## 进程与窗口

Electron 采用标准的「主进程 + 隔离渲染进程」结构：

- **主进程**：配置文件、对话状态、LLM 请求、代理、日志、托盘、窗口管理。
- **小机窗口**：透明、无边框、置顶。只负责显示 GIF 和气泡，接收主进程的宠物状态/气泡事件，拖拽时调用主进程移动窗口。
- **聊天窗口**：显示历史与消息，管理输入和逐字显示；对话上下文的主副本在主进程。
- **设置窗口**：编辑原始 YAML，调用主进程校验、保存、重载和测试连接。

所有窗口都启用：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 独立的最小 preload 白名单
- CSP，且渲染进程没有 `connect-src`
- 导航/新窗口拦截
- 麦克风、摄像头、通知等权限默认拒绝

## 配置生命周期

```text
resolveConfigPath()
  → 读取 YAML
  → 与默认值合并（仅补缺，不覆盖用户值）
  → 校验、规范化 provider 类型
  → 解析动画路径、检查文件
  → 生成脱敏的 public config + settings meta

启动阶段：构建窗口、托盘、IPC、会话
运行阶段：
  fs.watchFile(config.yaml) ──┐
  设置窗口保存 ──────────────┼→ parse/validate → applyLoadedConfig()
  资源目录热加载 ────────────┘                   ├─ setProxy
                                                  ├─ 更新尺寸/置顶
                                                  ├─ 重建资源 watcher
                                                  ├─ 应用登录自启动
                                                  ├─ 广播 config-changed
                                                  └─ 保留当前对话
```

保存失败时，设置窗口只显示错误，磁盘文件保持不变。外部文件变坏时，运行中的实例保留最后一份可用配置，并向聊天/设置广播错误状态；继续修复后再次保存即可恢复。

窗口位置和可选对话历史是运行时状态，不属于「行为配置」，分别保存在 `<userData>/window-state.json` 与 `<userData>/conversation.json`。

## 对话流程

```text
chat renderer
  └─ api.sendMessage(text)  [IPC, role=chat]
       └─ ChatService.sendMessage()
            ├─ 校验配置和长度；标记 busy
            ├─ conversation.add('user', text)
            ├─ 广播 pet-state=thinking（聊天关闭时显示思考气泡）
            ├─ llm/index.js → active provider adapter → Electron net.fetch
            ├─ conversation.add('assistant', reply)
            └─ 广播 pet-state=talking + 回复气泡（聊天关闭时）
                 └─ renderer 显示完整消息并调用 replyFinished 归位
```

失败时：

- 主进程返回结构化的 `{code, message, hint, detail}`；
- 小机进入 `error` 状态，聊天显示错误卡片；
- 失败的用户消息保留在上下文中，方便用户继续表述；不保存伪造的助手消息；
- 不会把 API Key、请求头或完整请求体写进日志。

所有 provider 原生请求都由主进程发起。`net.fetch` 使用 Electron 默认 session，因此 `session.setProxy()` 的配置对模型请求生效。动画渲染不经过网络。

## LLM 适配器

`src/main/llm/index.js` 根据 `provider.type` 分发：

| type | 实现 | 协议 |
| --- | --- | --- |
| `openai-compatible` | `providers/openai-compatible.js` | `/chat/completions` |
| `openclaw` | 复用 OpenAI 兼容实现 | 额外 `x-openclaw-agent-id`、可选 `user` |
| `anthropic` | `providers/anthropic.js` | `/messages`，system 独立，content block 解析 |
| `gemini` | `providers/gemini.js` | `:generateContent`，contents/systemInstruction |

适配器接收注入的 `fetchImpl`，测试中使用本地 HTTP 服务和 Node `fetch`，生产中使用 Electron `net.fetch`。请求错误统一映射为 `LlmError`，并在 `publicError()` 中做脱敏。

## IPC 边界

所有 IPC 通道都在主进程按窗口角色校验来源，preload 只暴露函数白名单，不暴露 `ipcRenderer`。

主要通道：

- 小机：`pet:get-bootstrap`、`pet:toggle-chat`、`pet:context-menu`、`pet:drag-start`、`pet:drag-end`
- 聊天：`chat:get-bootstrap`、`chat:send`、`chat:reset`、`chat:close`、`chat:open-settings`、`chat:voice-reserved`、`chat:reply-finished`
- 设置：`settings:get`、`settings:save`、`settings:reload`、`settings:test`、`settings:open-file/folder`
- 主进程事件：`app:event`，包含 `config-changed`、`pet-state`、`pet-bubble`、`chat-visible`

## 窗口定位与拖动

- 首次位置由 `window.startPosition` 和 `window.margin` 决定，放在鼠标所在显示器的工作区。
- 位置记忆启用时，拖动结束后写 `window-state.json`，并校验目标位置与显示器有足够交集。
- 拖动使用主进程 16ms 游标轮询 + `BrowserWindow.setPosition()`，避免 `-webkit-app-region: drag` 吞掉点击事件。
- 聊天窗口打开时优先放在小机左侧；如果空间不足则放右侧，并始终限制在工作区内。
- 显示器变化时会重新校准窗口，保证可找回。

## 形象资源

GIF 通过 `file://` URL 直接加载，附带 mtime query 用于热更新绕过缓存。公共配置只包含资源 URL 和存在状态，不向渲染层暴露配置中的 API Key。若 GIF 加载失败，渲染层回退到 `appearance.fallbackImage`，再失败则显示 CSS 占位机器人。

## 测试策略

- `tests/config.test.js`：合法/非法配置、路径、密钥脱敏、API Key 环境变量。
- `tests/proxy.test.js`：模式、URL 清洗、认证优先级、Electron session 调用。
- `tests/conversation.test.js`：裁剪、角色顺序、持久化。
- `tests/llm.test.js`：四类 provider 的请求形状、响应解析、错误映射和脱敏。
- `scripts/check-project.js`：文件、GIF、配置可用性。
- 开发时还可用 `scripts/mock-openclaw.js` 与真实 Electron 窗口做端到端 UI 验证。

## 设计取舍

- **不引入前端框架/打包器**：v0.1 使用原生 HTML/CSS/JS，减少构建链和攻击面，便于直接阅读与替换。
- **非流式模型请求**：先换取更简单、统一的多 provider 错误处理；界面使用逐字动画保持反馈。后续可在适配器层增加 SSE。
- **配置即产品**：没有第二套隐藏设置系统；YAML 是唯一事实来源，设置窗口只是编辑器和校验器。
- **语音先留边界**：在模型尚未具备条件时，确保不请求权限、不产生假能力，同时保留 UI 与主进程服务接口。

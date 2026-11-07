# 配置参考

所有行为配置都来自 YAML 文件。默认文件是 `config/config.yaml`，模板是 `config/config.example.yaml`。

配置文件路径的优先级：

1. 命令行 `--config <path>`
2. 环境变量 `DESKTOP_ROBOT_CONFIG`
3. 开发运行时：项目内 `config/config.yaml`
4. 打包运行时：`<userData>/config.yaml`（首次启动从模板复制）

保存后应用会热加载。外部修改文件也会被监听；如果写入的 YAML 无效，应用会保留上一份可用配置并在聊天/设置中显示错误，不会崩溃。

## 路径与插值

- `${APP_DIR}`：应用目录。
- `${CONFIG_DIR}`：配置文件所在目录。
- `appearance.animationsDir` 及其中的 GIF 文件名可使用绝对路径或相对路径；相对路径以配置文件目录为基准（GIF 文件名相对 `animationsDir`）。
- `baseUrl` 必须是 `http://` 或 `https://` URL。

## 顶层字段

### `version`

当前固定为 `1`。

### `app`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `launchAtLogin` | bool | `false` | 登录系统后自动启动。开发模式下会以 Electron + 项目路径启动，建议打包后再使用。 |

### `logging`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `level` | `debug/info/warn/error/silent` | `info` | 日志级别。 |
| `file` | bool | `true` | 是否写入 `<userData>/logs/desktop-robot.log`。 |

日志会自动脱敏 key/token/password/authorization 字段。

### `development`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `openDevTools` | bool | `false` | 创建小机/聊天窗口时打开开发者工具。 |

### `window`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `pet.width` | int 300–900 | `380` | 小机窗口宽度。 |
| `pet.height` | int 360–1000 | `460` | 小机窗口高度。 |
| `chat.width` | int 360–1000 | `440` | 聊天窗口宽度。 |
| `chat.height` | int 460–1000 | `650` | 聊天窗口高度。 |
| `startPosition` | enum | `bottom-right` | 首次出现位置：`bottom-right`、`bottom-left`、`top-right`、`top-left`、`center`。 |
| `margin` | int 0–200 | `24` | 首次出现位置距离屏幕工作区边缘的像素。 |
| `rememberPosition` | bool | `true` | 手动拖动后是否记忆位置（写入 `<userData>/window-state.json`）。 |
| `alwaysOnTop` | bool | `true` | 小机和聊天窗口是否置顶。 |
| `showInTaskbar` | bool | `false` | 小机是否出现在任务栏；聊天窗口是辅助面板，始终不占用任务栏，设置窗口始终显示任务栏入口。 |
| `openChatOnStart` | bool | `false` | 启动后自动打开聊天。 |
| `closeChatOnEscape` | bool | `true` | 聊天窗口按 Esc 关闭。 |

### `appearance`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `animationsDir` | string | `${APP_DIR}/assets/animations` | GIF 目录。 |
| `animations.<state>` | string | 各状态文件名 | 可选状态：`idle`、`thinking`、`talking`、`happy`、`error`、`listening`。文件名为相对 `animationsDir` 的路径，或绝对路径。 |
| `fallbackImage` | string | `${APP_DIR}/assets/icons/robot.png` | GIF 缺失/加载失败时的静态图。 |
| `watchAnimations` | bool | `true` | 监听动画目录变化并热加载。 |
| `accentColor` | `#RRGGBB` | `#2FAF9F` | UI 强调色。 |
| `bubbleDurationMs` | int 1000–60000 | `6500` | 小机气泡默认显示时长。 |
| `bubbleMaxChars` | int 20–500 | `120` | 气泡文字最大长度。 |
| `showReplyBubble` | bool | `true` | 聊天窗口关闭时，是否在小机头顶显示回复摘要。 |

### `persona`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 角色名字，用于窗口、聊天界面和气泡。 |
| `greeting` | string | 首次/空对话时的欢迎语。 |
| `inputPlaceholder` | string | 输入框占位文字。 |
| `systemPrompt` | string | 发送给模型的 system prompt。 |
| `thinkingText` | string | 等待回复时小机的气泡文字（聊天关闭时显示）。 |
| `errorText` | string | 请求失败时小机的气泡文字。 |
| `voiceReservedText` | string | 点击语音预留按钮时的提示。 |

### `chat`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `maxHistoryMessages` | int 2–100 | `24` | 发送给模型的最近消息条数；会自动从用户消息开始裁剪。 |
| `maxInputChars` | int 1–20000 | `4000` | 单条输入上限。 |
| `temperature` | number 0–2 | `0.8` | 全局温度；可被 provider 覆盖。 |
| `maxOutputTokens` | int 1–32000 | `800` | 输出 token 上限；可被 provider 覆盖。 |
| `timeoutMs` | int 1000–300000 | `90000` | 请求超时；可被 provider 覆盖。 |
| `persistHistory` | bool | `false` | 是否把上下文保存在本机 `<userData>/conversation.json`。 |

### `llm`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `activeProvider` | string | 必须等于 `providers` 下的一个 key。 |
| `providers` | map | 供应商集合。 |

每个 provider：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | enum | 是 | `openai-compatible`、`openclaw`、`anthropic`、`gemini`。旧别名 `openai`、`claude`、`google` 会被规范化。 |
| `baseUrl` | URL | 是 | API 根地址。例如 `https://api.openai.com/v1`。 |
| `model` | string | 是 | 模型名。OpenClaw 使用 `/v1/models` 返回的 ID（如 `openclaw/main`）；部分版本也接受 `openclaw:<agentId>`。 |
| `displayName` | string | 否 | UI 中显示的名称，默认使用 provider key。 |
| `apiKey` | string | 否 | 内联 API Key。 |
| `apiKeyEnv` | string | 否 | 从环境变量读取 API Key；若变量有值，优先于 `apiKey`。 |
| `requiresApiKey` | bool | 否 | 为 `true` 时缺少 Key 会在配置提醒中提示；Anthropic/Gemini 默认按需要处理。 |
| `headers` | map | 否 | 额外请求头。值会转换为字符串。 |
| `extraBody` | map | 否 | 合并进请求体的额外参数。 |
| `temperature` | number | 否 | 覆盖全局温度。 |
| `maxOutputTokens` | int | 否 | 覆盖全局输出上限。 |
| `timeoutMs` | int | 否 | 覆盖全局超时。 |
| `maxTokensParam` | string | 否 | OpenAI 兼容请求里的 token 字段名，默认 `max_tokens`。 |
| `anthropicVersion` | string | 否 | Anthropic `anthropic-version`，默认 `2023-06-01`。 |
| `agentId` | string | 否 | 仅 OpenClaw；作为 `x-openclaw-agent-id` 请求头。模型已包含 agent 时可留空。 |
| `sessionUser` | string | 否 | 仅 OpenClaw；作为请求体 `user`，让 Gateway 复用同一会话。 |

所有请求都只在主进程发起。应用会把用户/助手消息规整为交替角色，并合并连续同角色消息。

### `network.proxy`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | `direct/system/manual` | `direct` | 代理模式。 |
| `url` | string | `http://127.0.0.1:7890` | `manual` 时的代理地址，支持 HTTP/HTTPS/SOCKS4/SOCKS5。只使用协议+主机+端口，路径和 URL 内嵌认证会被忽略/剥离。 |
| `bypass` | string | `localhost,127.0.0.1,::1,<local>` | Chromium 的绕过规则，逗号分隔。 |
| `username` | string | `""` | 代理账号。 |
| `password` | string | `""` | 代理密码。 |
| `usernameEnv` | string | `""` | 从环境变量读取代理账号。 |
| `passwordEnv` | string | `""` | 从环境变量读取代理密码。 |

显式字段 > 环境变量 > URL 内嵌认证。代理账号不会出现在 UI 或日志中。保存配置后会重新设置 Electron session 代理并关闭旧连接。

### `voice`

当前只做结构和配置预留，所有 `available` 都是 `false`。

| 字段 | 说明 |
| --- | --- |
| `voice.enabled` | 总开关，v0.1 不生效。 |
| `voice.input.enabled` | 语音输入预留开关。 |
| `voice.input.provider` | 预留 provider 名称；`disabled` 表示未实现。 |
| `voice.input.endpoint` / `apiKeyEnv` / `model` / `language` / `maxSeconds` | 未来 ASR 的参数位置。 |
| `voice.output.enabled` | 语音输出预留开关。 |
| `voice.output.provider` | 预留 TTS provider；`disabled` 表示未实现。 |
| `voice.output.endpoint` / `apiKeyEnv` / `model` / `voice` / `format` / `autoSpeak` | 未来 TTS 的参数位置。 |

把 voice 配置改成启用状态不会在 v0.1 中打开麦克风或播放声音，只会在设置中产生一条提醒。接入方式见 [voice.md](voice.md)。

## 配置错误处理

- 编辑后的保存会先完整解析和校验；有错误时不会覆盖磁盘文件，并显示所有错误。
- 通过外部编辑器写入无效 YAML 时，应用保留最后一份可用配置，并显示错误提示。
- 缺失 GIF 或静态图只是提醒，应用会改用备用形象。
- 修改与网络/服务相关的字段后，不需要重启应用；但若正在进行的模型请求被中断，重新发送即可。

## 测试连接

设置窗口中的「测试连接」会向当前已生效的 provider 发送一条很短的请求（最多 32 个输出 token），用于验证 baseUrl、模型、Key 和代理是否连通。它不会修改聊天上下文；如果不保存 YAML，修改不会参与测试。

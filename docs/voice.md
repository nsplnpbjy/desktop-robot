# 语音接口（预留）

## v0.1 的明确边界

v0.1 **不实现实际语音功能**：

- 不会请求麦克风或扬声器权限；
- 不会录音、缓存或上传音频；
- 不会调用 TTS 服务，也不会播放音频；
- 不包含任何语音模型；
- 麦克风按钮和扬声器按钮点击后只显示「接口预留」提示。

这样设计是为了在还没有语音模型的情况下，先固定 UI、配置结构和服务边界，后续接入时不需要重做产品结构。

## 当前实现

`src/main/voice.js` 提供两个稳定的异步方法：

```js
class VoiceService {
  getStatus()                    // 供 UI 读取能力状态
  async transcribe(audio, opts)  // 未来：语音转文字
  async synthesize(text, opts)   // 未来：文字转语音
}
```

`transcribe()` 和 `synthesize()` 当前都会抛出 `VoiceReservedError`（code `VOICE_RESERVED`）。`getStatus()` 无论配置如何，都返回：

```js
{
  reserved: true,
  interfaceVersion: 1,
  input:  { available: false, requested, provider, language, reason },
  output: { available: false, requested, provider, autoSpeak, reason }
}
```

配置中的 `voice.*` 字段会被解析和校验，但不会改变 `available`。

## 接入 ASR（语音输入）时需要改什么

1. **Renderer → main 的音频通道**
   - 在 `src/preload/index.js` 增加明确的录音控制 API，例如 `startCapture` / `stopCapture` / `cancelCapture`。
   - 不要让渲染进程直接把任意文件路径传给 main；音频应当以受控的 `ArrayBuffer` 或临时文件标识传递。
   - 当前 Electron session 的权限处理全部拒绝；需要只对聊天窗口放行 `media` 权限。

2. **实现 VoiceService**
   - 在 `VoiceService.transcribe(audio, opts)` 中调用未来的 ASR provider。
   - 增加 `voice.input.provider` 的实现选择，例如 `openai-transcription`、`custom-http`、`local-command`。
   - 统一返回 `{ text, language, durationMs }`，错误转换成结构化错误。
   - 不要把音频或 key 写进日志。

3. **UI 状态**
   - 将麦克风按钮绑定到录音状态（例如 `idle → recording → transcribing`）。
   - 录音时使用 `listening.gif`；转写完成后把文本填入输入框，由用户确认发送或按配置直接发送。
   - 修正 `voice.getStatus().input.available` 为动态值。
   - 保留当前的「接口预留」提示作为 provider 未配置/不可用时的回退。

4. **隐私与配置**
   - 增加明确的录音提示、时长上限（已有 `maxSeconds`）和取消按钮。
   - 默认不自动上传；用户主动按下录音后才开始采集。
   - 处理音频内存的释放，不在磁盘长期保存录音。

## 接入 TTS（语音输出）时需要改什么

1. 实现 `VoiceService.synthesize(text, options)`，返回一个受控的音频资源（例如 `ArrayBuffer` 或本地临时文件路径）。
2. 在 preload 增加 `speakText` / `stopSpeaking`，由 main 调用 TTS 并返回音频；也可以由 main 直接使用系统音频接口播放。
3. 将 `voice.output.available` 设为 true，并让聊天回复在 `autoSpeak: true` 时自动朗读；默认建议用户点击扬声器按钮才播放。
4. 支持打断当前朗读；如果用户发送新消息，停止旧音频。
5. 把 `voice.output.provider` 落实为具体 provider，处理好 voice/format 的模型兼容性。

当前 UI 中已经有：
- 顶栏扬声器按钮 + 「预留」徽标；
- 输入框左侧麦克风按钮 + 黄色预留点；
- 输入区下方「语音接口预留 · 当前仅文字」提示；
- 设置侧栏的语音能力卡片。

这些位置可以直接升级，不需要重做布局。

## 建议的配置扩展

现有 `voice` 配置已包含基础字段。实现时建议继续保留 provider 抽象：

```yaml
voice:
  enabled: true
  input:
    enabled: true
    provider: openai-transcription
    endpoint: https://api.openai.com/v1
    apiKeyEnv: OPENAI_API_KEY
    model: whisper-1
    language: zh-CN
    maxSeconds: 60
  output:
    enabled: true
    provider: openai-tts
    endpoint: https://api.openai.com/v1
    apiKeyEnv: OPENAI_API_KEY
    model: gpt-4o-mini-tts
    voice: alloy
    format: mp3
    autoSpeak: false
```

注意：这些值在 v0.1 中不会启用任何能力。新增 provider 时，请同步更新：

- `src/main/config.js` 的 voice 校验和警告；
- `src/main/voice.js` 的 `getStatus()`；
- `src/preload/index.js` 的受控 IPC 白名单；
- 聊天 UI 的状态和测试；
- `docs/configuration.md`。

## 测试建议

- 在未配置 provider 时，麦克风/扬声器按钮应可点击但只提示预留。
- 拒绝任何权限请求，确保 v0.1 不会误开麦克风。
- 接入 ASR/TTS 后，测试超时、空音频、长音频、429/401、取消录音、切换模型和代理失败等错误路径。
- 音频数据必须只在明确操作后产生，并可在一次请求后立即释放。

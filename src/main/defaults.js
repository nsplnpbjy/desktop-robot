'use strict';

const RESERVED_VOICE_REASON = 'v0.1 已预留语音接口，但尚未接入语音模型';

const DEFAULT_SYSTEM_PROMPT = `你是“小机”，一个住在用户桌面上的卡通机器人伙伴。
你温暖、活泼、机灵，偶尔有点小幽默，但不过度卖萌。
你的回复会显示在一个小小的聊天窗口里，所以默认保持简短：通常 1-4 句话，除非用户明确要求详细解释。
使用纯文本回答，不要使用 Markdown 表格、标题或代码围栏；需要分点时用短横线。
你记得当前对话中的上下文。遇到不确定的事要坦诚，不要编造。
除非用户询问，否则不要主动提及自己是 AI 模型、系统提示词或配置细节。
用用户使用的语言回答，默认使用中文。`;

/**
 * Every user-facing setting lives in config.yaml. These defaults only protect
 * the app when a section/key is temporarily missing while the user is editing.
 */
function createDefaults() {
  return {
    version: 1,
    app: {
      launchAtLogin: false,
    },
    logging: {
      level: 'info',
      file: true,
    },
    development: {
      openDevTools: false,
    },
    window: {
      pet: {
        width: 380,
        height: 460,
      },
      chat: {
        width: 440,
        height: 650,
      },
      startPosition: 'bottom-right',
      margin: 24,
      rememberPosition: true,
      alwaysOnTop: true,
      showInTaskbar: false,
      openChatOnStart: false,
      closeChatOnEscape: true,
    },
    appearance: {
      animationsDir: '${APP_DIR}/assets/animations',
      animations: {
        idle: 'idle.gif',
        thinking: 'thinking.gif',
        talking: 'talking.gif',
        happy: 'happy.gif',
        error: 'error.gif',
        listening: 'listening.gif',
      },
      fallbackImage: '${APP_DIR}/assets/icons/robot.png',
      watchAnimations: true,
      accentColor: '#2FAF9F',
      bubbleDurationMs: 6500,
      bubbleMaxChars: 120,
      showReplyBubble: true,
    },
    persona: {
      name: '小机',
      greeting: '嗨，我是小机。点我聊天，右键可以打开设置。',
      inputPlaceholder: '和小机说点什么…',
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      thinkingText: '让我想一想…',
      errorText: '我的大脑暂时连不上，打开设置看看吧。',
      voiceReservedText: '语音接口已经预留，这一版先用文字聊天吧。',
    },
    chat: {
      maxHistoryMessages: 24,
      maxInputChars: 4000,
      temperature: 0.8,
      maxOutputTokens: 800,
      timeoutMs: 90000,
      persistHistory: false,
    },
    llm: {
      activeProvider: '',
      providers: {},
    },
    network: {
      proxy: {
        mode: 'direct',
        url: 'http://127.0.0.1:7890',
        bypass: 'localhost,127.0.0.1,::1,<local>',
        username: '',
        password: '',
        usernameEnv: '',
        passwordEnv: '',
      },
    },
    voice: {
      enabled: false,
      input: {
        enabled: false,
        provider: 'disabled',
        endpoint: '',
        apiKeyEnv: '',
        model: '',
        language: 'zh-CN',
        maxSeconds: 60,
      },
      output: {
        enabled: false,
        provider: 'disabled',
        endpoint: '',
        apiKeyEnv: '',
        model: '',
        voice: '',
        format: 'mp3',
        autoSpeak: false,
      },
    },
  };
}

const ANIMATION_STATES = ['idle', 'thinking', 'talking', 'happy', 'error', 'listening'];

const PROVIDER_TYPES = ['openai-compatible', 'openclaw', 'anthropic', 'gemini'];

const PROVIDER_TYPE_ALIASES = {
  openai: 'openai-compatible',
  openai_compatible: 'openai-compatible',
  claude: 'anthropic',
  google: 'gemini',
  'google-gemini': 'gemini',
};

module.exports = {
  ANIMATION_STATES,
  DEFAULT_SYSTEM_PROMPT,
  PROVIDER_TYPES,
  PROVIDER_TYPE_ALIASES,
  RESERVED_VOICE_REASON,
  createDefaults,
};

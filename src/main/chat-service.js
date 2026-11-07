'use strict';

const crypto = require('node:crypto');

const { generateReply, testConnection } = require('./llm');
const { publicError } = require('./llm/errors');

function cleanReplyPreview(text, maxChars) {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function configFailure(errors) {
  const first = errors?.[0] || '配置文件尚未就绪';
  return {
    code: 'CONFIG',
    message: '配置还没有准备好',
    hint: '打开设置，修复配置中的错误并保存后再试。',
    detail: first,
  };
}

class ChatService {
  constructor({
    getState,
    conversation,
    windows,
    fetchImpl,
    logger,
    env = process.env,
  }) {
    this.getState = getState;
    this.conversation = conversation;
    this.windows = windows;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.env = env;
    this.busy = false;
    this.activeTurnId = null;
    this.turnStartedAt = 0;
    this.replyIdleTimer = null;
  }

  applyConfig(loaded) {
    if (!loaded?.config) return;
    this.conversation.setMaxMessages(loaded.config.chat.maxHistoryMessages);
    const persistPath = this.conversation.persistPath;
    this.conversation.setPersistence(Boolean(loaded.config.chat.persistHistory), persistPath);
  }

  messages() {
    return this.conversation.getMessages();
  }

  clearReplyTimer() {
    if (this.replyIdleTimer) {
      clearTimeout(this.replyIdleTimer);
      this.replyIdleTimer = null;
    }
  }

  setReplyIdleFallback(ms = 30000) {
    this.clearReplyTimer();
    this.replyIdleTimer = setTimeout(() => {
      this.replyIdleTimer = null;
      if (!this.busy) {
        this.windows.setPetState('idle');
        this.activeTurnId = null;
      }
    }, ms);
    this.replyIdleTimer.unref?.();
  }

  async sendMessage(rawText) {
    if (this.busy) {
      return {
        ok: false,
        error: {
          code: 'BUSY',
          message: '上一条消息还在处理中',
          hint: '请稍等片刻，等小机回复完再发送。',
          detail: '',
        },
      };
    }

    const state = this.getState();
    const loaded = state.loaded;
    const configStatus = state.configStatus;
    if (!loaded || configStatus?.errors?.length) {
      return { ok: false, error: configFailure(configStatus?.errors) };
    }

    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) {
      return {
        ok: false,
        error: {
          code: 'EMPTY_INPUT',
          message: '消息不能为空',
          hint: '输入一些文字再发送吧。',
          detail: '',
        },
      };
    }

    const maxInput = loaded.config.chat.maxInputChars;
    if (text.length > maxInput) {
      return {
        ok: false,
        error: {
          code: 'INPUT_TOO_LONG',
          message: `消息不能超过 ${maxInput} 个字符`,
          hint: '请缩短消息后再发送。',
          detail: '',
        },
      };
    }

    const config = loaded.config;
    const provider = loaded.providerMeta;
    const turnId = crypto.randomUUID();
    this.busy = true;
    this.activeTurnId = turnId;
    this.turnStartedAt = Date.now();
    this.conversation.add('user', text);

    this.clearReplyTimer();
    this.windows.setPetState('thinking');
    if (!this.windows.isChatVisible()) {
      this.windows.showBubble(config.persona.thinkingText, 'thinking');
    }

    this.logger.info('LLM request started', {
      provider: provider?.name,
      type: provider?.type,
      model: provider?.model,
      inputChars: text.length,
      historyMessages: this.conversation.size,
    });

    try {
      const result = await generateReply({
        config,
        messages: this.conversation.getMessages(),
        systemPrompt: config.persona.systemPrompt,
        fetchImpl: this.fetchImpl,
        env: this.env,
      });

      this.conversation.add('assistant', result.text);
      this.logger.info('LLM request succeeded', {
        provider: result.providerName,
        model: result.model,
        latencyMs: result.latencyMs,
        replyChars: result.text.length,
      });

      this.windows.setPetState('talking', {
        durationMs: Math.max(3500, Math.min(9000, result.text.length * 45)),
      });
      if (!this.windows.isChatVisible() && config.appearance.showReplyBubble) {
        this.windows.showBubble(
          cleanReplyPreview(result.text, config.appearance.bubbleMaxChars),
          'reply',
          Math.max(config.appearance.bubbleDurationMs, 3500),
        );
      }
      this.setReplyIdleFallback(45000);

      return {
        ok: true,
        turnId,
        reply: result.text,
        provider: {
          name: result.providerName,
          displayName: result.providerDisplayName,
          type: result.providerType,
          model: result.model,
        },
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      const exposed = publicError(error);
      this.logger.error('LLM request failed', {
        provider: provider?.name,
        code: exposed.code,
        status: exposed.status,
        message: exposed.message,
        detail: exposed.detail,
        elapsedMs: Date.now() - this.turnStartedAt,
      });

      this.windows.setPetState('error', { durationMs: 6000 });
      if (!this.windows.isChatVisible()) {
        this.windows.showBubble(config.persona.errorText, 'error', 6000);
      }

      return { ok: false, error: exposed, turnId };
    } finally {
      this.busy = false;
    }
  }

  notifyReplyFinished(turnId) {
    if (!turnId || this.activeTurnId !== turnId || this.busy) return { ok: false };
    this.clearReplyTimer();
    this.windows.setPetState('idle');
    this.activeTurnId = null;
    return { ok: true };
  }

  async resetConversation() {
    if (this.busy) {
      return {
        ok: false,
        error: {
          code: 'BUSY',
          message: '小机还在回复中',
          hint: '等回复结束后再开始新对话。',
          detail: '',
        },
      };
    }
    this.clearReplyTimer();
    this.activeTurnId = null;
    this.conversation.clear();
    this.windows.setPetState('happy', { durationMs: 1400 });
    this.logger.info('Conversation reset');
    return { ok: true };
  }

  async testConnection() {
    const state = this.getState();
    const loaded = state.loaded;
    if (!loaded || state.configStatus?.errors?.length) {
      return { ok: false, error: configFailure(state.configStatus?.errors) };
    }
    if (this.busy) {
      return {
        ok: false,
        error: {
          code: 'BUSY',
          message: '小机正在回复消息',
          hint: '等当前回复结束后再测试连接。',
          detail: '',
        },
      };
    }

    try {
      const result = await testConnection({
        config: loaded.config,
        fetchImpl: this.fetchImpl,
        env: this.env,
      });
      this.logger.info('Provider connection test succeeded', {
        provider: result.providerName,
        latencyMs: result.latencyMs,
      });
      return { ok: true, ...result };
    } catch (error) {
      const exposed = publicError(error);
      this.logger.warn('Provider connection test failed', {
        code: exposed.code,
        status: exposed.status,
        message: exposed.message,
        detail: exposed.detail,
      });
      return { ok: false, error: exposed };
    }
  }

  showVoiceReserved() {
    const state = this.getState();
    const text = state.loaded?.config?.persona?.voiceReservedText ||
      '语音接口已经预留，这一版先用文字聊天吧。';
    this.windows.showBubble(text, 'voice', 4500);
    return { ok: true, reserved: true };
  }
}

module.exports = {
  ChatService,
  cleanReplyPreview,
};

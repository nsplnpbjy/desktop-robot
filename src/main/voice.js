'use strict';

const { RESERVED_VOICE_REASON } = require('./defaults');

class VoiceReservedError extends Error {
  constructor(kind) {
    const label = kind === 'output' ? '语音输出' : '语音输入';
    super(`${label}接口已预留，但 v0.1 未接入语音模型。`);
    this.name = 'VoiceReservedError';
    this.code = 'VOICE_RESERVED';
    this.kind = kind;
  }
}

/**
 * Stable boundary for a future ASR/TTS implementation.
 *
 * The renderer intentionally has no microphone permission and the main process
 * never captures or sends audio in v0.1. A future provider should implement
 * transcribe() and/or synthesize() here, then flip the capabilities returned by
 * getStatus() to available. See docs/voice.md.
 */
class VoiceService {
  constructor({ getConfig }) {
    this.getConfig = getConfig;
  }

  getStatus() {
    const config = this.getConfig();
    const voice = config?.voice ?? {};
    const inputProvider = voice.input?.provider ?? 'disabled';
    const outputProvider = voice.output?.provider ?? 'disabled';

    return {
      reserved: true,
      interfaceVersion: 1,
      reason: RESERVED_VOICE_REASON,
      input: {
        requested: Boolean(voice.enabled && voice.input?.enabled),
        available: false,
        provider: inputProvider,
        language: voice.input?.language ?? 'zh-CN',
        reason: RESERVED_VOICE_REASON,
      },
      output: {
        requested: Boolean(voice.enabled && voice.output?.enabled),
        available: false,
        provider: outputProvider,
        autoSpeak: Boolean(voice.output?.autoSpeak),
        reason: RESERVED_VOICE_REASON,
      },
    };
  }

  async transcribe() {
    throw new VoiceReservedError('input');
  }

  async synthesize() {
    throw new VoiceReservedError('output');
  }
}

module.exports = {
  VoiceReservedError,
  VoiceService,
};

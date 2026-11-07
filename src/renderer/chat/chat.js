'use strict';

const api = window.desktopRobot;

const els = {
  body: document.body,
  titlebar: document.getElementById('titlebar'),
  botName: document.getElementById('bot-name'),
  providerLine: document.getElementById('provider-line'),
  providerLabel: document.getElementById('provider-label'),
  presence: document.getElementById('presence'),
  headerAvatar: document.getElementById('header-avatar'),
  conversation: document.getElementById('conversation'),
  welcome: document.getElementById('welcome'),
  welcomeAvatar: document.getElementById('welcome-avatar'),
  welcomeTitle: document.getElementById('welcome-title'),
  welcomeText: document.getElementById('welcome-text'),
  thread: document.getElementById('thread'),
  configBanner: document.getElementById('config-banner'),
  configBannerText: document.getElementById('config-banner-text'),
  bannerSettings: document.getElementById('banner-settings'),
  input: document.getElementById('input'),
  composer: document.getElementById('composer'),
  send: document.getElementById('send'),
  mic: document.getElementById('mic'),
  voiceOutput: document.getElementById('voice-output'),
  newChat: document.getElementById('new-chat'),
  settings: document.getElementById('settings'),
  close: document.getElementById('close-chat'),
  toast: document.getElementById('toast'),
  charCount: document.getElementById('char-count'),
  voiceStatusText: document.querySelector('.voice-status'),
};

const RELATIVE_AVATAR = '../../../assets/icons/avatar.png';
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

let config = null;
let threadMessages = [];
let sending = false;
let booted = false;
let bootFailed = false;
let configBlocked = false;
let composing = false;
let toastTimer = null;
let pendingEvents = [];
let avatarUrl = RELATIVE_AVATAR;
const typewriters = new Set();

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return { r: 47, g: 175, b: 159 };
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function relativeLuminance({ r, g, b }) {
  const convert = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * convert(r) + 0.7152 * convert(g) + 0.0722 * convert(b);
}

function showToast(text, durationMs = 2800) {
  if (!text) return;
  els.toast.textContent = text;
  els.toast.classList.add('is-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    els.toast.classList.remove('is-visible');
  }, durationMs);
}

function isNearBottom() {
  return els.conversation.scrollHeight - els.conversation.scrollTop - els.conversation.clientHeight < 140;
}

function scrollToBottom({ smooth = false } = {}) {
  const behavior = smooth && !REDUCED_MOTION.matches ? 'smooth' : 'auto';
  els.conversation.scrollTo({ top: els.conversation.scrollHeight, behavior });
}

function updateWelcome() {
  const hasMessages = threadMessages.length > 0;
  els.welcome.classList.toggle('is-hidden', hasMessages);
}

function setAvatarSources(url) {
  avatarUrl = url || RELATIVE_AVATAR;
  for (const image of document.querySelectorAll('#header-avatar, #welcome-avatar, .message-avatar img')) {
    image.src = avatarUrl;
  }
}

function applyConfig(nextConfig) {
  if (!nextConfig) return;
  config = nextConfig;
  const { r, g, b } = hexToRgb(config.appearance?.accentColor);
  const brightAccent = relativeLuminance({ r, g, b }) > 0.48;
  document.documentElement.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.15)`);
  document.documentElement.style.setProperty('--accent-deep', brightAccent ? '#3c4b3d' : '#1f6e63');
  document.documentElement.style.setProperty('--on-accent', brightAccent ? '#17322c' : '#f8fffc');

  const name = config.persona?.name || '小机';
  document.title = `和${name}聊天`;
  els.botName.textContent = name;
  els.welcomeTitle.textContent = `你好，我是${name}`;
  els.welcomeText.textContent = config.persona?.greeting || '';
  els.input.placeholder = config.persona?.inputPlaceholder || '和小机说点什么…';
  els.input.maxLength = config.chat?.maxInputChars || 4000;

  setAvatarSources(RELATIVE_AVATAR);

  for (const label of document.querySelectorAll('.message-author[data-assistant="true"]')) {
    label.textContent = name;
  }

  const provider = config.provider;
  const errors = config.config?.errors || [];
  const warnings = config.config?.warnings || [];
  configBlocked = errors.length > 0 && !bootFailed;
  els.body.classList.toggle('is-config-blocked', configBlocked);

  if (errors.length) {
    els.providerLabel.textContent = '配置需要修复';
    els.providerLine.classList.add('is-error');
    els.providerLine.classList.remove('is-warning');
    els.providerLine.title = errors[0] || '配置错误';
    els.presence.classList.add('is-error');
    els.configBanner.hidden = false;
    els.configBannerText.textContent = errors.length > 1
      ? `${errors[0]}（另有 ${errors.length - 1} 项错误）`
      : errors[0];
  } else {
    const providerText = provider?.name
      ? `${provider.displayName || provider.name} · ${provider.model || ''}`
      : '还没有配置模型';
    els.providerLabel.textContent = providerText;
    els.providerLine.classList.remove('is-error');
    els.providerLine.classList.toggle('is-warning', warnings.length > 0);
    els.providerLine.title = warnings.length ? warnings.join('\n') : '当前模型';
    els.presence.classList.remove('is-error');
    els.configBanner.hidden = true;
  }

  const voiceReason = config.voice?.reason || '语音接口预留，当前仅支持文字';
  els.voiceStatusText.title = `${voiceReason}；语音输入：${config.voice?.input?.reason || voiceReason}；语音输出：${config.voice?.output?.reason || voiceReason}`;
  els.voiceOutput.title = `语音输出 · ${voiceReason}`;
  els.mic.title = `语音输入 · ${voiceReason}`;

  if (!threadMessages.length) updateWelcome();
  updateComposer();
}

function hideWelcome() {
  els.welcome.classList.add('is-hidden');
}

function makeAvatar() {
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  const image = document.createElement('img');
  image.src = avatarUrl;
  image.alt = '';
  image.draggable = false;
  image.addEventListener('error', () => {
    image.src = RELATIVE_AVATAR;
  }, { once: true });
  avatar.appendChild(image);
  return avatar;
}

function startTypewriter(node, fullText, turnId) {
  if (!fullText) {
    if (turnId) finishTurn(turnId);
    return;
  }
  if (REDUCED_MOTION.matches || document.visibilityState === 'hidden') {
    node.textContent = fullText;
    if (turnId) finishTurn(turnId);
    return;
  }

  const characters = Array.from(fullText);
  const total = characters.length;
  const duration = Math.min(2700, Math.max(380, total * 14));
  const startedAt = performance.now();
  let finished = false;
  let frameId = 0;

  node.classList.add('is-typing', 'can-skip');
  node.title = '点击显示完整回复';
  node.textContent = '';

  const finish = () => {
    if (finished) return;
    finished = true;
    if (frameId) cancelAnimationFrame(frameId);
    node.textContent = fullText;
    node.classList.remove('is-typing', 'can-skip');
    node.removeAttribute('title');
    node.removeEventListener('click', finish);
    typewriters.delete(finish);
    if (turnId) finishTurn(turnId);
    if (isNearBottom()) scrollToBottom();
  };

  const tick = (now) => {
    if (finished) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const visible = Math.max(1, Math.ceil(total * progress));
    node.textContent = characters.slice(0, visible).join('');
    if (isNearBottom()) scrollToBottom();
    if (progress < 1) frameId = requestAnimationFrame(tick);
    else finish();
  };

  node.addEventListener('click', finish);
  typewriters.add(finish);
  frameId = requestAnimationFrame(tick);
}

function finishAllTypewriters() {
  for (const finish of [...typewriters]) finish();
}

function finishTurn(turnId) {
  if (!turnId || !api || typeof api.replyFinished !== 'function') return;
  api.replyFinished(turnId).catch(() => {});
}

function appendMessage(role, text, { animate = true, typeTurnId = null } = {}) {
  const row = document.createElement('div');
  row.className = `message-row ${role === 'user' ? 'is-user' : 'is-assistant'}`;
  if (!animate) row.style.animation = 'none';

  if (role !== 'user') row.appendChild(makeAvatar());

  const stack = document.createElement('div');
  stack.className = 'message-stack';

  const author = document.createElement('div');
  author.className = 'message-author';
  author.dataset.assistant = role === 'user' ? 'false' : 'true';
  author.textContent = role === 'user' ? '你' : (config?.persona?.name || '小机');
  stack.appendChild(author);

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  if (typeTurnId) bubble.setAttribute('data-turn-id', typeTurnId);
  stack.appendChild(bubble);
  row.appendChild(stack);
  els.thread.appendChild(row);

  if (role !== 'user' && animate) {
    startTypewriter(bubble, text, typeTurnId);
  }
  return { row, bubble };
}

function appendTypingIndicator() {
  const row = document.createElement('div');
  row.className = 'message-row is-assistant typing-row';
  row.appendChild(makeAvatar());

  const stack = document.createElement('div');
  stack.className = 'message-stack';

  const author = document.createElement('div');
  author.className = 'message-author';
  author.dataset.assistant = 'true';
  author.textContent = config?.persona?.name || '小机';
  stack.appendChild(author);

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.setAttribute('aria-label', '正在思考');
  for (let index = 0; index < 3; index += 1) {
    dots.appendChild(document.createElement('span'));
  }
  bubble.appendChild(dots);
  stack.appendChild(bubble);
  row.appendChild(stack);
  els.thread.appendChild(row);
  return row;
}

function appendErrorCard(error) {
  const row = document.createElement('div');
  row.className = 'error-row';

  const heading = document.createElement('div');
  heading.className = 'error-heading';
  const title = document.createElement('span');
  title.textContent = error.code === 'CONFIG' ? '配置还没有准备好' : '这次没有连上大脑';
  heading.appendChild(title);
  if (error.code) {
    const code = document.createElement('span');
    code.className = 'error-code';
    code.textContent = error.code;
    heading.appendChild(code);
  }
  row.appendChild(heading);

  const message = document.createElement('p');
  message.className = 'error-message';
  message.textContent = error.message || '未知错误';
  row.appendChild(message);

  if (error.hint) {
    const hint = document.createElement('p');
    hint.className = 'error-hint';
    hint.textContent = error.hint;
    row.appendChild(hint);
  }

  if (error.detail) {
    const detail = document.createElement('details');
    detail.className = 'error-details';
    const summary = document.createElement('summary');
    summary.textContent = '技术细节';
    const pre = document.createElement('p');
    pre.textContent = error.detail;
    detail.append(summary, pre);
    row.appendChild(detail);
  }

  const actions = document.createElement('div');
  actions.className = 'error-actions';
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.textContent = '打开设置';
  settingsButton.addEventListener('click', () => {
    api?.openSettings?.().catch(() => {});
  });
  actions.appendChild(settingsButton);
  row.appendChild(actions);

  els.thread.appendChild(row);
  return row;
}

function removeErrorCards() {
  for (const row of els.thread.querySelectorAll('.error-row')) row.remove();
}

function removeTypingIndicators() {
  for (const row of els.thread.querySelectorAll('.typing-row')) row.remove();
}

function pushHistory(role, text) {
  threadMessages.push({ role, content: text });
  updateWelcome();
}

function renderHistory(messages) {
  els.thread.innerHTML = '';
  threadMessages = [];
  for (const message of messages) {
    if (!message || typeof message.content !== 'string') continue;
    threadMessages.push({ role: message.role, content: message.content });
    appendMessage(message.role, message.content, { animate: false });
  }
  updateWelcome();
  requestAnimationFrame(() => scrollToBottom());
}

function updateComposer() {
  const length = els.input.value.length;
  const max = config?.chat?.maxInputChars || Number(els.input.maxLength) || 4000;
  const canSend = Boolean(config) && !configBlocked && !sending && !bootFailed && els.input.value.trim().length > 0;
  els.send.disabled = !canSend;
  els.newChat.disabled = sending || !booted;
  els.body.classList.toggle('is-busy', sending);
  const countVisible = length > max * 0.8;
  els.charCount.textContent = `${length} / ${max}`;
  els.charCount.classList.toggle('is-visible', countVisible);
  els.charCount.classList.toggle('is-over', length >= max);
}

function autoResizeInput() {
  els.input.style.height = 'auto';
  const nextHeight = Math.min(els.input.scrollHeight, 120);
  els.input.style.height = `${Math.max(30, nextHeight)}px`;
}

function setSending(next) {
  sending = next;
  updateComposer();
}

function fallbackError(message) {
  return {
    code: 'INTERNAL',
    message: message || '发生了未预期的错误',
    hint: '请重试，或打开设置查看连接状态。',
    detail: '',
  };
}

async function sendCurrentMessage() {
  if (!booted || sending || configBlocked) return;
  const text = els.input.value.trim();
  if (!text) return;

  scrollToBottom();
  removeErrorCards();
  hideWelcome();
  appendMessage('user', text, { animate: true });
  pushHistory('user', text);
  els.input.value = '';
  autoResizeInput();
  setSending(true);

  const typingRow = appendTypingIndicator();
  scrollToBottom();

  let result;
  try {
    result = await api.sendMessage(text);
  } catch (error) {
    result = { ok: false, error: fallbackError(error?.message) };
  }
  typingRow.remove();
  removeTypingIndicators();

  if (result?.ok) {
    pushHistory('assistant', result.reply);
    appendMessage('assistant', result.reply, {
      animate: true,
      typeTurnId: result.turnId,
    });
    setSending(false);
    scrollToBottom();
    els.input.focus();
    return;
  }

  appendErrorCard(result?.error || fallbackError());
  setSending(false);
  scrollToBottom();
  els.input.focus();
}

async function startNewChat() {
  if (sending) return;
  if (!threadMessages.length && !els.thread.querySelector('.error-row')) {
    showToast('现在就是一段新对话');
    return;
  }
  const confirmed = window.confirm('开始新对话？当前上下文会从小机的记忆里清除。');
  if (!confirmed) return;

  finishAllTypewriters();
  try {
    const result = await api.resetChat();
    if (!result?.ok) {
      showToast(result?.error?.message || '暂时不能重置对话');
      return;
    }
  } catch (error) {
    showToast(error?.message || '暂时不能重置对话');
    return;
  }

  removeErrorCards();
  removeTypingIndicators();
  els.thread.innerHTML = '';
  threadMessages = [];
  updateWelcome();
  els.input.value = '';
  autoResizeInput();
  updateComposer();
  scrollToBottom();
  els.input.focus();
  showToast('新对话已经开始');
}

async function notifyVoiceReserved() {
  const text = config?.persona?.voiceReservedText || '语音接口已经预留，这一版先用文字聊天吧。';
  showToast(text, 3800);
  try {
    await api.voiceReserved();
  } catch {
    // The toast already explains the reserved feature.
  }
}

function handleConfigEvent(nextConfig) {
  applyConfig(nextConfig);
  if (nextConfig.config?.errors?.length) {
    finishAllTypewriters();
  }
}

function handleEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'config-changed' && event.config) {
    handleConfigEvent(event.config);
  }
}

function bindEvents() {
  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendCurrentMessage();
  });

  els.input.addEventListener('input', () => {
    autoResizeInput();
    updateComposer();
  });

  els.input.addEventListener('compositionstart', () => {
    composing = true;
  });

  els.input.addEventListener('compositionend', () => {
    composing = false;
    updateComposer();
  });

  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (composing || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!els.send.disabled) els.composer.requestSubmit();
    }
  });

  els.mic.addEventListener('click', notifyVoiceReserved);
  els.voiceOutput.addEventListener('click', notifyVoiceReserved);
  els.newChat.addEventListener('click', startNewChat);
  els.settings.addEventListener('click', () => api?.openSettings?.().catch(() => {}));
  els.bannerSettings.addEventListener('click', () => api?.openSettings?.().catch(() => {}));
  els.close.addEventListener('click', () => {
    finishAllTypewriters();
    api?.closeChat?.().catch(() => {});
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && config?.window?.closeChatOnEscape) {
      event.preventDefault();
      finishAllTypewriters();
      api?.closeChat?.().catch(() => {});
    }
  });

  window.addEventListener('focus', () => {
    if (booted) els.input.focus();
  });
}

async function bootstrap() {
  bindEvents();
  updateComposer();

  if (!api || api.role !== 'chat') {
    bootFailed = true;
    configBlocked = true;
    appendErrorCard({
      code: 'UI',
      message: '界面接口未能加载',
      hint: '请重启应用。',
    });
    return;
  }

  api.onEvent((event) => {
    if (!booted) {
      pendingEvents.push(event);
      return;
    }
    handleEvent(event);
  });

  try {
    const payload = await api.getBootstrap();
    if (!payload?.config) throw new Error('配置快照为空');
    booted = true;
    applyConfig(payload.config);
    renderHistory(payload.messages || []);
    for (const event of pendingEvents) handleEvent(event);
    pendingEvents = [];
    requestAnimationFrame(() => {
      autoResizeInput();
      updateComposer();
      els.input.focus();
      scrollToBottom();
    });
  } catch (error) {
    bootFailed = true;
    configBlocked = true;
    appendErrorCard({
      code: 'BOOT',
      message: '聊天窗口启动失败',
      hint: '请关闭窗口后重试，或重启应用。',
      detail: error?.message || '',
    });
    updateComposer();
  }
}

bootstrap();

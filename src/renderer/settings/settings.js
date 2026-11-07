'use strict';

const api = window.desktopRobot;

const els = {
  statusPill: document.getElementById('status-pill'),
  statusText: document.getElementById('status-text'),
  version: document.getElementById('version-label'),
  providerCount: document.getElementById('provider-count'),
  modelName: document.getElementById('model-name'),
  modelType: document.getElementById('model-type'),
  modelId: document.getElementById('model-id'),
  modelEndpoint: document.getElementById('model-endpoint'),
  keyStatus: document.getElementById('key-status'),
  keyStatusText: document.getElementById('key-status-text'),
  proxyMode: document.getElementById('proxy-mode'),
  proxyUrl: document.getElementById('proxy-url'),
  proxyAuth: document.getElementById('proxy-auth'),
  voiceInput: document.getElementById('voice-input'),
  voiceOutput: document.getElementById('voice-output'),
  animationList: document.getElementById('animation-list'),
  animationsCount: document.getElementById('animations-count'),
  openAnimations: document.getElementById('open-animations'),
  configPath: document.getElementById('config-path'),
  openConfigFile: document.getElementById('open-config-file'),
  openConfigFolder: document.getElementById('open-config-folder'),
  openLog: document.getElementById('open-log'),
  editor: document.getElementById('editor'),
  lineNumbers: document.getElementById('line-numbers'),
  cursorPosition: document.getElementById('cursor-position'),
  fileStatus: document.getElementById('file-status'),
  unsavedLabel: document.getElementById('unsaved-label'),
  reload: document.getElementById('reload'),
  test: document.getElementById('test'),
  save: document.getElementById('save'),
  saveSpinner: document.getElementById('save-spinner'),
  messageArea: document.getElementById('message-area'),
  messageIcon: document.getElementById('message-icon'),
  messageCopy: document.getElementById('message-copy'),
  messageClose: document.getElementById('message-close'),
  toast: document.getElementById('toast'),
};

const STATE_LABELS = {
  idle: '空闲',
  thinking: '思考',
  talking: '说话',
  happy: '开心',
  error: '错误',
  listening: '聆听',
};

const PROVIDER_TYPE_LABELS = {
  'openai-compatible': 'OpenAI 兼容',
  openclaw: 'OpenClaw',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

let meta = null;
let lastSavedText = '';
let dirty = false;
let busy = false;
let saving = false;
let booted = false;
let pendingEvents = [];
let toastTimer = null;
let messageTimer = null;

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

function setMessage(kind, title, { lines = [], items = [] } = {}) {
  if (messageTimer) {
    clearTimeout(messageTimer);
    messageTimer = null;
  }
  els.messageArea.hidden = false;
  els.messageArea.className = `message-area is-${kind}`;
  els.messageIcon.textContent = kind === 'success' ? '✓' : kind === 'info' ? 'i' : '!';
  els.messageCopy.innerHTML = '';

  const heading = document.createElement('strong');
  heading.textContent = title;
  els.messageCopy.appendChild(heading);

  for (const line of lines) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    els.messageCopy.appendChild(paragraph);
  }

  if (items.length) {
    const list = document.createElement('ul');
    for (const item of items.slice(0, 12)) {
      const entry = document.createElement('li');
      entry.textContent = item;
      list.appendChild(entry);
    }
    if (items.length > 12) {
      const entry = document.createElement('li');
      entry.textContent = `还有 ${items.length - 12} 项，详见 YAML 校验信息。`;
      list.appendChild(entry);
    }
    els.messageCopy.appendChild(list);
  }
}

function hideMessage() {
  els.messageArea.hidden = true;
  if (messageTimer) {
    clearTimeout(messageTimer);
    messageTimer = null;
  }
}

function renderStatus() {
  const errors = meta?.configStatus?.errors || [];
  const warnings = meta?.configStatus?.warnings || [];
  els.statusPill.classList.remove('is-ok', 'is-error', 'is-warning', 'is-pending');

  if (errors.length) {
    els.statusPill.classList.add('is-error');
    els.statusText.textContent = `配置有 ${errors.length} 个错误`;
    els.statusPill.title = errors.join('\n');
  } else if (warnings.length) {
    els.statusPill.classList.add('is-warning');
    els.statusText.textContent = `配置已生效 · ${warnings.length} 个提醒`;
    els.statusPill.title = warnings.join('\n');
  } else {
    els.statusPill.classList.add('is-ok');
    els.statusText.textContent = '配置已生效';
    els.statusPill.title = '当前没有配置错误';
  }
}

function keyStatusFor(provider) {
  if (!provider) {
    return { kind: 'error', text: '尚未配置可用模型' };
  }
  if (provider.key?.configured) {
    if (provider.key.source === 'env') {
      return { kind: 'ok', text: `API Key 已从环境变量 ${provider.key.envName} 读取` };
    }
    return { kind: 'ok', text: 'API Key 已配置在文件中' };
  }
  if (!provider.requiresApiKey) {
    return { kind: 'ok', text: '此供应商无需 API Key' };
  }
  return {
    kind: 'warning',
    text: provider.key?.envName
      ? `未找到 API Key：请设置 ${provider.key.envName} 或填写 apiKey`
      : '未配置 API Key',
  };
}

function renderModel() {
  const provider = meta?.activeProvider;
  const providers = meta?.providers || [];
  els.providerCount.textContent = `${providers.length} 个供应商`;
  els.modelName.textContent = provider?.displayName || provider?.name || '未配置';
  els.modelType.textContent = provider?.type
    ? (PROVIDER_TYPE_LABELS[provider.type] || provider.type)
    : '—';
  els.modelId.textContent = provider?.model || '—';
  els.modelId.title = provider?.model || '';
  els.modelEndpoint.textContent = provider?.endpoint || '—';
  els.modelEndpoint.title = provider?.endpoint || '';

  const key = keyStatusFor(provider);
  els.keyStatus.classList.remove('is-ok', 'is-warning', 'is-error');
  els.keyStatus.classList.add(`is-${key.kind}`);
  els.keyStatusText.textContent = key.text;
}

function renderProxy() {
  const proxy = meta?.proxy;
  const mode = proxy?.mode || 'direct';
  els.proxyMode.textContent = mode.toUpperCase();
  if (proxy?.error) {
    els.proxyUrl.textContent = '代理配置有误';
    els.proxyUrl.title = proxy.error;
    els.proxyAuth.textContent = '—';
    els.proxyMode.classList.add('is-amber');
    return;
  }
  els.proxyMode.classList.remove('is-amber');
  els.proxyUrl.textContent = proxy?.display || '直连';
  els.proxyUrl.title = proxy?.bypass ? `bypass: ${proxy.bypass}` : '';
  els.proxyAuth.textContent = proxy?.authenticated ? '已配置代理账号' : '无';
}

function renderVoice() {
  const voice = meta?.voice;
  const available = (kind) => Boolean(voice?.[kind]?.available);
  els.voiceInput.textContent = available('input') ? '可用' : '接口预留';
  els.voiceOutput.textContent = available('output') ? '可用' : '接口预留';
  const reason = voice?.reason || 'v0.1 已预留语音接口，但尚未接入语音模型';
  els.voiceInput.title = voice?.input?.reason || reason;
  els.voiceOutput.title = voice?.output?.reason || reason;
}

function renderAnimations() {
  const animations = meta?.animations || [];
  els.animationList.innerHTML = '';
  let available = 0;

  for (const animation of animations) {
    if (animation.exists) available += 1;
    const row = document.createElement('div');
    row.className = `animation-item${animation.exists ? '' : ' is-missing'}`;
    row.title = animation.file || '未配置';

    const dot = document.createElement('span');
    dot.className = `animation-dot${animation.exists ? '' : ' is-missing'}`;

    const state = document.createElement('span');
    state.className = 'animation-state';
    state.textContent = animation.state;

    const file = document.createElement('span');
    file.className = 'animation-file';
    file.textContent = animation.configured || `${STATE_LABELS[animation.state] || animation.state}缺失`;

    row.append(dot, state, file);
    els.animationList.appendChild(row);
  }

  els.animationsCount.textContent = `${available} / ${animations.length || 6}`;
}

function renderFileInfo() {
  els.configPath.textContent = meta?.configPath || '—';
  els.configPath.title = meta?.configPath || '';
  els.version.textContent = meta?.appVersion ? `v${meta.appVersion}` : 'v0.1.0';
}

function renderInitialNotices() {
  const errors = meta?.configStatus?.errors || [];
  const warnings = meta?.configStatus?.warnings || [];
  if (errors.length) {
    setMessage('error', '当前配置需要修复', {
      items: errors,
      lines: ['修复后点击“保存并应用”。在配置恢复前，小机仍保留上一份可用配置。'],
    });
  } else if (warnings.length) {
    setMessage('warning', `配置已生效，有 ${warnings.length} 个提醒`, {
      items: warnings,
    });
  }
}

function renderAll() {
  renderStatus();
  renderModel();
  renderProxy();
  renderVoice();
  renderAnimations();
  renderFileInfo();
  updateControls();
}

function updateLineNumbers() {
  const lines = els.editor.value.split('\n').length;
  els.lineNumbers.textContent = Array.from({ length: lines }, (_value, index) => index + 1).join('\n');
}

function updateCursorPosition() {
  const position = els.editor.selectionStart;
  const before = els.editor.value.slice(0, position);
  const lines = before.split('\n');
  const line = lines.length;
  const column = Array.from(lines[lines.length - 1]).length + 1;
  els.cursorPosition.textContent = `第 ${line} 行，第 ${column} 列`;
}

function updateDirtyState() {
  dirty = els.editor.value !== lastSavedText;
  els.unsavedLabel.hidden = !dirty;
  els.fileStatus.textContent = dirty ? '有未保存的修改' : 'UTF-8 · YAML';
  document.title = dirty ? '● 配置 · Desktop Robot' : 'Desktop Robot · 配置';
  updateControls();
}

function updateControls() {
  const blockers = busy || !booted;
  els.save.disabled = blockers || !dirty;
  els.reload.disabled = blockers;
  els.test.disabled = blockers || dirty;
  els.test.title = dirty
    ? '请先保存并应用修改，再测试连接'
    : '使用当前已生效配置测试连接';
  els.save.classList.toggle('is-loading', saving);
  els.editor.readOnly = busy;
}

function setEditorText(text, { preserveCursor = false } = {}) {
  const previousStart = els.editor.selectionStart;
  const previousEnd = els.editor.selectionEnd;
  els.editor.value = text ?? '';
  updateLineNumbers();
  if (preserveCursor) {
    const start = Math.min(previousStart, els.editor.value.length);
    const end = Math.min(previousEnd, els.editor.value.length);
    els.editor.setSelectionRange(start, end);
  } else {
    els.editor.setSelectionRange(0, 0);
    els.editor.scrollTop = 0;
    els.lineNumbers.scrollTop = 0;
  }
  updateCursorPosition();
}

function applyMeta(nextMeta) {
  if (!nextMeta) return;
  meta = nextMeta;
  renderAll();
}

async function refreshFromDisk({ initial = false, silent = false } = {}) {
  if (!api || typeof api.getConfig !== 'function') return;
  try {
    const data = await api.getConfig();
    if (!data) throw new Error('没有收到配置数据');
    applyMeta(data.meta);
    setEditorText(data.rawText || '');
    lastSavedText = data.rawText || '';
    booted = true;
    updateDirtyState();
    if (data.error) {
      setMessage('error', '无法读取配置文件', { lines: [data.error] });
    } else if (initial) {
      renderInitialNotices();
    }
    if (!silent) showToast(initial ? '配置已载入' : '已从磁盘重新读取');
  } catch (error) {
    booted = false;
    els.statusPill.className = 'status-pill is-error';
    els.statusText.textContent = '配置读取失败';
    els.statusPill.title = error?.message || '';
    setMessage('error', '无法读取配置文件', {
      lines: [error?.message || '未知错误', '请尝试重新打开设置窗口，或检查文件权限。'],
    });
    updateControls();
  }
}

async function refreshMetaOnly() {
  if (!api || typeof api.getConfig !== 'function') return;
  try {
    const data = await api.getConfig();
    if (data?.meta) applyMeta(data.meta);
  } catch {
    // Keep the last known metadata; the editor content is unaffected.
  }
}

async function saveConfig() {
  if (!dirty || busy || !booted) return;
  busy = true;
  saving = true;
  updateControls();
  hideMessage();

  try {
    const result = await api.saveConfig(els.editor.value);
    if (result?.ok) {
      if (result.meta) applyMeta(result.meta);
      lastSavedText = els.editor.value;
      dirty = false;
      updateDirtyState();
      setMessage('success', '已保存并应用', {
        lines: ['新的模型、代理、外观与人格设置已经从这份配置文件生效。'],
      });
      showToast('保存成功');
    } else {
      const errors = result?.errors?.length ? result.errors : ['保存失败，但服务没有返回具体原因'];
      setMessage('error', '配置未通过检查，未写入磁盘', {
        items: errors,
        lines: ['当前小机仍在运行上一份可用配置，你可以继续修改后重试。'],
      });
    }
  } catch (error) {
    setMessage('error', '保存失败', {
      lines: [error?.message || '未知错误'],
    });
  } finally {
    busy = false;
    saving = false;
    updateControls();
  }
}

async function reloadConfig() {
  if (busy || !booted) return;
  if (dirty && !window.confirm('放弃未保存的修改，并从磁盘重新加载配置？')) return;

  busy = true;
  updateControls();
  hideMessage();
  try {
    const result = await api.reloadConfig();
    if (typeof result?.rawText === 'string') {
      setEditorText(result.rawText);
      lastSavedText = result.rawText;
    }
    if (result?.meta) applyMeta(result.meta);
    dirty = els.editor.value !== lastSavedText;
    updateDirtyState();

    if (result?.ok) {
      setMessage('success', '已从磁盘重新加载', {
        lines: ['配置文件和动画资源已经重新读取。'],
      });
      showToast('配置已重新加载');
    } else {
      setMessage('error', '磁盘上的配置有误，未能应用', {
        items: result?.errors || ['未知配置错误'],
        lines: ['小机仍在运行上一份可用配置。修复后可再次点击“重新加载”。'],
      });
    }
  } catch (error) {
    setMessage('error', '重新加载失败', { lines: [error?.message || '未知错误'] });
  } finally {
    busy = false;
    updateControls();
  }
}

async function testConnection() {
  if (busy || dirty || !booted) {
    if (dirty) showToast('请先保存并应用修改，再测试连接');
    return;
  }
  busy = true;
  updateControls();
  hideMessage();
  setMessage('info', '正在测试连接…', {
    lines: ['会向当前已生效的模型发送一条很短的测试消息。'],
  });

  try {
    const result = await api.testConnection();
    if (result?.ok) {
      const lines = [
        `${result.providerDisplayName || result.providerName || '模型'} · ${result.model || '未知模型'}`,
        `延迟 ${result.latencyMs} ms · 回复：${String(result.text || '').slice(0, 160)}`,
      ];
      setMessage('success', '连接成功', { lines });
      showToast('模型连接正常');
    } else {
      const error = result?.error || {};
      setMessage('error', '连接失败', {
        lines: [
          `${error.message || '未知错误'}${error.code ? `（${error.code}）` : ''}`,
          error.hint || '',
          error.detail ? `技术细节：${error.detail}` : '',
        ].filter(Boolean),
      });
    }
  } catch (error) {
    setMessage('error', '测试失败', { lines: [error?.message || '未知错误'] });
  } finally {
    busy = false;
    updateControls();
  }
}

async function runNativeAction(action, failureLabel) {
  try {
    const result = await action();
    if (result && result.ok === false) {
      showToast(result.message || failureLabel);
      return;
    }
    if (result?.message) showToast(result.message);
  } catch (error) {
    showToast(error?.message || failureLabel);
  }
}

function handleConfigEvent() {
  if (!booted || busy) return;
  if (dirty) {
    showToast('配置文件已在外部更新；未覆盖你正在编辑的内容');
    refreshMetaOnly();
    return;
  }
  refreshFromDisk({ silent: true }).then(() => {
    showToast('配置文件已在外部更新并应用');
  });
}

function bindEvents() {
  els.editor.addEventListener('input', () => {
    updateLineNumbers();
    updateCursorPosition();
    updateDirtyState();
  });

  els.editor.addEventListener('scroll', () => {
    els.lineNumbers.scrollTop = els.editor.scrollTop;
  });

  els.editor.addEventListener('keyup', updateCursorPosition);
  els.editor.addEventListener('click', updateCursorPosition);
  els.editor.addEventListener('select', updateCursorPosition);

  els.editor.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!els.save.disabled) saveConfig();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = els.editor.selectionStart;
      const end = els.editor.selectionEnd;
      els.editor.setRangeText('  ', start, end, 'end');
      updateLineNumbers();
      updateDirtyState();
      updateCursorPosition();
    }
  });

  els.save.addEventListener('click', saveConfig);
  els.reload.addEventListener('click', reloadConfig);
  els.test.addEventListener('click', testConnection);
  els.messageClose.addEventListener('click', hideMessage);

  els.openConfigFile.addEventListener('click', () =>
    runNativeAction(() => api.openConfigFile(), '无法打开配置文件'));
  els.openConfigFolder.addEventListener('click', () =>
    runNativeAction(() => api.openConfigFolder(), '无法打开配置文件夹'));
  els.openAnimations.addEventListener('click', () =>
    runNativeAction(() => api.openAnimationsFolder(), '无法打开动画文件夹'));
  els.openLog.addEventListener('click', () =>
    runNativeAction(() => api.openLogFile(), '无法打开日志文件'));

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function bootstrap() {
  bindEvents();
  updateControls();

  if (!api || api.role !== 'settings') {
    booted = false;
    els.statusPill.className = 'status-pill is-error';
    els.statusText.textContent = '界面接口未加载';
    setMessage('error', '设置界面启动失败', {
      lines: ['请重启应用后再试。'],
    });
    updateControls();
    return;
  }

  api.onEvent((event) => {
    if (!booted) {
      pendingEvents.push(event);
      return;
    }
    if (event?.type === 'config-changed') handleConfigEvent();
  });

  await refreshFromDisk({ initial: true, silent: true });
  booted = Boolean(meta);
  updateControls();
  for (const event of pendingEvents) {
    if (event?.type === 'config-changed') handleConfigEvent();
  }
  pendingEvents = [];
  els.editor.focus();
}

bootstrap();

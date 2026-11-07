'use strict';

const api = window.desktopRobot;

const app = document.getElementById('pet-app');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleClose = document.getElementById('bubble-close');
const petHit = document.getElementById('pet-hit');
const petImage = document.getElementById('pet-image');

let config = null;
let chatOpen = false;
let bootstrapLoaded = false;
let pendingEvents = [];
let bubbleTimer = null;
let imageSequence = 0;
let currentImageUrl = '';
let currentState = 'idle';
let greetingShown = false;
let dragPointer = null;

function hexToRgba(hex, alpha) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return `rgba(47, 175, 159, ${alpha})`;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function applyTheme(nextConfig) {
  const accent = nextConfig?.appearance?.accentColor || '#2FAF9F';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-soft', hexToRgba(accent, 0.16));
  const name = nextConfig?.persona?.name || '小机';
  document.title = name;
  petHit.setAttribute('aria-label', `和${name}聊天`);
  petImage.alt = name;
}

function assetsForState(state) {
  const animations = config?.appearance?.animations || {};
  const direct = animations[state]?.url;
  if (direct) return direct;
  return animations.idle?.url || config?.appearance?.fallbackUrl || '';
}

function showPlaceholder() {
  document.body.classList.add('no-art');
  petImage.classList.add('is-hidden');
  currentImageUrl = '';
}

function loadImageForState(nextState, { force = false, fallbackAttempt = false, urlOverride = '' } = {}) {
  if (!config) return;
  const url = urlOverride || assetsForState(nextState);
  if (!url) {
    showPlaceholder();
    return;
  }
  if (!force && url === currentImageUrl) return;

  const sequence = ++imageSequence;
  const loader = new Image();
  petImage.classList.add('is-fading');

  loader.onload = () => {
    if (sequence !== imageSequence || !config) return;
    currentImageUrl = url;
    petImage.src = url;
    petImage.classList.remove('is-hidden');
    document.body.classList.remove('no-art');
    requestAnimationFrame(() => petImage.classList.remove('is-fading'));
  };

  loader.onerror = () => {
    if (sequence !== imageSequence || !config) return;
    const fallback = config.appearance?.fallbackUrl;
    if (!fallbackAttempt && fallback && url !== fallback) {
      loadImageForState(nextState, {
        force: true,
        fallbackAttempt: true,
        urlOverride: fallback,
      });
      return;
    }
    showPlaceholder();
  };

  loader.src = url;
}

function setState(nextState) {
  const state = ['idle', 'thinking', 'talking', 'happy', 'error', 'listening'].includes(nextState)
    ? nextState
    : 'idle';
  currentState = state;
  loadImageForState(state);
}

function truncate(text, maxChars) {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function hideBubble() {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  bubble.classList.remove('is-visible');
}

function showBubble(text, tone = 'info', durationMs = 0) {
  if (!text) return;
  const maxChars = config?.appearance?.bubbleMaxChars || 120;
  bubbleText.textContent = truncate(text, maxChars);
  bubble.className = `bubble is-visible tone-${['thinking', 'error', 'voice', 'reply', 'success'].includes(tone) ? tone : 'info'}`;
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = null;
  if (durationMs > 0) {
    bubbleTimer = setTimeout(() => {
      bubbleTimer = null;
      bubble.classList.remove('is-visible');
    }, durationMs);
  }
}

function configErrors() {
  return config?.config?.errors || [];
}

function showConfigErrorBubble() {
  const errors = configErrors();
  if (!errors.length) return false;
  showBubble(`配置需要修复：${errors[0]}`, 'error', 0);
  return true;
}

function showGreeting() {
  if (greetingShown || chatOpen || !config) return;
  greetingShown = true;
  if (showConfigErrorBubble()) return;
  const greeting = config.persona?.greeting || '';
  if (greeting) {
    showBubble(greeting, 'info', config.appearance?.bubbleDurationMs || 6500);
  }
}

function handleConfigChanged(nextConfig) {
  const previousHadErrors = configErrors().length > 0;
  const previousAnimations = JSON.stringify(config?.appearance?.animations || {});
  config = nextConfig;
  document.body.classList.remove('no-art');
  applyTheme(config);
  const animationsChanged = previousAnimations !== JSON.stringify(config.appearance?.animations || {});
  loadImageForState(currentState, { force: animationsChanged });

  const hasErrors = configErrors().length > 0;
  if (hasErrors) {
    if (!chatOpen) showConfigErrorBubble();
  } else if (previousHadErrors) {
    showBubble('配置已经修好，可以继续聊天了。', 'success', 3000);
  }
}

function handleEvent(event) {
  if (!event || typeof event !== 'object') return;
  switch (event.type) {
    case 'pet-state':
      setState(event.state);
      break;
    case 'pet-bubble':
      showBubble(event.text, event.tone, event.durationMs);
      break;
    case 'chat-visible':
      chatOpen = Boolean(event.visible);
      if (chatOpen) {
        hideBubble();
      } else if (configErrors().length && !bubble.classList.contains('is-visible')) {
        showConfigErrorBubble();
      }
      break;
    case 'config-changed':
      if (event.config) handleConfigChanged(event.config);
      break;
    default:
      break;
  }
}

function toggleChat() {
  if (!api || typeof api.toggleChat !== 'function') return;
  hideBubble();
  api.toggleChat().catch(() => {});
}

function openMenu() {
  if (api && typeof api.showMenu === 'function') api.showMenu().catch(() => {});
}

function finishPointer(pointerId, { cancel = false } = {}) {
  if (!dragPointer || dragPointer.id !== pointerId) return;
  const wasDragging = dragPointer.dragging;
  dragPointer = null;
  document.body.classList.remove('is-dragging');
  try {
    petHit.releasePointerCapture(pointerId);
  } catch {
    // The capture may already be gone.
  }
  if (wasDragging) {
    if (api && typeof api.dragEnd === 'function') api.dragEnd();
  } else if (!cancel) {
    toggleChat();
  }
}

petHit.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || dragPointer) return;
  dragPointer = {
    id: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    dragging: false,
  };
  try {
    petHit.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is best-effort.
  }
  petHit.focus({ preventScroll: true });
  event.preventDefault();
});

petHit.addEventListener('pointermove', (event) => {
  if (!dragPointer || dragPointer.id !== event.pointerId) return;
  if (dragPointer.dragging) return;
  const dx = event.screenX - dragPointer.startX;
  const dy = event.screenY - dragPointer.startY;
  if (Math.hypot(dx, dy) < 5) return;
  dragPointer.dragging = true;
  hideBubble();
  document.body.classList.add('is-dragging');
  if (api && typeof api.dragStart === 'function') api.dragStart();
});

petHit.addEventListener('pointerup', (event) => {
  finishPointer(event.pointerId);
});

petHit.addEventListener('pointercancel', (event) => {
  finishPointer(event.pointerId, { cancel: true });
});

petHit.addEventListener('lostpointercapture', (event) => {
  if (dragPointer && dragPointer.id === event.pointerId) {
    finishPointer(event.pointerId, { cancel: true });
  }
});

petHit.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleChat();
  } else if (event.key === 'Escape') {
    hideBubble();
  }
});

bubble.addEventListener('click', (event) => {
  if (event.target === bubbleClose) return;
  toggleChat();
});

bubbleClose.addEventListener('click', (event) => {
  event.stopPropagation();
  hideBubble();
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  openMenu();
});

window.addEventListener('blur', () => {
  if (dragPointer?.dragging) {
    if (api && typeof api.dragEnd === 'function') api.dragEnd();
  }
  dragPointer = null;
  document.body.classList.remove('is-dragging');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideBubble();
});

function showBootFailure(message) {
  document.body.classList.add('no-art');
  bubbleText.textContent = message;
  bubble.className = 'bubble is-visible tone-error';
}

async function bootstrap() {
  if (!api || api.role !== 'pet') {
    showBootFailure('界面接口未能加载，请重启应用。');
    return;
  }

  api.onEvent((event) => {
    if (!bootstrapLoaded) {
      pendingEvents.push(event);
      return;
    }
    handleEvent(event);
  });

  try {
    const payload = await api.getBootstrap();
    if (!payload?.config) throw new Error('配置快照为空');
    config = payload.config;
    chatOpen = Boolean(payload.chatVisible);
    applyTheme(config);
    bootstrapLoaded = true;
    loadImageForState('idle');

    if (!chatOpen) {
      if (!showConfigErrorBubble()) {
        setTimeout(showGreeting, 650);
      }
    }

    for (const event of pendingEvents) handleEvent(event);
    pendingEvents = [];
  } catch (error) {
    showBootFailure(`小机启动失败：${error?.message || '未知错误'}`);
  }
}

bootstrap();

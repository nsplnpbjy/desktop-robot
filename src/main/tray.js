'use strict';

const { Menu, Tray, nativeImage } = require('electron');

function createAppTray({
  iconPath,
  windows,
  actions,
  logger,
}) {
  let tray = null;

  function refresh() {
    if (!tray) return;
    try {
      const template = windows.buildMenuTemplate(actions);
      tray.setContextMenu(Menu.buildFromTemplate(template));
    } catch (error) {
      logger.warn('Could not refresh tray menu', { message: error.message });
    }
  }

  try {
    const image = nativeImage.createFromPath(iconPath);
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    tray.setToolTip('Desktop Robot · 桌面小机');
    tray.on('double-click', () => windows.toggleChat());
    tray.on('right-click', refresh);
    refresh();
  } catch (error) {
    logger.error('Could not create tray icon', { message: error.message });
  }

  return {
    refresh,
    destroy: () => {
      if (tray) {
        tray.destroy();
        tray = null;
      }
    },
  };
}

module.exports = {
  createAppTray,
};

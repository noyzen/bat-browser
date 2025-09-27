const fs = require('fs');
const state = require('./state');
const { SESSION_PATH } = require('./constants');
const { debounce } = require('./utils');

function saveSession() {
  if (!state.mainWindow || state.tabs.size === 0) return;

  try {
    const sessionState = {
      tabs: Array.from(state.tabs.values()).map(t => {
        let finalUrl = t.url;
        if (!t.isHibernated && t.view) {
          const currentWebContentsUrl = t.view.webContents.getURL();
          if (currentWebContentsUrl && currentWebContentsUrl.endsWith('newtab.html')) {
            finalUrl = 'about:blank';
          } else {
            finalUrl = currentWebContentsUrl || t.url;
          }
        }
        return {
          id: t.id,
          url: finalUrl,
          title: t.title,
          favicon: t.favicon,
          color: t.color,
          isShared: t.isShared,
          zoomFactor: t.zoomFactor === 1.0 ? undefined : t.zoomFactor,
          isActive: t.id === state.activeTabId,
          history: t.history,
          historyIndex: t.historyIndex,
        };
      }),
      groups: Array.from(state.groups.values()),
      layout: state.layout,
      activeTabId: state.activeTabId,
    };
    const tempPath = SESSION_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(sessionState, null, 2));
    fs.renameSync(tempPath, SESSION_PATH);
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

function loadSession() {
  const tempPath = SESSION_PATH + '.tmp';
  let sessionFileToLoad = null;

  if (fs.existsSync(SESSION_PATH)) {
      sessionFileToLoad = SESSION_PATH;
  } else if (fs.existsSync(tempPath)) {
      console.log('Restoring session from .tmp file due to possible crash.');
      sessionFileToLoad = tempPath;
  }

  if (sessionFileToLoad) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionFileToLoad, 'utf-8'));
      if (sessionFileToLoad === tempPath) {
          fs.renameSync(tempPath, SESSION_PATH);
      }
      return data;
    } catch (e) {
      console.error(`Failed to load session from ${sessionFileToLoad}:`, e);
      return null;
    }
  }
  return null;
}

const debouncedSaveSession = debounce(saveSession, 500);

module.exports = {
    saveSession,
    loadSession,
    debouncedSaveSession,
};
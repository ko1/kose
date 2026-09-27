import { createMenus, handleMenuClick, handleTabRemoved } from './handlers';
import { ensureKoseWindow, saveBoundsIfKose } from './koseWindow';

// MV3 service worker ではリスナーをトップレベルで同期的に登録する
chrome.runtime.onInstalled.addListener(() => createMenus());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch((e) => console.error('kose: failed to handle menu click', e));
});

chrome.action.onClicked.addListener(() => {
  ensureKoseWindow(true).catch((e) => console.error('kose: failed to open window', e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabRemoved(tabId).catch((e) => console.error('kose: failed to clean up tab', e));
});

chrome.windows.onBoundsChanged.addListener((win) => {
  saveBoundsIfKose(win).catch(() => {});
});

import { onSettingsChanged } from '../storage/settings';
import { createMenus, handleInvoke, handleMenuClick, handleTabRemoved, updateInvokeTitles } from './handlers';
import { saveBoundsIfKose } from './koseWindow';

// MV3 service worker ではリスナーをトップレベルで同期的に登録する
// ボタンの表示（action.setTitle）はブラウザの再起動で戻るので起動時にも作り直す
const setupMenus = () => createMenus().catch((e) => console.error('kose: failed to create menus', e));
chrome.runtime.onInstalled.addListener(setupMenus);
chrome.runtime.onStartup.addListener(setupMenus);

// 機能を変えたら（koseウィンドウ上部で選んだときも）メニューとボタンの表示を合わせる
let lastTarget: string | undefined;
onSettingsChanged((settings) => {
  if (settings.targetLanguage === lastTarget) return;
  lastTarget = settings.targetLanguage;
  updateInvokeTitles(settings.targetLanguage).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch((e) => console.error('kose: failed to handle menu click', e));
});

chrome.action.onClicked.addListener((tab) => {
  handleInvoke(tab).catch((e) => console.error('kose: failed to handle action click', e));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'run-kose') return;
  handleInvoke(tab).catch((e) => console.error('kose: failed to handle command', e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabRemoved(tabId).catch((e) => console.error('kose: failed to clean up tab', e));
});

chrome.windows.onBoundsChanged.addListener((win) => {
  saveBoundsIfKose(win).catch(() => {});
});

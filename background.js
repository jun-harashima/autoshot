import { DEFAULT_SIZES } from './constant.js';

async function waitForPageLoad(tabId) {
  return new Promise(resolve => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        console.log('Tab loaded:', tabId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    console.log('Detached debugger:', tabId);
  } catch (e) {
    console.warn(`Failed to detach debugger from tab ${tabId}:`, e);
  }
}

/**
 * 手動操作モード: ユーザーがページを操作し、Shift+Enter で続行
 */
async function waitForUserAction(tabId) {
  console.log('Manual mode: waiting for user action...');
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const notice = document.createElement('div');
      notice.textContent = 'ページを操作してください。操作が終わったら Shift+Enter を押して撮影します。';
      Object.assign(notice.style, {
        position: 'fixed',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '6px',
        zIndex: 999999,
        fontSize: '14px',
        fontFamily: 'sans-serif',
      });
      document.body.appendChild(notice);

      return new Promise(resolve => {
        const handler = e => {
          if (e.key === 'Enter' && e.shiftKey) {
            window.removeEventListener('keydown', handler);
            notice.remove();
            resolve();
          }
        };
        window.addEventListener('keydown', handler);
      });
    },
  });
}

async function attachAndSetDevice(tabId, width, height, isMobile) {
  const debugTarget = { tabId };

  await chrome.debugger.attach(debugTarget, '1.3');
  console.log('Debugger attached:', tabId);

  await chrome.debugger.sendCommand(debugTarget, 'Emulation.setDeviceMetricsOverride', {
    width: parseInt(width, 10) || 1280,
    height: parseInt(height, 10) || 720,
    deviceScaleFactor: 3,
    mobile: !!isMobile && isMobile !== "false",
  });

  if (isMobile) {
    await chrome.debugger.sendCommand(debugTarget, 'Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
    });
  }
}

/**
 * CDP（Chrome DevTools Protocol）を利用し、指定されたタブでページを開き、スクリーンショットを取得
 */
async function takeScreenshot(tabId, filename) {
  const debugTarget = { tabId };
  const result = await chrome.debugger.sendCommand(debugTarget, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });

  const dataUrl = 'data:image/png;base64,' + result.data;
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });

  await detachDebugger(tabId);
  await chrome.tabs.remove(tabId);
}

/**
 * 新しいウィンドウを開き、指定された URL 一覧のスクリーンショットを順に取得
 */
async function createWindowAndCapture(csvRows, device, width, height) {
  const isMobile = device === 'mobile';

  // スクリーンショット専用のウィンドウを作成
  // - type: 'normal' で通常のブラウザウィンドウ（ポップアップ等ではない）を指定
  // - focused: false で作業中のウィンドウを非アクティブに設定
  const window = await chrome.windows.create({
    url: 'about:blank',
    type: 'normal',
    width,
    height,
    focused: false
  });
  console.log('New window created:', window.id);

  // CSV の各行についてスクリーンショットを取得
  for (const row of csvRows) {
    console.log('Opening:', row.url);

    // 3列目の flag を取得
    const flag = row.flag;

    // 空のタブを作成
    const tab = await chrome.tabs.create({
      windowId: window.id,
      url: 'about:blank',
      active: true
    });

    await attachAndSetDevice(tab.id, width, height, isMobile);
    await chrome.tabs.update(tab.id, { url: row.url });
    await waitForPageLoad(tab.id);

    // Chrome DevTools Protocol (CDP) で以下を実行
    // - 1. 指定の URL を開く
    // - 2. ユーザーエージェントやデバイス等の設定を適用
    // - 3. スクリーンショットを取得
    if (flag) {
      // 手動操作モード
      await waitForUserAction(tab.id);
    } else {
      // 通常モード
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        // lazy-load 対策
        func: async () => {
          document.body.style.maxWidth = '100%';
          document.querySelectorAll('img[loading="lazy"]').forEach(img => {
            if (img.dataset.src) img.src = img.dataset.src;
            img.loading = 'eager';
          });
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(r => setTimeout(r, 1000));
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 500));
        },
      });
    }

    await takeScreenshot(tab.id, row.filename);

    // 次のタブを作成する前に少し待機（安定性のため）
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('All screenshots done. Closing window:', window.id);
  await chrome.windows.remove(window.id);
}

/**
 * メイン処理: popup.js からのメッセージを受信し、スクリーンショットを取得
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start_screenshot') {
    (async () => {
      const { device, csvRows, width, height } = message;
      console.log(`Starting screenshot (${device}) with size ${width}x${height}`);
      await createWindowAndCapture(csvRows, device, width, height);
      // popup.js に完了を伝える
      sendResponse({ status: 'done' });
    })();

    // 非同期処理の完了を待つ
    return true;
  }
});

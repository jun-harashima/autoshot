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
 * CDP（Chrome DevTools Protocol）を利用し、指定されたタブでページを開き、スクリーンショットを取得
 */
async function captureCDP(tabId, url, filename, width, height, isMobile) {
  const debugTarget = { tabId };

  // CDP を利用するため、デバッガを対象タブにアタッチ
  await chrome.debugger.attach(debugTarget, '1.3');
  console.log('Debugger attached:', tabId);

  // デバイスメトリクスを設定
  await chrome.debugger.sendCommand(debugTarget, 'Emulation.setDeviceMetricsOverride', {
    width: parseInt(width, 10) || 1280,
    height: parseInt(height, 10) || 720,
    deviceScaleFactor: 3,
    mobile: !!isMobile && isMobile !== "false", // 文字列 'false' も false に
  });

  // User-Agent（UA）を設定
  if (isMobile) {
    await chrome.debugger.sendCommand(debugTarget, 'Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
    });
  }

  // ページに遷移（UA 適用済み）
  await chrome.debugger.sendCommand(debugTarget, 'Page.navigate', { url });
  await waitForPageLoad(tabId);

  // lazy-load の対策
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      // max-width 解除
      document.body.style.maxWidth = '100%';

      // lazy-load 画像を強制的にロード
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        if (img.dataset.src) img.src = img.dataset.src;
        img.loading = 'eager';
      });

      // ページ全体をスクロールし、lazy-load を確実に発火させる
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1000));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 500));
    }
  });

  // 画像読み込み・再描画のために少し待機
  await new Promise(r => setTimeout(r, 1500));

  // スクリーンショットを取得
  const result = await chrome.debugger.sendCommand(debugTarget, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });

  const dataUrl = 'data:image/png;base64,' + result.data;

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
  });

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

    // 空のタブを作成
    const tab = await chrome.tabs.create({
      windowId: window.id,
      url: 'about:blank',
      active: true
    });

    // Chrome DevTools Protocol (CDP) で以下を実行
    // - 1. 指定の URL を開く
    // - 2. ユーザーエージェントやデバイス等の設定を適用
    // - 3. スクリーンショットを取得
    await captureCDP(tab.id, row.url, row.filename, width, height, isMobile);

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

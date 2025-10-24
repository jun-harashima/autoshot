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

// CDP 経由でスクリーンショットを取得
async function captureCDP(tabId, url, filename, width, height, isMobile) {
  const debugTarget = { tabId };

  // デバッガをアタッチ
  await chrome.debugger.attach(debugTarget, '1.3');
  console.log('Debugger attached:', tabId);

  // デバイスメトリクスの設定
  await chrome.debugger.sendCommand(debugTarget, 'Emulation.setDeviceMetricsOverride', {
    width: parseInt(width, 10) || 1280,
    height: parseInt(height, 10) || 720,
    deviceScaleFactor: 3,
    mobile: !!isMobile && isMobile !== "false", // 文字列 'false' も false に
  });

  // モバイル UA の設定
  if (isMobile) {
    await chrome.debugger.sendCommand(debugTarget, 'Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
    });
  }

  // ページに遷移（UA 適用済み状態）
  await chrome.debugger.sendCommand(debugTarget, 'Page.navigate', { url });
  await waitForPageLoad(tabId);

  // lazy-load の対策
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      // max-width 解除
      document.body.style.maxWidth = '100%';

      // lazy-load 画像を強制ロード
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        if (img.dataset.src) img.src = img.dataset.src;
        img.loading = 'eager';
      });

      // スクロールで lazy-load を確実に発火させる
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1000));
      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 500));
    }
  });

  // 画像読み込み・再描画のために少し待機
  await new Promise(r => setTimeout(r, 1500));

  // スクリーンショットの取得
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

// 新しいウィンドウで処理
async function createWindowAndCapture(csvRows, device, width, height) {
  const isMobile = device === 'mobile';

  const win = await chrome.windows.create({
    url: 'about:blank',
    type: 'normal',
    width,
    height,
    focused: false
  });
  console.log('New window created:', win.id);

  for (const row of csvRows) {
    console.log('Opening:', row.url);

    // 空白タブを作成してから captureCDP 内でページロード
    const tab = await chrome.tabs.create({
      windowId: win.id,
      url: 'about:blank',
      active: true
    });

    // captureCDP で UA とデバイスを設定してページを開き、スクショ
    await captureCDP(tab.id, row.url, row.filename, width, height, isMobile);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('All screenshots done. Closing window:', win.id);
  await chrome.windows.remove(win.id);
}


// メイン処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start_screenshot') {
    (async () => {
      const device = message.device;
      const csvRows = message.csvRows;
      const width = message.width || (device === 'mobile' ? 390 : 1280);
      const height = message.height || (device === 'mobile' ? 844 : 720);

      console.log(`Starting screenshot (${device}) with size ${width}x${height}`);
      await createWindowAndCapture(csvRows, device, width, height);
      sendResponse({ status: 'done' });
    })();

    return true;
  }
});

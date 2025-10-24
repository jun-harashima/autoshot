// ページロード待ち
async function waitForPageLoad(tabId) {
  return new Promise(resolve => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        console.log("✅ Tab loaded:", tabId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// デバッグセッション解除
async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    console.log("🧹 Detached debugger:", tabId);
  } catch (e) {
    console.warn(`⚠️ Failed to detach debugger from tab ${tabId}:`, e);
  }
}


// CDP 経由でスクリーンショット取得（改善版）
async function captureCDP(tabId, filename, width, height, isMobile) {
  const debugTarget = { tabId };

  // タブをアクティブ化して描画を有効化
  const tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await new Promise(r => setTimeout(r, 1000)); // 描画待機

  // デバッガをアタッチ
  await chrome.debugger.attach(debugTarget, "1.3");
  console.log("Debugger attached:", tabId);

  // デバイスメトリクス設定
  await chrome.debugger.sendCommand(debugTarget, "Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 3,
    mobile: isMobile,
  });

  // モバイルの UA を設定
  if (isMobile) {
    await chrome.debugger.sendCommand(debugTarget, "Emulation.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    });
  }

  // lazy-load 対策: すべての画像を eager にして強制ロード
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      // max-width 解除
      document.body.style.maxWidth = "100%";

      // lazy-load 画像を強制ロード
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        if (img.dataset.src) img.src = img.dataset.src;
        img.loading = "eager";
      });

      // スクロールで lazy-load を確実に発火させる
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 600));
      window.scrollTo(0, 0);
    }
  });

  // 画像読み込み・再描画のために少し待機
  await new Promise(r => setTimeout(r, 1500));

  // スクリーンショット取得
  const result = await chrome.debugger.sendCommand(debugTarget, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });

  const dataUrl = "data:image/png;base64," + result.data;

  // ダウンロード
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
  const isMobile = device === "mobile";

  // 新しいウィンドウを開く
  const win = await chrome.windows.create({
    url: "about:blank",
    type: "normal",
    width,
    height,
    focused: false,
  });
  console.log("🪟 New window created:", win.id);

  const tabs = [];
  for (const row of csvRows) {
    console.log("🌐 Opening:", row.url);
    const tab = await chrome.tabs.create({
      windowId: win.id,
      url: row.url,
      active: false,
    });

    // tab.id が有効になるまで待機
    while (!tab.id) {
      await new Promise(r => setTimeout(r, 100));
    }

    await waitForPageLoad(tab.id);
    tabs.push({ tab, filename: row.filename });
  }

  console.log("📄 All tabs loaded, start capturing...");

  for (const t of tabs) {
    await captureCDP(t.tab.id, t.filename, width, height, isMobile);
    await new Promise(r => setTimeout(r, 500)); // 少し間を置く
  }

  console.log("🧾 All screenshots done. Closing window:", win.id);
  await chrome.windows.remove(win.id);
}

// メイン処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);
  if (message.type === "start_screenshot") {
    (async () => {
      const device = message.device;
      const csvRows = message.csvRows;
      const width = message.width || (device === "mobile" ? 390 : 1280);
      const height = message.height || (device === "mobile" ? 844 : 720);

      console.log(`📐 Starting screenshot (${device}) with size ${width}x${height}`);
      await createWindowAndCapture(csvRows, device, width, height);
      sendResponse({ status: "done" });
    })();

    return true; // 非同期レスポンス許可
  }
});

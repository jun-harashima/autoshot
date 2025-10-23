async function capturePage(tab, filename, useCDP = false) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await new Promise(resolve => setTimeout(resolve, 1000));

  let dataUrl;

  if (useCDP) {
    const debugTarget = { tabId: tab.id };

    // 表示領域サイズを固定（スマートフォン画面相当）
    await chrome.debugger.sendCommand(debugTarget, "Emulation.setVisibleSize", {
      width: 390,
      height: 844,
    });

    // （オプション）一応トップへスクロール
    await chrome.debugger.sendCommand(debugTarget, "Runtime.evaluate", {
      expression: "window.scrollTo(0, 0)",
    });

    // 表示範囲だけキャプチャ
    const result = await chrome.debugger.sendCommand(debugTarget, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });

    dataUrl = "data:image/png;base64," + result.data;
  } else {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  }

  await chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false,
  });

  await chrome.tabs.remove(tab.id);
}

// ページをロードするまで待機（バックグラウンドタブでも OK）
async function waitForPageLoad(tabId) {
  return new Promise(resolve => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// モバイルエミュレーションを有効化する関数
async function emulateMobile(tabId) {
  const debugTarget = { tabId };

  await chrome.debugger.attach(debugTarget, "1.3");

  // iPhone 12 Pro に近い設定例
  await chrome.debugger.sendCommand(debugTarget, "Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });

  await chrome.debugger.sendCommand(debugTarget, "Emulation.setUserAgentOverride", {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  });

  // ページを再読み込み
  await chrome.debugger.sendCommand(debugTarget, "Page.reload");

  await new Promise(resolve => setTimeout(resolve, 1500)); // 少し待つ
}

// デバッグセッションを解除
async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {
    console.warn(`Failed to detach debugger from tab ${tabId}:`, e);
  }
}

// バックグラウンドでメッセージを受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "start_screenshot") {
    (async () => {
      const device = message.device;

      // 全ての URL をバックグラウンドで開く
      const tabs = [];
      for (const row of message.csvRows) {
        const tab = await chrome.tabs.create({ url: row.url, active: false });
        tabs.push({ tab, filename: row.filename });
      }

      // 全てのページを読み込むまで待機
      await Promise.all(tabs.map(t => waitForPageLoad(t.tab.id)));

      // 順番にアクティブ化し、スクリーンショットを取得
      for (const t of tabs) {
        console.log(`Capturing: ${t.filename}`);

	if (device === "mobile") {
	  await emulateMobile(t.tab.id);
	  await capturePage(t.tab, t.filename, true);  // ← CDP 経由で撮る
	  await detachDebugger(t.tab.id);
	} else {
	  await capturePage(t.tab, t.filename);
	}

        await new Promise(r => setTimeout(r, 500));
      }

      sendResponse({ status: "done" });
    })();

    return true; // 非同期レスポンスを許可
  }
});

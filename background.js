// 指定 URL のページをキャプチャしてダウンロードする関数
async function capturePage(tab, filename) {
  // タブをアクティブ化
  await chrome.tabs.update(tab.id, { active: true });

  // 対象ウィンドウにフォーカス
  await chrome.windows.update(tab.windowId, { focused: true });

  // 描画が安定するまで待機
  await new Promise(resolve => setTimeout(resolve, 1000));

  // スクリーンショットを取得
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

  // ダウンロード
  await chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: false,
  });

  // タブを閉じる
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

// バックグラウンドでメッセージを受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "start_screenshot") {
    (async () => {
      const device = message.device;
      const viewport =
        device === "mobile"
          ? { width: 375, height: 812, deviceScaleFactor: 3 }
          : { width: 1440, height: 900, deviceScaleFactor: 1.5 };

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
        await capturePage(t.tab, t.filename);
        await new Promise(r => setTimeout(r, 500)); // 少し間を空ける
      }

      sendResponse({ status: "done" });
    })();

    return true; // 非同期レスポンスを許可
  }
});

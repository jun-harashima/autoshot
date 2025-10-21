// 指定 URL のページをキャプチャしてダウンロードする関数
// url: ページ URL
// filename: 保存するファイル名
// viewport: ビューポートサイズや解像度の指定
async function capturePage(url, filename, viewport = {width: 1440, height: 900, deviceScaleFactor: 1}) {
  // 新しいタブを開く（active: true にしてアクティブ化）
  const tab = await chrome.tabs.create({ url, active: true });

  // ページが読み込まれるまで 3 秒待つ（必要に応じて調整可能）
  await new Promise(resolve => setTimeout(resolve, 3000));

  // タブの表示内容を PNG 形式でキャプチャ
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

  // ダウンロード処理
  await chrome.downloads.download({
    url: dataUrl,       // ページ全体
    filename: filename, // CSV で指定されたファイル名
    saveAs: false,      // 自動保存
  });

  // 開いたタブを閉じる
  await chrome.tabs.remove(tab.id);
}

// バックグラウンドでメッセージを受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "start_screenshot") {
    (async () => {
      // CSV の各行についてスクリーンショットを順番に取得
      for (const row of message.csvRows) {
        // デバイスによってビューポートを切り替え
        const viewport = message.device === "mobile"
          ? { width: 375, height: 812, deviceScaleFactor: 3 }  // スマホ
          : { width: 1440, height: 900, deviceScaleFactor: 1.5 }; // デスクトップ
        await capturePage(row.url, row.filename, viewport);
      }
      sendResponse({ status: "done" }); // 完了レスポンス
    })();
    return true; // 非同期レスポンスを有効化
  }
});

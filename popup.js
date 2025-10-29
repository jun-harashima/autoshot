import { DEFAULT_SIZES } from './constant.js';

document.addEventListener('DOMContentLoaded', () => {
  const csvFileInput = document.getElementById('csvFile');
  const deviceSelect = document.getElementById('device');
  const widthInput = document.getElementById('width');
  const heightInput = document.getElementById('height');
  const startBtn = document.getElementById('startBtn');

  /**
   * デバイスに応じた初期サイズを設定
   */
  function applyDefaultSize() {
    const selected = deviceSelect.value;
    const { width, height } = DEFAULT_SIZES[selected];
    widthInput.value = width;
    heightInput.value = height;
  }

  /**
   * CSV をオブジェクト配列に変換
   * @param {string} text CSV テキスト
   * @returns {Array<{url: string, filename: string}>}
   */
  function parseCSV(text) {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line)
      .map(line => {
        const [url, filename, flag] = line.split(',').map(v => v?.trim());
        return { url, filename, flag };
      })
      .filter(row => row.url && row.filename);
  }

  /**
   * スクリーンショットを取得
  */
  function captureScreenshot() {
    const file = csvFileInput.files[0];
    if (!file) {
      alert('CSV を選択してください。');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const csvRows = parseCSV(reader.result);
      if (csvRows.length === 0) {
        alert('有効な行が見つかりませんでした。');
        return;
      }

      const message = {
        type: 'start_screenshot',
        csvRows,
        device: deviceSelect.value,
        width: Number(widthInput.value),
        height: Number(heightInput.value),
      };

      chrome.runtime.sendMessage(message, () => {
        alert('スクリーンショット完了');
      });
    };

    reader.readAsText(file);
  }

  /**
   * イベントをまとめて登録
   */
  function initEventListeners() {
    // デバイスが変更されたら幅と高さを変更
    deviceSelect.addEventListener('change', applyDefaultSize);

    //「開始」がクリックされたらスクリーンショットを取得
    startBtn.addEventListener('click', captureScreenshot);
  }

  applyDefaultSize();
  initEventListeners();
});

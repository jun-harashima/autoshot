document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const csvFileInput = document.getElementById('csvFile');
  const deviceSelect = document.getElementById('device');
  const widthInput = document.getElementById('width');
  const heightInput = document.getElementById('height');

  const defaults = {
    desktop: { width: 1280, height: 720 },
    mobile: { width: 390, height: 844 },
  };

  // 初期値をセット
  const setDefaults = () => {
    const d = deviceSelect.value;
    widthInput.value = defaults[d].width;
    heightInput.value = defaults[d].height;
  };

  setDefaults(); // ページ読み込み時に初期設定

  deviceSelect.addEventListener('change', setDefaults);

  startBtn.addEventListener('click', () => {
    const file = csvFileInput.files[0];
    if (!file) return alert('CSV を選択してください');

    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split('\n').filter(l => l.trim() !== '');
      const csvRows = lines.map(line => {
        const [url, filename] = line.split(',');
        return { url, filename };
      });

      const device = deviceSelect.value;
      const width = Number(widthInput.value);
      const height = Number(heightInput.value);

      chrome.runtime.sendMessage(
        { type: 'start_screenshot', csvRows, device, width, height },
        () => alert('スクリーンショット完了')
      );
    };
    reader.readAsText(file);
  });
});

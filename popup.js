// DOM が完全に読み込まれたら処理を開始
document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');    // 「開始」ボタン
    const csvFileInput = document.getElementById('csvFile'); // CSV ファイル入力
    const deviceSelect = document.getElementById('device');  // デバイス選択 (desktop/mobile)

    // 開始ボタンクリック時の処理
    startBtn.addEventListener('click', () => {
        const file = csvFileInput.files[0];
        if (!file) return alert("CSV を選択してください");

        const reader = new FileReader();
        // ファイル読み込み完了時の処理
        reader.onload = () => {
            // 改行で分割して空行は除去
            const lines = reader.result.split('\n').filter(l => l.trim() !== '');
            // CSV の各行を {url, filename} オブジェクトに変換
            const csvRows = lines.map(line => {
                const [url, filename] = line.split(',');
                return {url, filename};
            });

            const device = deviceSelect.value; // 選択されたデバイス情報

            // バックグラウンドスクリプトにメッセージを送信
            chrome.runtime.sendMessage(
                {type: 'start_screenshot', csvRows, device},
                (resp) => {
                    alert('スクリーンショット完了'); // ユーザーに通知
                }
            );
        };
        // CSV ファイルをテキストとして読み込む
        reader.readAsText(file);
    });
});

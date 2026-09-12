# 券商市占觀測站

GitHub Pages 靜態網站，查詢券商總公司經紀合計、總公司營業單位及各分公司在上市、上櫃與合併市場的市占率。包含可切換市占率／成交金額的堆疊長條圖、最多十家總公司或分公司的月度市占率比較曲線、可搜尋明細及結束營業紀錄。

已收錄 **2015-01 至 2026-08，涵蓋 140 個月、280 份已驗證官方月報（140 個月具完整雙市場資料）**。沒有使用模擬資料。

**2026-02 上櫃的官方線上 XLS 與 ODS 下載曾回傳 2026-08 的內容；本月份改採使用者提供的官方月報 `11502brk3.xls`，經年月、總分公司小計與市場總額驗證後匯入。原始檔 SHA-256：`89812e50b1204348fb8998b37249acd7aeb228b4899a590ac7fae28d5d80a2d9`。**

## 部署到 GitHub Pages

1. 將本資料夾的內容放在 GitHub 儲存庫根目錄，包含 `.github/workflows/pages.yml`；預設分支使用 `main`。
2. 儲存庫 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
3. 推送到 `main`，或在 Actions 手動執行 **Update official data and deploy Pages**。
4. 成功後，網址會顯示於 workflow 的 `github-pages` environment，通常為 `https://帳號.github.io/儲存庫名稱/`。

網站全部使用相對路徑，支援 GitHub Pages 專案子目錄，不需要 API 金鑰或伺服器。

部署方式依 [GitHub Pages 官方自訂 workflow 文件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。目標儲存庫為 `chuanchung/market-share`。

## 本機使用

需要 Python 3.12+，只看網站不必安裝 Python 套件：

```sh
python -m http.server 8765 --directory site
```

瀏覽 `http://localhost:8765`。請透過 HTTP 開啟，直接雙擊 HTML 的 `file://` 模式無法讀取 JSON。

更新資料：

```sh
pip install -r requirements.txt
python scripts/update_data.py --start 2015-01
```

補抓指定區間或重抓修訂資料：

```sh
python scripts/update_data.py --start 2025-01 --end 2025-12 --refresh
```

自動流程在每月 8、12、16、20 日台灣時間 11:00 檢查新月份並重抓近期報表。排程可能延遲，實際以 GitHub 執行時間為準。推送部署使用版本庫已有的資料；手動與排程部署會抓取新資料。更新結果包含在 Pages 部署產物，不會自動提交回原始碼儲存庫。需要保存歷史更正時，可本機執行更新並提交 JSON。

若官方下載失敗、格式改變或金額核對不符，workflow 失敗並保留前次線上網站。若官方下載回傳錯誤月份，會排除該檔案並記錄警告，其他正確月份仍可更新；不會把缺失金額填為零。對官方格式更動採明確報錯，而非猜測新欄位。

## 計算定義

- 成交金額為買進＋賣出金額，單位統一新台幣元。
- 券商分子是經紀成交金額；全市場分母包含經紀與自營，與原月報市占率口徑一致。上市以經紀合計加自營加總得分母，並逐筆比對官方百分比；上櫃直接使用報表合計並再核對各經紀合計與自營加總。
- 跨月、跨市場均先加總成交金額再相除；不平均月市占率，也不直接把上市與上櫃百分比相加。
- 合併長條圖：藍段為上市成交金額／雙市場分母，金段為上櫃成交金額／雙市場分母。
- 經紀合計包含總公司與分公司，不和營業單位重複加總。總公司營業單位按報表辨識，不能和 `*` 經紀合計混為一談。
- 分公司歸屬依報表順序、類型與小計核對；例如 `9182` 屬於 `910*`。大小寫代號保持區分。
- 部分 TPEx 報表的經紀合計代號為空，會依該報表所屬總公司建立 `*` 代號；名稱更動可能拆列，依相同代號及相同母公司加總，保留別名並對照官方小計。
- 未出現在月報的券商記為「未列示」。區間部分未列示時標 `*`，只顯示已列示金額占完整市場的比例；月度圖保留斷點。報表明列零與未列示不同。
- 不回溯合併被併購券商的歷史成交。結束營業名冊含最後營業日／合併基準日及存續／代辦券商，僅涵蓋總公司，不推測分公司是否已停業。

## 資料來源與驗證

- [TWSE 證券商月報－證券商成交金額表](https://www.twse.com.tw/zh/trading/statistics/index03.html)
- [TPEx 證券商成交金額](https://www.tpex.org.tw/zh-tw/mainboard/trading/statistics/securities-firms/trading-amount.html)
- [TWSE 證券商結束營業資料](https://dsp.twse.com.tw/brokerClose/list#tab1)

每份 JSON 附原始下載連結及下載檔 SHA-256。兩市場商品與交易涵蓋範圍以官方報表註記為準，合併值是這兩份月報的成交金額加總。

```sh
npm test
```

測試含成交金額加權、堆疊比例、總分公司避免重複、大小寫代號、缺值與零、跨年月份、全部月報金額核對及已知官方樣本。

## 檔案

- `site/`：全部公開靜態檔與已驗證月資料。
- `scripts/update_data.py`：官方下載、解析及檢核。
- `tests/engine.test.js`：資料及計算測試。
- `.github/workflows/pages.yml`：更新與部署。

官方下載遇到企業代理憑證的 Python 3.13 嚴格驗證相容性问题時，可設定 `BROKER_TLS_COMPAT=1`；仍啟用憑證鏈與主機驗證。一般 GitHub runner 不需此設定。

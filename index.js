const puppeteer = require("puppeteer-core");
const fs = require("fs");
const XLSX = require("xlsx");
const { google } = require("googleapis");

const CLIENT_IDS = ["325161","325162"];
const STORE_NAMES = { "325161":"大山","325162":"一宮"};
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

(async () => {
  const browser = await puppeteer.launch({
    executablePath:"/usr/bin/google-chrome",
    headless:"new",
    args:["--no-sandbox","--disable-setuid-sandbox"]
});

const page = await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });
await page.setDefaultNavigationTimeout(60000);

console.log("Timeeログイン開始");
const loginUrls = [
 "https://app-new.taimee.co.jp/login",
 "https://app.taimee.co.jp/login",
 "https://app-new.taimee.co.jp/account"
];

let loaded=false;
for(const url of loginUrls){
  try{
    console.log(`アクセス試行中: ${url}`);
    await page.goto(url,{waitUntil:"networkidle2"});
    await page.waitForSelector("input",{timeout:5000});
    console.log("ログイン　ページ:",url);
    loaded=true;
    break;
 }catch(e){}
}
if(!loaded) {
  await page.screenshot({ path: 'login_error_debug.png' });
  throw new Error("ログインページ取得失敗");
}

await page.type( 'input[type="email"], input[name*="email"], input[placeholder*="メール"]',process.env.TAIMEE_EMAIL);
await page.type('input[type="password"]',process.env.TAIMEE_PASSWORD);
await Promise.all([
  page.waitForNavigation({waitUntil:"networkidle2"}),
  page.click('button[type="submit"]')
]);
console.log("ログイン成功");
 
/* 現在時刻 */
const now = new Date();
const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
const hour = jstNow.getHours();
const MODE = hour < 12 ? "morning" : "workcheck";

const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
const yyyy = parts.find(p => p.type === 'year').value;
const mm = parts.find(p => p.type === 'month').value;
const dd = parts.find(p => p.type === 'day').value; 
const date = `${yyyy}/${mm}/${dd}`;
const time = jstNow.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

let message = `【Timee勤務確認】\n  ${date} ${time}\n`;
let anyStoreSent = false; // 少なくとも1店舗が更新されたか
let sendSlack = true;

/* 店舗ループ */
for(const CLIENT_ID of CLIENT_IDS){
  const store = STORE_NAMES[CLIENT_ID];

  const downloadPath = process.cwd();
  fs.readdirSync(downloadPath).forEach(f => {
    if(f.endsWith('.xlsx')) fs.unlinkSync(f);
  });

  // 検索する日付（ここでは3月19日に固定）
  //const targetDateStr = `${yyyy}年${mm}月${dd}日`;
  const searchDate = "3月19日";
  const dateParam = "2026-03-19";
  //const dateParam = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings?date_from=${dateParam}&date_to=${dateParam}`;
  console.log(`\n--- ${store} 処理開始 ---`);
  console.log(`URL: ${offeringsUrl}`);
  await page.goto(offeringsUrl, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 5000));
// --- ⓶ 日付を100件分拾い上げる（デバッグ用） ---
try {
    console.log(`--- ${store} 全日付抽出（最大100件）開始 ---`);
    
    const allDates = await page.evaluate(() => {
        const results = [];
        // タイミーのリスト行（tr）をすべて取得
        const rows = Array.from(document.querySelectorAll('tr.css-1wwuwwa'));
        
        rows.forEach((row, index) => {
            // 日付が入っている可能性が高いspan、または行全体のテキスト
            const dateSpan = row.querySelector('span.css-1r5gb7q');
            const dateText = dateSpan ? dateSpan.innerText.trim() : "日付要素なし";
            const rowSummary = row.innerText.replace(/\n/g, ' ').substring(0, 30); // 行の冒頭30文字
            
            results.push({
                index: index + 1,
                date: dateText,
                summary: rowSummary
            });
        });
        return results;
    });

    console.log(`[抽出結果] ${store}: 合計 ${allDates.length} 件の行を発見しました。`);
    
    if (allDates.length > 0) {
        // 最初の100件を表示（実際は1ページ20〜50件程度のはず）
        allDates.slice(0, 100).forEach(item => {
            console.log(` 行${item.index}: [日付] ${item.date} | [内容] ${item.summary}...`);
        });
    } else {
        console.log(` ⚠ 行が1件も見つかりませんでした。セレクタ 'tr.css-1wwuwwa' を再確認してください。`);
    }

    await page.screenshot({ path: `debug_full_scan_${store}.png`, fullPage: true });

} catch (err) {
    console.log(`${store} 100件抽出中にエラー:`, err.message);
}

  
// --- ⓵ リスト表示への切り替え確認 & 強制待ち ---
try {
    console.log(`${store} リスト表示の最終確認中...`);
    await page.waitForSelector('table, tr.css-1wwuwwa', { timeout: 15000 });
    // 描画が安定するまで少し長めに待機（一宮のデータ量が多い可能性を考慮）
    await new Promise(r => setTimeout(r, 7000)); 
    console.log(`${store} 描画待ち完了。スキャンを開始します。`);
} catch (e) {
    console.log(`${store} テーブルが見つかりません。HTML構造が変わった可能性があります。`);
}

  // --- ⓵ リスト表示に切り替え ---
  try {
    console.log(`${store} リスト表示への切り替えを試行...`);
    await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const listBtn = buttons.find(b => {
        const text = b.innerText || "";
        return text.includes('リスト表示');
      });
      if (listBtn) {
        listBtn.click();
        return "clicked";
      }
      return "not_found";
    });
    console.log(`${store} リスト反映待ち...`);
    await page.waitForSelector('table', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 5000));
    console.log(`${store} リスト表示の確認完了`);
    await page.screenshot({ path: `debug_${store}_list_result.png`, fullPage: true });
  } catch (e) {
    console.log(`${store} リスト切り替え失敗:`, e.message);
    await page.screenshot({ path: `error_${store}_toggle_fail.png` });
  }

////ここから確認テスト
  // --- リスト表示確認後の検索・ログ出力セクション ---
  try {
    console.log(`--- ${store} 「${searchDate}」の抽出を開始 ---`);
    const searchResult = await page.evaluate((targetText) => {
      const elements = Array.from(document.querySelectorAll('div, span, td'));
      const matches = elements.filter(el =>
        el.innerText &&
        el.innerText.includes(targetText) &&
        el.children.length === 0
      );

      return {
        count: matches.length,
        contents: matches.slice(0, 10).map(el => el.innerText.trim())
      };
    }, searchDate);
    console.log(`[結果] ${store}: 「${searchDate}」は ${searchResult.count} 件見つかりました。`);
    
    if (searchResult.count > 0) {
      searchResult.contents.forEach((text, index) => {
        console.log(`  発見(${index + 1}): ${text.replace(/\n/g, ' ')}`);
      });
    } else {
      console.log(`  ⚠ ${searchDate} を含む要素は見つかりませんでした。`);
      // デバッグ用に画面全体のテキストを少し出す
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
      console.log(`  画面冒頭のテキスト: ${bodyText.replace(/\n/g, ' ')}`);
    }

    await page.screenshot({ path: `final_search_${store}.png`, fullPage: true });
    console.log(`--- ${store} 抽出完了 ---`);

  } catch (err) {
    console.log(`${store} 検索処理中にエラー:`, err.message);
  }
  



}
  await browser.close();
})();


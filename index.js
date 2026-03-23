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
// --- 修正版：一宮・大山 共通抽出ロジック ---
const targetDate = "2026年3月19日";
const results = [];
const seenLinks = new Set(); // 重複排除用

// 1. 全ての求人リンク（aタグ）を取得
const jobLinks = document.querySelectorAll('td.show-all-cond a[href*="/offerings/"]');

jobLinks.forEach(link => {
    const jobUrl = link.href;
    if (seenLinks.has(jobUrl)) return; // すでに処理した求人はスキップ

    // 2. そのリンクが含まれる「求人行(tr)」を特定
    const row = link.closest('tr');
    if (!row) return;

    // 3. その行、またはその「次の行（スマホ用詳細行）」から日時を探す
    const nextRow = row.nextElementSibling;
    const combinedText = row.innerText + (nextRow ? nextRow.innerText : "");

    // 4. 日本時間の「3月19日」が含まれている場合のみ抽出
    if (combinedText.includes(targetDate)) {
        seenLinks.add(jobUrl);
        
        // 必要な情報を整理
        const status = row.querySelector('div[class*="bg-offeringStatus"]')?.innerText || "不明";
        const title = link.innerText.trim();
        const timeMatch = combinedText.match(/\d{1,2}:\d{2}\s~\s\d{1,2}:\d{2}/);
        const time = timeMatch ? timeMatch[0] : "時間不明";

        results.push({
            status: status,
            title: title,
            time: time,
            url: jobUrl
        });
    }
});

console.log(`[抽出完了] ${targetDate}分: ${results.length}件発見`);
console.table(results);

}
  await browser.close();
})();


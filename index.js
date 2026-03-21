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


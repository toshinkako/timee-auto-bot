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

await page.goto("https://app-new.taimee.co.jp/dashboard", {
 waitUntil: "networkidle2"
});
 console.log("ダッシュボードを表示しました");
await new Promise(r => setTimeout(r, 3000));
  
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
//const targetDateStr = `${yyyy}年${mm}月${dd}日`;
const time = jstNow.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

let message = `【Timee勤務確認】\n  ${date} ${time}\n`;
let anyStoreSent = false; // 少なくとも1店舗が更新されたか
let sendSlack = true;

for(const CLIENT_ID of CLIENT_IDS){
  const store = STORE_NAMES[CLIENT_ID];
  const targetDate = "2026年3月19日"; // ここで定義

  const downloadPath = process.cwd();
  fs.readdirSync(downloadPath).forEach(f => {
    if(f.endsWith('.xlsx')) fs.unlinkSync(f);
  });

  const dateParam = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings?date_from=${dateParam}&date_to=${dateParam}`;
  console.log(`${store} 求人一覧へ遷移中...`, offeringsUrl);
  await page.goto(offeringsUrl, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 5000));

  // --- ⓵ リスト表示に切り替え ---
  try {
    console.log(`${store} リスト表示への切り替えを試行...`);
    await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const listBtn = buttons.find(b => (b.innerText || "").includes('リスト表示'));
      if (listBtn) { listBtn.click(); return "clicked"; }
      return "not_found";
    });
    console.log(`${store} リスト反映待ち...`);
    await page.waitForSelector('table', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));
  } catch (e) {
    console.log(`${store} リスト切り替え失敗または既にリスト表示です`);
  }

  // --- ⓶ ページをめくってターゲットの日付を探す ---
  let foundStats = null;
  let pageNum = 1;
  while (pageNum <= 5) {
    console.log(`${store} ${pageNum}ページ目をスキャン中...`);
    
    const result = await page.evaluate((dateStr) => {
      const rows = Array.from(document.querySelectorAll('tr.css-1wwuwwa'));
      const targetRow = rows.find(row => row.innerText.includes(dateStr));
      if (targetRow) {
        const cells = Array.from(targetRow.querySelectorAll('td'));
        const workerCell = cells.find(td => td.innerText.includes('人'));
        return { found: true, text: workerCell ? workerCell.innerText.trim() : "0 / 0人" };
      }
      return { found: false };
    }, targetDate);

    if (result.found) {
      foundStats = result;
      console.log(`[SUCCESS] ${store} ${targetDate} を発見: ${result.text}`);
      break;
    }

    const hasNextPage = await page.evaluate(() => {
      const nextBtn = Array.from(document.querySelectorAll('button, div, li'))
                           .find(el => el.innerText === '次へ' && !el.classList.contains('css-5ej4ii'));
      if (nextBtn && !nextBtn.innerText.includes('disabled')) {
        nextBtn.click();
        return true;
      }
      return false;
    });

    if (hasNextPage) {
      await new Promise(r => setTimeout(r, 4000));
      pageNum++;
    } else {
      console.log(`${store} ${targetDate} は見つかりませんでした。`);
      break;
    }
  }

  // --- ⓷ 見つかった場合のみ、ダウンロード操作へ ---
  if (foundStats) {
    try {
      console.log(`${store} のメニュー操作を開始...`);
      const clickResult = await page.evaluate(async (dateStr) => {
        const rows = Array.from(document.querySelectorAll('tr.css-1wwuwwa'));
        const targetRow = rows.find(r => r.innerText.includes(dateStr));
        if (!targetRow) return { success: false, reason: "行の再取得に失敗" };

        const menuContainer = targetRow.querySelector('[data-testid="split-button-menu"]');
        const toggleBtn = menuContainer?.querySelector('button');
        if (!toggleBtn) return { success: false, reason: "メニューボタンなし" };

        toggleBtn.click();
        await new Promise(r => setTimeout(r, 1500));

        const menuItems = Array.from(document.querySelectorAll('button, li, [role="menuitem"]'));
        const downloadBtn = menuItems.find(i => i.innerText.includes("1日分"));
        if (downloadBtn) { downloadBtn.click(); return { success: true }; }
        return { success: false, reason: "DLボタンなし" };
      }, targetDate);

      if (clickResult.success) {
        await new Promise(r => setTimeout(r, 10000)); // DL待機
        console.log(`${store} Excelダウンロード指示完了`);
      }
    } catch (e) {
      console.log(`${store} メニュー操作エラー:`, e.message);
    }
  }
  
  // 以降、既存のファイル処理(XLSX解析等)に続く...
}

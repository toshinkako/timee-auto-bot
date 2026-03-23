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
    await page.waitForSelector('table', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 5000));
    console.log(`${store} リスト表示の確認完了`);
    await page.screenshot({ path: `debug_${store}_list_result.png`, fullPage: true });
  } catch (e) {
    console.log(`${store} リスト切り替え失敗:`, e.message);
    await page.screenshot({ path: `error_${store}_toggle_fail.png` });
  }

////ここから確認テスト
const results = await page.evaluate((targetDate) => {
  const extracted = [];
  const seenLinks = new Set();
  const jobLinks = document.querySelectorAll('a[href*="/offerings/"]');

  jobLinks.forEach(link => {
    const jobUrl = link.href;
    if (seenLinks.has(jobUrl)) return;

    const row = link.closest('tr');
    if (!row) return;

    // 行内のテキスト（日時情報が含まれる部分）を取得
    const nextRow = row.nextElementSibling;
    const isMobileRow = nextRow && nextRow.classList.contains('hide-only-desktop');
    const combinedText = (row.innerText + " " + (isMobileRow ? nextRow.innerText : "")).replace(/\s+/g, ' ');

    // 1. テキストから日時を抽出 (例: 2026年3月18日 23:30)
    // ※UTCで記録されている場合、3/19 8:30の案件は「3月18日 23:30」と書かれている可能性があります
    const dateMatch = combinedText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?(\d{1,2}):(\d{2})/);
    
    if (dateMatch) {
      const [_, y, m, d, hh, mm] = dateMatch.map(Number);
      
      // 2. UTCとしてDateオブジェクトを作成し、9時間足して日本時間(JST)にする
      const utcDate = new Date(Date.UTC(y, m - 1, d, hh, mm));
      const jstDate = new Date(utcDate.getTime() + (9 * 60 * 60 * 1000));

      // 3. 日本時間での日付文字列を作成 (例: "3月19日")
      const jstMonth = jstDate.getUTCMonth() + 1;
      const jstDay = jstDate.getUTCDate();
      const jstDateStr = `${jstMonth}月${jstDay}日`;
      
      // 日本時間での開始時刻 (例: "08:30")
      const jstHours = String(jstDate.getUTCHours()).padStart(2, '0');
      const jstMins = String(jstDate.getUTCMinutes()).padStart(2, '0');
      const jstTimeStr = `${jstHours}:${jstMins}`;

      // 4. 日本時間で「3月19日」に該当するか判定
      if (jstDateStr === targetDate) {
        seenLinks.add(jobUrl);
        const statusEl = row.querySelector('div[class*="bg-offeringStatus"]');

        const workerElem = row.querySelector('td.show-only-desktop:nth-child(5)') || row;
        const workerText = workerElem.innerText.match(/(\d+)\s*\/\s*(\d+)/);

        let currentWorkers = 0;
        let totalCapacity = 0;
        let vacanct = 0;
        if (workerText) {
          currentWorkers = parseInt(workerText[1]); // 応募人数
          totalCapacity = parseInt(workerText[2]);  // 募集定員
          vacanct = parseInt(workerText[2]) - parseInt(workerText[1])
        }
        extracted.push({
          status: statusEl ? statusEl.innerText.trim() : "不明",
          title: link.innerText.trim(),
          time_jst: jstTimeStr,
          applied: currentWorkers, // 応募済み
          capacity: totalCapacity,  // 募集定員
          vacancy: vacanct // 残り枠
         // url: jobUrl
        });
      }
    }
  });
  return extracted;
}, "3月19日");

console.log(`[JST変換後] 3月19日分の案件: ${results.length}件発見 ${currentWorkers}/${totalCapacity} 残り${vacanct}`);
console.table(results);

// --- 1. 午前・午後の集計ロジック ---
let amCount = 0; // 午前中に1分でも働く人
let pmCount = 0; // 午後に1分でも働く人
let vacancyInfo = []; // 残り枠の情報

results.forEach(job => {
    // 時間をパース (例: "08:30" や "13:00")
    const [startH, startM] = job.time_jst.split(':').map(Number);
    
    // 終了時間を取得 (original_textなどから抽出)
    // ここでは simplified に「開始から何時間か」ではなく、
    // combinedTextから取得した終了時間を使用する想定
    const timeRange = job.original_text.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
    if (timeRange) {
        const [_, startStr, endStr] = timeRange;
        const [endH, endM] = endStr.split(':').map(Number);

        // 判定：午前(12:00以前)に勤務があるか
        // 開始が12:00前なら午前勤務あり
        if (startH < 12) amCount += job.applied;

        // 判定：午後(12:00以降)に勤務があるか
        // 終了が12:00以降なら午後勤務あり
        if (endH >= 12 && !(endH === 12 && endM === 0)) pmCount += job.applied;
    }

    // 残り枠がある場合のみリストに追加
    if (job.vacancy > 0) {
        vacancyInfo.push(`残り ${job.time_jst}～ ${job.vacancy}人`);
    }
});

// --- 2. コンソール出力用のフォーマット ---
console.log(`\n--- ${store} 集計報告 ---`);
console.log(`3月19日　午前 ${amCount}人　午後 ${pmCount}人`);

if (vacancyInfo.length > 0) {
    vacancyInfo.forEach(info => console.log(info));
} else {
    console.log("残り枠なし");
}

  // 求人一覧の表示
  results.forEach(job => {
    // タイトルを少し短くして表示
    const shortTitle = job.title.length > 20 ? job.title.substring(0, 20) + "..." : job.title;
    console.log(`　${shortTitle}（${job.time_jst}～）`);
});
////ここまで
}
  await browser.close();
})();


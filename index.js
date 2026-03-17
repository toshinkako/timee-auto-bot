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
    //await page.goto(url, { waitUntil: "load", timeout: 30000 });
    //await page.waitForSelector('input[type="email"]', { timeout: 15000 });
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
const targetDateStr = `${yyyy}年${mm}月${dd}日`;
const time = jstNow.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

let message = `【Timee勤務確認】\n  ${date} ${time}\n`;
let anyStoreSent = false; // 少なくとも1店舗が更新されたか
let sendSlack = true;

/* 店舗ループ */
for(const CLIENT_ID of CLIENT_IDS){
  const store = STORE_NAMES[CLIENT_ID];

  // --- 【改善】実行前に古いファイルを削除して混同を防ぐ ---///260317
  const downloadPath = process.cwd();
  fs.readdirSync(downloadPath).forEach(f => {
    if(f.endsWith('.xlsx')) fs.unlinkSync(f);
  });
  
  const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings`;
  console.log(`${store} 求人一覧へ遷移中...`);
  await page.goto(offeringsUrl, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 5000));

  // 1. リスト表示に切り替え
  try {
    console.log(`${store} リスト表示へ切り替え試行...`);
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, span, i'));
      const listTarget = buttons.find(el =>
          el.innerText === 'list' || 
          el.textContent === 'list' || 
          el.innerText.includes('リスト')
      );
      const listBtn = listTarget?.closest('button') || listTarget;
      if (listBtn){listBtn.click();
                  }else{console.log('リストボタン見つからず',buttons)}
    });

    // リスト特有の要素（テーブル行など）が出るまで最大10秒待機
    await page.waitForFunction(() => {
        return document.querySelectorAll('tr, .css-1wwuwwa').length > 5;
    }, { timeout: 10000 }).catch(() => console.log("リスト要素の待機タイムアウト（続行します）"));
    
    await new Promise(r => setTimeout(r, 3000));
  } catch (e) { console.log("リスト切り替えエラー:", e.message); }
  
      
 // ダウンロード設定
  ///const downloadPath = process.cwd();
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath, });

  // 2. 当日の全求人行を解析
  const jobData = await page.evaluate((targetDateStr) => {
    const shortDate = targetDateStr.replace(/（.）$/, "");
    const rows = Array.from(document.querySelectorAll('tr, [class*="item"]'));
    const results = [];
  console.log(targetDateStr,shortDate,rows.length)
    rows.forEach(row => {
      const text = row.innerText || "";
      if (text.includes(targetDateStr) || text.includes(shortDate)) {
        const statusEl = row.querySelector('[class*="Status"], [class*="status"]');
        let status = statusEl ? statusEl.innerText.trim() : "";
        if(!status) {
                // クラス名から推測
                if(row.innerHTML.includes('working')) status = "稼働中";
                else if(row.innerHTML.includes('closed')) status = "募集終了";
                else status = "マッチング中";
        }
        // 時間と人数の抽出
        const timeMatch = text.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
        const workerMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*人/);
        if (timeMatch || workerMatch) {
              results.push({
                status: status,
                timeRange: timeMatch ? timeMatch[0] : "",
                workerCount: workerMatch ? workerMatch[1] : "0",
                workerLimit: workerMatch ? workerMatch[2] : "0"
              });
            }        
  console.log('status',status)          
        }
    });
    return results;
  }, targetDateStr);
  console.log(`${store} の取得結果:`, jobData);
  
  // 取得結果から vacancy（募集残）を算出
  let vacancy = "0";
  if (jobData.length > 0) {
    const totalCount = jobData.reduce((sum, job) => sum + parseInt(job.workerCount), 0);
    const totalLimit = jobData.reduce((sum, job) => sum + parseInt(job.workerLimit), 0);
    vacancy = (totalLimit - totalCount).toString();
  } else {
    console.log(`${store} 本日の求人が見つかりませんでした。`);
    // 取得失敗時は念のためスクリーンショット
    await page.screenshot({ path: `debug_${store}_no_data.png` });
    //ontinue;
  }
  // 3. 全案件が終了しているかチェック
  const isAnyJobActive = jobData.some(job => job.status === "稼働中" || job.status === "マッチング中");
  if (MODE === "workcheck" && isAnyJobActive) {
    console.log(`${store} まだ稼働中の案件があるためスキップします。`);
    continue;
  }

  
 // ボタンクリック処理
 try {
   console.log(`${store} のデータを読み込み中...`);
  await page.waitForSelector('[data-testid="split-button-menu"]', { timeout: 10000 });
  const clickResult = await page.evaluate(async (dateStr) => {
    const elements = Array.from(document.querySelectorAll('div, span, p, td'));
    const dateElement = elements.find(e => e.innerText.trim() === dateStr);
    if (!dateElement) return { success: false, reason: "日付なし" };
    const row = dateElement.closest('div[class*="row"], tr, [class*="item"], .css-0');
    const menu = row.querySelector('[data-testid="split-button-menu"]');
    if (!menu) return { success: false, reason: "メニューボタン(▼)なし" };
    menu.querySelector('button').click();
    await new Promise(r => setTimeout(r, 2000));    
    const item = Array.from(document.querySelectorAll('button, .css-v2z2ni')).find(i => i.innerText.includes("1日分をまとめて"));
    if (item) { item.click(); return { success: true }; 
    }else{
     console.log('use/items')
      const items = Array.from(document.querySelectorAll('button, [role="menuitem"]'));
      const downloadBtn = items.find(i => i.innerText.includes("1日分をまとめて"));
      if (downloadBtn) { downloadBtn.click(); return { success: true };
      }
      return { success: false, reason: "DLボタンなし" };
    }
  }, targetDateStr);

  if (!clickResult.success) {
    console.log(`${store} スキップ: ${clickResult.reason}`);
    // デバッグ用にスクリーンショットを撮る  //260317
      await page.screenshot({ path: `error_${store}_not_found.png` });
    continue;
  }
  await new Promise(r => setTimeout(r, 10000));
 } catch (e) { console.log(`${store} DLエラー:`, e.message); continue; }

 // ファイル処理
  const files = fs.readdirSync(downloadPath);
  const latestFile = files.filter(f => f.endsWith('.xlsx')).map(f => ({ name: f, time: fs.statSync(f).mtime.getTime() })).sort((a, b) => b.time - a.time)[0]?.name;
  if (!latestFile) continue;

  const filePath = `timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  fs.renameSync(latestFile, filePath);
  console.log("Excel保存完了:", filePath);

  // Excel解析
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const staff = rawData.slice(1).map(row => {
      if (!row[1] || row[1] === "氏名") return null;
      return { name: row[1], start: row[4], end: row[5] };
   }).filter(Boolean);
 const count = staff.length;
 
  // ⓵ 就業中判断
  const isWorkingNow = staff.some(s => {
    if (!s.end) return false;
    const [h, m] = s.end.split(':');
    const endTime = new Date(jstNow);
    endTime.setHours(parseInt(h), parseInt(m), 0);
    return jstNow < endTime; 
  });
   if (MODE === "workcheck" && isWorkingNow) {
        console.log(`${store} 勤務中`);
        //     sendSlack = false;
        continue;
    }
  // ⓶ 勤務時間・サマリー
   let totalHours = "0.00";
   let summaryStr = "";
    if (staff.length > 0) {
      let totalNum = 0;
      const summaryMap = {};
      staff.forEach(s => {
        const h = calcIndividualWork(s);
        totalNum += parseFloat(h);
        summaryMap[h] = (summaryMap[h] || 0) + 1;
      });
      totalHours = totalNum.toFixed(2);
      summaryStr = Object.entries(summaryMap).map(([h, c]) => `${h}時間x${c}人`).join(", ");
    }
    message += `\n${store}\n人数:${staff.length}\n`;
    staff.forEach(s => { message += `・${s.name} (${s.start}〜${s.end})\n`; });
    message += `合計勤務時間:${totalHours}時間\n内訳:${summaryStr}\n募集残:${vacancy}人\n`;
    anyStoreSent = true;
 
  // ⓷ シート上書き
  await writeSheet(date, time, store, count, staff.map(s => s.name.replace(/\s.*/g,'')).join(","), totalHours, vacancy, summaryStr);
}

// Slack通知（更新があった場合のみ）
if (SLACK_WEBHOOK && anyStoreSent) {
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message })
    });
    console.log("Slack通知完了");
 }
  await browser.close();
})();

/* --- 関数群 --- */
function calcIndividualWork(s) {
  if (!s.start || !s.end) return "0.00";
  const start = roundUp(new Date(`1970-01-01T${s.start}:00`));
  const end = roundDown(new Date(`1970-01-01T${s.end}:00`));
  let h = (end - start) / 3600000;
  if (h > 3.5) h -= 1;
  return h.toFixed(2);
}


function roundUp(date){
 const d=new Date(date);
 d.setMinutes(Math.ceil(d.getMinutes()/15)*15);
 return d;
}

function roundDown(date){
 const d=new Date(date);
 d.setMinutes(Math.floor(d.getMinutes()/15)*15);
 return d;
}

// 日付表記を統一して比較・更新する関数
async function writeSheet(date, time, store, count, staff, total, vacancy, summary) {
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const normalizeDate = (d) => d?.toString().replace(/-/g, '/').split('/').map(p => parseInt(p)).join('/') || "";
  const targetDate = normalizeDate(date);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A:C" });
  const rows = res.data.values || [];
  
  // A列(日付)とC列(店舗)が一致する行を探す
  const rowIndex = rows.findIndex(row => normalizeDate(row[0]) === targetDate && row[2]?.trim() === store.trim());

  const values = [[date, time, store, count, staff, vacancy, total, summary]];

  if (rowIndex !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`${store} のデータを上書きしました。`);
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "Sheet1!A1", valueInputOption: "USER_ENTERED", requestBody: { values }
    });
    console.log(`${store} の新規データを追加しました。`);
  }
}



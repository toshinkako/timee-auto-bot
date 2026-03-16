const puppeteer = require("puppeteer-core");
const fs = require("fs");
const XLSX = require("xlsx");
const { google } = require("googleapis");

const CLIENT_IDS = ["325161","325162"];

const STORE_NAMES = {
 "325161":"大山",
 "325162":"一宮"
};

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

(async () => {

const browser = await puppeteer.launch({
 executablePath:"/usr/bin/google-chrome",
 headless:"new",
 args:["--no-sandbox","--disable-setuid-sandbox"]
});

const page = await browser.newPage();
await page.setDefaultNavigationTimeout(60000);

console.log("Timeeログイン開始");

const loginUrls = [
 "https://app.taimee.co.jp/login",
 "https://app-new.taimee.co.jp/login",
 "https://app-new.taimee.co.jp/account"
];

let loaded=false;
for(const url of loginUrls){

 try{
  await page.goto(url,{waitUntil:"networkidle2"});
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  console.log("ログインページ:",url);
  loaded=true;
  break;
 }catch(e){}
}

if(!loaded){
 throw new Error("ログインページ取得失敗");
}

await page.type( 'input[type="email"], input[name*="email"], input[placeholder*="メール"]',process.env.TAIMEE_EMAIL);
await page.type('input[type="password"]',process.env.TAIMEE_PASSWORD);

await Promise.all([
 page.waitForNavigation({waitUntil:"networkidle2"}),
 page.click('button[type="submit"]')
]);

console.log("ログイン成功");

 // ログイン直後に、まず新ドメインのトップへ移動
 
//await page.goto("https://app-new.taimee.co.jp/dashboard", {
await page.goto("https://app-new.taimee.co.jp/account", {
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
 const dashboardUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/users/attendings`;
  console.log(`${store} への遷移を開始します...`);
  await page.goto(dashboardUrl, { waitUntil: "networkidle2" });
const vacancy = await page.evaluate(() => {
      const match = document.body.innerText.match(/あと\s*(\d+)\s*人/);
      return match ? match[1] : "0";
    });
 
 const isLoggedOut = await page.evaluate(() => document.body.innerText.includes("ログイン"));
  if (isLoggedOut) {
    console.log(`${store} セッション切れの疑い。リロードします。`);
    await page.reload({ waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`${store} のページを開きました`);
 
 // 2. ダウンロードディレクトリの設定（実行フォルダに保存するように指定）
  const downloadPath = process.cwd();
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath,
  });

 
 // 3. ボタンを探してクリック 
try {
  console.log(`${store} のデータを読み込み中...`);  
  await page.waitForSelector('main, table, [class*="list"]', { timeout: 15000 }).catch(() => {});
    // 少しスクロールして要素を読み込ませる
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(r => setTimeout(r, 2000));

 console.log(`${store} の ${targetDateStr} のボタンを探しています...`);

 const clickResult = await page.evaluate(async (dateStr) => {
  const dateElement = Array.from(document.querySelectorAll('div, span, p, td'))
                             .find(e => e.innerText.trim() === dateStr);
    if (!dateElement) return { success: false, reason: "日付が見つかりません" };
  const row = dateElement.closest('div[class*="row"], tr, [class*="item"], .css-0');
    if (!row) return { success: false, reason: "行が見つかりません" };
  const splitMenu = row.querySelector('[data-testid="split-button-menu"]');
    if (!splitMenu) return { success: false, reason: "メニューボタンが見つかりません" };
  const mainBtn = splitMenu.querySelector('button');
    mainBtn.click();
  await new Promise(r => setTimeout(r, 1200));

  const menuItems = Array.from(document.querySelectorAll('button, .css-v2z2ni'));
    const targetMenuItem = menuItems.find(item => item.innerText.includes("1日分をまとめて"));
  if (targetMenuItem) {
      targetMenuItem.click();
      return { success: true, text: `${dateStr} の「1日分をまとめて」を実行しました` };
    }
  return { success: false, reason: "1日分をまとめて ボタンが見つかりません" };
  }, targetDateStr);
 if (clickResult.success) {
    console.log(`${store} ${clickResult.text}`);
    await new Promise(r => setTimeout(r, 8000)); // DL完了待ち
  } else {
    console.log(`${store} スキップ: ${clickResult.reason}`);
    await page.screenshot({ path: `error_not_found_${CLIENT_ID}.png` });
    continue;
  }
} catch (e) {
  console.log(`${store} 操作中にエラー:`, e.message);
  continue;
}
// 4. ファイル名の特定と処理
  const files = fs.readdirSync(downloadPath);
  const latestFile = files
    .filter(f => f.endsWith('.xlsx'))
    .map(f => ({ name: f, time: fs.statSync(f).mtime.getTime() }))
    .sort((a, b) => b.time - a.time)[0]?.name;
 
  if (!latestFile) {
    console.log(`${store} ファイルが見つかりません`);
    continue;
  }
const tempPath = latestFile; // ブラウザが保存したファイル名
const filePath = `timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;
// 修正：bufferを書くのではなく、ダウンロードされたファイルをリネーム（移動）する
if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
 fs.renameSync(tempPath, filePath);
 console.log("Excel保存完了:", filePath);

/* Excel解析 */
const workbook = XLSX.readFile(filePath);
 if(!workbook.SheetNames || workbook.SheetNames.length===0){
 console.log(`${store} シートなし`);
 if(MODE==="morning"){
  await writeSheet(date,time,store,0,"","");
 }
 continue;
}
 const sheet = workbook.Sheets[workbook.SheetNames[0]];
 const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

 console.log('data:'+rawData.length+'\n'+rawData);

/* スタッフ */
 const staff = rawData.slice(1).map(row => {
      if (!row[1] || row[1] === "氏名") return null;
      return { name: row[1], start: row[4], end: row[5] };
    }).filter(Boolean);
 const count = staff.length;
 
// --- ⓶ 就業中判断（現在時刻と終了予定を比較） ---
 const isWorkingNow = staff.some(s => {
    if (!s.end) return false;
    const [h, m] = s.end.split(':');
    const endTime = new Date(jstNow);
    endTime.setHours(parseInt(h), parseInt(m), 0);
    return jstNow < endTime; 
 });

     if (MODE === "workcheck" && isWorkingNow) {
      console.log(`${store}  勤務中`);
     sendSlack = false;
      continue;
    }
 // --- ⓷ 勤務時間・サマリーの計算 ---
    let totalHours = "0.00";
    let summaryStr = "";
    if (count > 0) {
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
 // メッセージ構築
    message += `\n${store}\n人数:${count}\n`;
    staff.forEach(s => { message += `・${s.name} (${s.start}〜${s.end})\n`; });
    message += `合計勤務時間:${totalHours}時間\n内訳:${summaryStr}\n募集残:${vacancy}人\n`;
    anyStoreSent = true;
 
 // --- ④ スプレッドシート上書き記録 ---
    await writeSheet(date, time, store, count, staff.map(s => s.name.replace(/\s.*/g,'')).join(","), totalHours, vacancy, summaryStr);
  
// Slack通知（1店舗でも更新があれば送信）
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



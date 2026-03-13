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
 "https://app-new.taimee.co.jp/account"
];

let loaded=false;
for(const url of loginUrls){

 try{
  await page.goto(url,{waitUntil:"networkidle2"});
  await page.waitForSelector("input",{timeout:5000});
  console.log("ログインページ:",url);
  loaded=true;
  break;
 }catch(e){}
}

if(!loaded){
 throw new Error("ログインページ取得失敗");
}

await page.type(
 'input[type="email"], input[name*="email"], input[placeholder*="メール"]',
 process.env.TAIMEE_EMAIL
);

await page.type(
 'input[type="password"]',
 process.env.TAIMEE_PASSWORD
);

await Promise.all([
 page.waitForNavigation({waitUntil:"networkidle2"}),
 page.click('button[type="submit"]')
]);

console.log("ログイン成功");
// ログイン完了後に追加
const cookies = await page.cookies();
console.log(`取得済みクッキー数: ${cookies.length}`);
if (cookies.length === 0) {
  console.log("警告: クッキーが保存されていません。ログインに失敗している可能性があります。");
}
 await page.goto("https://app-new.taimee.co.jp",{
 waitUntil:"networkidle2"
});

 //await page.waitForTimeout(3000);
 await new Promise(r => setTimeout(r, 3000));
 
/* 現在時刻 */
const now = new Date();
const hour = Number(now.toLocaleTimeString("ja-JP",{
 timeZone:"Asia/Tokyo",
 hour:"2-digit",
 hour12:false
}));

const MODE = hour < 12 ? "morning" : "workcheck";

const parts = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
}).formatToParts(now);
const yyyy = parts.find(p => p.type === 'year').value;
const mm = parts.find(p => p.type === 'month').value;
const dd = parts.find(p => p.type === 'day').value;
 
const date = `${yyyy}/${mm}/${dd}`;

const time = now.toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"});

const from=`${yyyy}-${mm}-${dd}T00:00:00+09:00`;
const to=`${yyyy}-${mm}-${dd}T23:59:59+09:00`;

let message = `【Timee勤務確認】 ${date} ${time}\n`;
let sendSlack = true;

/* 店舗ループ */
await page.goto("https://api-app-new.taimee.co.jp/app/api/v1/health_check").catch(() => {});
for(const CLIENT_ID of CLIENT_IDS){
 const store = STORE_NAMES[CLIENT_ID];
// 1. まずその店舗の「稼働中 / 勤務予定」ページに移動する
  const dashboardUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/attending_worker_lists`;
 await page.goto(dashboardUrl, { waitUntil: "networkidle2" });
  console.log(`${store} のページを開きました`);
 
 // 2. ダウンロードディレクトリの設定（実行フォルダに保存するように指定）
  const downloadPath = process.cwd();
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath,
  });

 
 // 3. ボタンを探してクリック 
/*try {
    console.log(`${store} のダウンロードボタンを探しています...`);
    
    // ボタンが現れるまで最大10秒待つ
    await page.waitForFunction(
      () => {
        const elements = Array.from(document.querySelectorAll('button, div, span, a'));
        return elements.some(e => 
          (e.innerText.includes("エクセル") || e.innerText.includes("出力") || e.innerText.includes("ダウンロード")) &&
          e.offsetWidth > 0 && e.offsetHeight > 0
        );
      },
      { timeout: 10000 }
    ).catch(() => console.log("待機タイムアウト：画面上にボタンが見つかりません"));

    const clicked = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('button, div, span, a'));
      const target = elements.find(e => 
        (e.innerText.includes("エクセル") || e.innerText.includes("出力") || e.innerText.includes("ダウンロード")) && 
        e.offsetWidth > 0 && e.offsetHeight > 0
      );
      if (target) {
        target.click();
        return true;
      }
      return false;
    });

  if (clicked) {
      console.log(`${store} ダウンロードボタンをクリックしました。`);
      await new Promise(r => setTimeout(r, 8000)); // ダウンロード完了待ち
    } else {
      await page.screenshot({ path: `error_${CLIENT_ID}.png` });
      console.log(`${store} ボタンが見つかりませんでした。スクショを確認してください。`);
      continue;
    }
  } catch (e) {
    console.log(`${store} 操作中にエラー:`, e.message);
    continue;
  }
*/
 // --- 修正版：ボタン取得ロジック ---
try {
  console.log(`${store} のデータを読み込み中...`);
  
  // ページ内のリスト（テーブルなど）が表示されるのを待つ
  await page.waitForSelector('main, table, [class*="list"]', { timeout: 15000 }).catch(() => {});
  
  // 少しスクロールして要素を読み込ませる
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(r => setTimeout(r, 2000));

  console.log(`${store} のダウンロードボタンを検索中...`);
  
  const clickResult = await page.evaluate(() => {
    // 全ての要素を走査
    const allElements = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
    
    // 「エクセル」「出力」「ダウンロード」「CSV」などのキーワードで探す
    const target = allElements.find(e => {
      const text = e.innerText || "";
      return (text.includes("エクセル") || text.includes("出力") || text.includes("ダウンロード")) 
             && e.offsetWidth > 0 
             && e.offsetHeight > 0;
    });

    if (target) {
      target.click();
      return { success: true, text: target.innerText };
    }
    
    // 見つからない場合、デバッグ用に今のボタンっぽい要素のテキストをいくつか返す
    const fallback = allElements.slice(0, 10).map(e => e.innerText.trim()).filter(t => t.length > 0);
    return { success: false, foundTexts: fallback };
  });

  if (clickResult.success) {
    console.log(`${store} ボタン「${clickResult.text}」をクリックしました`);
    await new Promise(r => setTimeout(r, 8000)); // DL完了待ち
  } else {
    console.log(`${store} 候補テキスト:`, clickResult.foundTexts);
    await page.screenshot({ path: `error_${CLIENT_ID}.png`, fullPage: true });
    console.log(`${store} ボタン特定失敗。スクショを保存しました。`);
    
    // スタッフが0人の場合にボタンが消える仕様か確認
    const isNoWorker = await page.evaluate(() => document.body.innerText.includes("勤務予定のワーカーはいません"));
    if (isNoWorker) {
      console.log(`${store} ワーカーが0人のため、募集なしとして処理します`);
      if (MODE === "morning") {
        await writeSheet(date, time, store, 0, "", "");
      }
    }
    continue;
  }
} catch (e) {
  console.log(`${store} 操作中にエラー:`, e.message);
  continue;
}
// 4. ファイル名の特定と処理
  // ブラウザがデフォルト名で保存するため、最新のxlsxファイルを探す処理が必要
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

 console.log('data:\n'+rawData)

/* スタッフ */
 const staff = rawData.slice(1).map(row => {
  // row[1] = 氏名, row[4] = 開始, row[5] = 終了 (インデックスが正しいか要確認)
  const name = row[1];
  const start = row[4];
  const end = row[5];

  if (!name || name === "氏名") return null; // ヘッダー混入対策

  return { name, start, end };
}).filter(Boolean);
const count = staff.length;
/* 募集なし判定（朝のみ） */

if(MODE==="morning" && count===0){
 message += `${store}\n募集なし\n`;
 await writeSheet(
  date,
  time,
  store,
  0,
  "",
  ""
 );

 continue;

}

/* Slack表示 */

message += `

${store}
人数:${count}
`;

staff.forEach(s=>{
 message += `・${s.name} (${s.start}〜${s.end})\n`;
});

/* 勤務終了判定 -> 勤務中なら終了（15:30チェック） */

const allFinished = staff.every(s => s.end);

if(MODE==="workcheck" && !allFinished){
 sendSlack = false;
 console.log(`${store} 勤務中あり → スキップ`);

 continue;

}
  
/* 勤務時間計算 */

let totalHours="";

if(allFinished){

 totalHours=calcTotalWork(staff);

 message += `合計勤務時間:${totalHours}時間\n`;

}

/* Sheets記録 */

await writeSheet(
 date,
 time,
 store,
 count,
 staff.map(s=>s.name).join(","),
 totalHours
);

}

/* Slack */
if(SLACK_WEBHOOK && sendSlack){

 await fetch(SLACK_WEBHOOK,{
  method:"POST",
  headers:{
   "Content-Type":"application/json"
  },
  body:JSON.stringify({
   text:message
  })
 });

 console.log("Slack通知完了");

}

await browser.close();

})();

/* 勤務時間計算 */

function calcTotalWork(staff){

 let total=0;

 staff.forEach(s=>{

  if(!s.start||!s.end) return;

  const start=roundUp(new Date(`1970-01-01T${s.start}:00`));
  const end=roundDown(new Date(`1970-01-01T${s.end}:00`));

  let hours=(end-start)/1000/60/60;

  if(hours>3.5){
   hours-=1;
  }
  total+=hours;

 });

 return total.toFixed(2);
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

/* Sheets */

async function writeSheet(date,time,store,count,staff,total){

 const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes:["https://www.googleapis.com/auth/spreadsheets"]
 });

 const sheets = google.sheets({version:"v4",auth});

 await sheets.spreadsheets.values.append({

  spreadsheetId:process.env.SPREADSHEET_ID,

  range:"Sheet1!A1",

  valueInputOption:"USER_ENTERED",

  requestBody:{
   values:[[date,time,store,count,staff,"",total]]
  }

 });

}

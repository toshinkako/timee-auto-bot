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
await page.goto("https://app-new.taimee.co.jp",{
 waitUntil:"networkidle2"
});

 await page.waitForTimeout(3000);
 
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

for(const CLIENT_ID of CLIENT_IDS){

 const store = STORE_NAMES[CLIENT_ID];

 await new Promise(r => setTimeout(r, 2000));
 const apiUrl = `https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx?start_at_from=${encodeURIComponent(from)}&start_at_to=${encodeURIComponent(to)}`;
//const apiUrl =
//`https://app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx?start_at_from=${encodeURIComponent(from)}&start_at_to=${encodeURIComponent(to)}`;
 let res;
try {
    await page.setExtraHTTPHeaders({
      'Referer': 'https://app-new.taimee.co.jp/'
    });
    
    res = await page.goto(apiUrl, { waitUntil: "networkidle2" });
  } catch (e) {
    console.log(`${store} 通信エラー:`, e.message);
  }
/*
 for(let i=0;i<3;i++){
 try{
  res = await page.evaluate(async(url)=>{
   const r = await fetch(url,{credentials:"include"});
   const buf = await r.arrayBuffer();
   return Array.from(new Uint8Array(buf));
  },apiUrl);

  if(res) break;

  res = await page.goto(apiUrl,{waitUntil:"networkidle2"});
  if(res && res.ok()) break;
 }catch(e){console.log(e)}
}
*/
 //if(!res){
if(!res || !res.ok()){
 console.log(`${store} API取得失敗 (Status: ${res ? res.status() : 'No Response'})`);
// console.log(`${store} API取得失敗`);
 continue;
}
 
 const buffer = await res.buffer();

 /* HTML誤取得対策（ログインページ対策） */
const textCheck = buffer.toString("utf8",0,200).toLowerCase();
if (textCheck.includes("error") || textCheck.includes("認証")) {
    console.log(`${store} 認証エラーが発生しました。メッセージ:`, textCheck);
    continue; 
  }
 
if(textCheck.includes("<!doctype") || textCheck.includes("<html")){
 console.log(`${store} HTML取得（セッション切れの可能性）`);
 continue;
}
 
 const filePath=`timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;

 fs.writeFileSync(filePath,buffer);

 console.log("Excel保存:",filePath);

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

const data = XLSX.utils.sheet_to_json(sheet,{header:1});
console.log('data:\n'+data)

/* スタッフ */

const staff = data.map(row=>{

 const name = row[1];
 const start = row[4];
 const end = row[5];
 /*
 let name =
 row["氏名"]||
 row["名前"]||
 row["Name"]||
 row["ワーカー名"];
if(!name) { name = row[1];};

let start =
 row["勤務開始"]||
 row["開始時間"]||
 row["開始"];
if(!start) { start = row[4];};
 
let end =
 row["勤務終了"]||
 row["終了時間"]||
 row["終了"];
if(!end) { end = row[5];};
*/
 if(!name) return null;

 return {
  name,
  start,
  end
 };

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

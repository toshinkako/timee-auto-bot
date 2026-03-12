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

console.log("Timeeログイン開始");

await page.goto("https://app-new.taimee.co.jp/account",{waitUntil:"networkidle2"});

await page.type(
 'input[type="email"]',
 process.env.TAIMEE_EMAIL
);

await page.type(
 'input[type="password"]',
 process.env.TAIMEE_PASSWORD
);

await page.click('button[type="submit"]');

await page.waitForTimeout(8000);

console.log("ログイン成功");

/* 現在時刻 */

const now = new Date();

const yyyy = now.getFullYear();
const mm = String(now.getMonth()+1).padStart(2,"0");
const dd = String(now.getDate()).padStart(2,"0");

const date = `${yyyy}/${mm}/${dd}`;

const time =
`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

const from=`${yyyy}-${mm}-${dd}T00:00:00+09:00`;
const to=`${yyyy}-${mm}-${dd}T23:59:59+09:00`;

let message = `Timee確認 ${date} ${time}\n`;

/* 店舗ループ */

for(const CLIENT_ID of CLIENT_IDS){

 const store = STORE_NAMES[CLIENT_ID];

 const apiUrl =
`https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx?start_at_from=${encodeURIComponent(from)}&start_at_to=${encodeURIComponent(to)}`;

 const res = await page.goto(apiUrl);

 const buffer = await res.buffer();

 const filePath=`timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;

 fs.writeFileSync(filePath,buffer);

 console.log("Excel保存:",filePath);

/* Excel解析 */

const workbook = XLSX.readFile(filePath);

const sheet = workbook.Sheets[workbook.SheetNames[0]];

const data = XLSX.utils.sheet_to_json(sheet);

/* スタッフ */

const staff = data.map(row=>{

 const name =
 row["氏名"]||
 row["名前"]||
 row["Name"];

 const start =
 row["勤務開始"]||
 row["開始時間"];

 const end =
 row["勤務終了"]||
 row["終了時間"];

 if(!name) return null;

 return {
  name,
  start,
  end
 };

}).filter(Boolean);

const count = staff.length;

/* Slack表示 */

message += `

${store}
人数:${count}
`;

staff.forEach(s=>{
 message += `・${s.name} (${s.start}〜${s.end})\n`;
});

/* 勤務終了判定 */

let allFinished=true;

staff.forEach(s=>{
 if(!s.end) allFinished=false;
});

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

if(SLACK_WEBHOOK){

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

  const start=roundUp(new Date(`1970-01-01T${s.start}`));
  const end=roundDown(new Date(`1970-01-01T${s.end}`));

  let hours=(end-start)/1000/60/60;

  hours-=1;

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

  spreadsheetId:process.env.GOOGLE_SHEETS_ID,

  range:"Sheet1!A:G",

  valueInputOption:"USER_ENTERED",

  requestBody:{
   values:[
    [
     date,
     time,
     store,
     count,
     staff,
     "",
     total
    ]
   ]
  }

 });

}

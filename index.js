const puppeteer = require("puppeteer-core");
const fs = require("fs");
const XLSX = require("xlsx");
const { google } = require("googleapis");
const CLIENT_IDS = ["325161","325162"];
const STORE_NAMES = {
 "325161": "大山",
 "325162": "一宮"
};

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

(async () => {

const browser = await puppeteer.launch({
 executablePath: "/usr/bin/google-chrome",
 headless: "new",
 args:["--no-sandbox","--disable-setuid-sandbox"]
});

const page = await browser.newPage();

console.log("Timeeログイン開始");

const loginUrls=[
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

/* ログイン */

await page.type(
 'input[type="email"], input[name*="email"], input[placeholder*="メール"]',
 process.env.TAIMEE_EMAIL
);

await page.type(
 'input[type="password"]',
 process.env.TAIMEE_PASSWORD
);

const loginButton = await page.$(
 'button[type="submit"], button, input[type="submit"]'
);

await loginButton.click();

await page.waitForTimeout(8000);

console.log("ログイン成功");

/* 日付 */

const now=new Date();

const yyyy=now.getFullYear();
const mm=String(now.getMonth()+1).padStart(2,"0");
const dd=String(now.getDate()).padStart(2,"0");

const from=`${yyyy}-${mm}-${dd}T00:00:00+09:00`;
const to=`${yyyy}-${mm}-${dd}T23:59:59+09:00`;
let message = "Timee勤務データ\n";

for (const CLIENT_ID of CLIENT_IDS) {

 const apiUrl =
 `https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx?start_at_from=${encodeURIComponent(from)}&start_at_to=${encodeURIComponent(to)}`;

 const excelResponse = await page.goto(apiUrl);

 const buffer = await excelResponse.buffer();

 const filePath = `timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;

 fs.writeFileSync(filePath, buffer);

 console.log("Excel保存:", filePath);

/* Excel解析 */

const workbook = XLSX.readFile(filePath);

const sheet = workbook.Sheets[workbook.SheetNames[0]];

const data = XLSX.utils.sheet_to_json(sheet);

const staff = data.map(row => {

 const name =
  row["氏名"] ||
  row["名前"] ||
  row["Name"];

 const start =
  row["勤務開始"] ||
  row["開始時間"] ||
  row["Start"];

 const end =
  row["勤務終了"] ||
  row["終了時間"] ||
  row["End"];

 if(!name) return null;

 return `・${name} (${start}〜${end})`;

}).filter(Boolean);

const count = staff.length;

message += `

店舗 ${STORE_NAMES[CLIENT_ID]}
勤務人数: ${count}人

スタッフ
${staff.join("\n")}
`;

 await writeSheet(
 STORE_NAMES[CLIENT_ID],
 count,
 staff
);
 
}

 /* Slack通知 */

if(SLACK_WEBHOOK){

 await fetch(SLACK_WEBHOOK,{
  method:"POST",
  headers:{
   "Content-Type":"application/json"
  },
  body:JSON.stringify({text: message})
 });

 console.log("Slack通知完了");

}

await browser.close();

})();

async function writeSheet(store, count, staff){

 const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
 });

 const sheets = google.sheets({version:"v4",auth});

 const now = new Date().toLocaleDateString("ja-JP");

 await sheets.spreadsheets.values.append({
  spreadsheetId: process.env.GOOGLE_SHEETS_ID,
  range: "sheet1!A:D",
  valueInputOption:"USER_ENTERED",
  requestBody:{
   values:[
    [now,store,count,staff.join(",")]
   ]
  }
 });

}


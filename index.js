const puppeteer = require("puppeteer-core");
const fs = require("fs");
const { google } = require("googleapis");

const CLIENT_ID = process.env.CLIENT_ID;

(async () => {

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox","--disable-setuid-sandbox"]
});

const page = await browser.newPage();

console.log("Timeeログイン開始");

/* 複数URLを試す */
const loginUrls = [
 "https://app.taimee.co.jp/login",
 "https://app-new.taimee.co.jp/account"
];

let loaded=false;

for(const url of loginUrls){
 try{
   await page.goto(url,{waitUntil:"networkidle2"});
   await page.waitForSelector("input",{timeout:5000});
   loaded=true;
   console.log("ログインページ:",url);
   break;
 }catch(e){}
}

if(!loaded){
 throw new Error("ログインページ取得失敗");
}

/* email入力欄自動検出 */
const emailSelector = await page.evaluate(()=>{
 const inputs=[...document.querySelectorAll("input")];

 const emailInput=inputs.find(i =>
  i.type==="email" ||
  i.name?.includes("email") ||
  i.placeholder?.includes("メール")
 );

 return emailInput ? emailInput.outerHTML : null;
});

await page.type('input[type="email"], input[name*="email"], input[placeholder*="メール"]', process.env.TAIMEE_EMAIL);

/* password入力 */

await page.type('input[type="password"]', process.env.TAIMEE_PASSWORD);

/* ログインボタン自動検出 */

const loginButton = await page.$(
 'button[type="submit"], button, input[type="submit"]'
);

await loginButton.click();

await page.waitForTimeout(8000);

console.log("ログイン成功");

/* ここから通常処理 */

const now = new Date();

const yyyy = now.getFullYear();
const mm = String(now.getMonth()+1).padStart(2,"0");
const dd = String(now.getDate()).padStart(2,"0");

const from = `${yyyy}-${mm}-${dd}T00:00:00+09:00`;
const to = `${yyyy}-${mm}-${dd}T23:59:59+09:00`;

const apiUrl =
`https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx?start_at_from=${encodeURIComponent(from)}&start_at_to=${encodeURIComponent(to)}`;

const response = await page.goto(apiUrl);

const buffer = await response.buffer();

const filePath=`timee_${yyyy}${mm}${dd}.xlsx`;

fs.writeFileSync(filePath,buffer);

console.log("Excel保存完了");

  const { google } = require("googleapis");

/* workers取得 */

const workers = await page.evaluate(async (url) => {

 const res = await fetch(url.replace(".xlsx",".json"),{
  credentials:"include"
 });

 const data = await res.json();

 return data.workers.map(w => w.user.name);

}, apiUrl);

const workerCount = workers.length;
const names = workers.join(",");

console.log("勤務人数:", workerCount);

/* Google Sheets */

const auth = new google.auth.GoogleAuth({
 credentials: JSON.parse(process.env.GDRIVE_CREDENTIALS),
 scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({
 version: "v4",
 auth
});

await sheets.spreadsheets.values.append({
 spreadsheetId: process.env.SPREADSHEET_ID,
 range: "timee_log!A:C",
 valueInputOption: "USER_ENTERED",
 requestBody: {
  values: [
   [`${yyyy}/${mm}/${dd}`, workerCount, names]
  ]
 }
});

console.log("Sheets記録完了");
await browser.close();

})();

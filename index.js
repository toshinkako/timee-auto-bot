console.log("CLIENT_ID:", process.env.CLIENT_ID);

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

await page.goto("https://app.taimee.co.jp/login", {
  waitUntil: "networkidle2"
});

await page.waitForSelector('input[type="email"]');

await page.type('input[type="email"]', process.env.TAIMEE_EMAIL);
await page.type('input[type="password"]', process.env.TAIMEE_PASSWORD);

await page.click('button[type="submit"]');

await page.waitForTimeout(8000);

console.log("ログイン成功");
 
const now = new Date();

const yyyy = now.getFullYear();
const mm = String(now.getMonth()+1).padStart(2,"0");
const dd = String(now.getDate()).padStart(2,"0");

const from = `${yyyy}-${mm}-${dd}T00:00:00+09:00`;
const to = `${yyyy}-${mm}-${dd}T23:59:59+09:00`;

const apiUrl =
`https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx?start_at_from=${encodeURIComponent(from)}&start_at_to=${encodeURIComponent(to)}`;

const buffer = await page.evaluate(async(url)=>{
 const res = await fetch(url,{credentials:"include"});
 const arrayBuffer = await res.arrayBuffer();
 return Array.from(new Uint8Array(arrayBuffer));
},apiUrl);

const filePath=`timee_${yyyy}${mm}${dd}.xlsx`;

fs.writeFileSync(filePath,Buffer.from(buffer));

console.log("Excel保存完了");

const workers = await page.evaluate(async(url)=>{

 const res = await fetch(url.replace(".xlsx",".json"),{credentials:"include"});
 const data = await res.json();

 return data.workers.map(w=>w.user.name);

},apiUrl);

const workerCount = workers.length;

console.log("勤務人数:",workerCount);

const names = workers.join(",");

const auth = new google.auth.GoogleAuth({
 credentials: JSON.parse(process.env.GDRIVE_CREDENTIALS),
 scopes: [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets"
 ]
});

const drive = google.drive({version:"v3",auth});

await drive.files.create({
 requestBody:{
  name:filePath,
  parents:[process.env.DRIVE_FOLDER_ID]
 },
 media:{
  mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  body:fs.createReadStream(filePath)
 }
});

console.log("Driveアップロード完了");

const sheets = google.sheets({version:"v4",auth});

await sheets.spreadsheets.values.append({
 spreadsheetId: process.env.SPREADSHEET_ID,
 range:"timee_log!A:C",
 valueInputOption:"USER_ENTERED",
 requestBody:{
  values:[
   [`${yyyy}/${mm}/${dd}`,workerCount,names]
  ]
 }
});

console.log("Sheets記録完了");

await browser.close();

})();

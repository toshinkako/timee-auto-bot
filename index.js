const puppeteer = require("puppeteer-core");
const fs = require("fs");
const XLSX = require("xlsx");

const CLIENT_ID = process.env.CLIENT_ID;
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

const apiUrl=
`https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx?start_at_from=${encodeURIComponent(from)}&start_at_to=${encodeURIComponent(to)}`;

/* Excel取得 */

const excelResponse = await page.goto(apiUrl);

const buffer = await excelResponse.buffer();

const filePath=`timee_${yyyy}${mm}${dd}.xlsx`;

fs.writeFileSync(filePath,buffer);

console.log("Excel保存完了:",filePath);

/* Excel解析 */

const workbook = XLSX.readFile(filePath);

const sheetName = workbook.SheetNames[0];

const sheet = workbook.Sheets[sheetName];

const data = XLSX.utils.sheet_to_json(sheet);

const names = data.map(row=>row["氏名"] || row["名前"] || row["Name"]).filter(Boolean);

const count = names.length;

console.log("勤務人数:",count);

/* Slack通知 */

if(SLACK_WEBHOOK){

 const text =
`Timee勤務データ取得完了
勤務人数: ${count}人

スタッフ
${names.map(n=>"・"+n).join("\n")}`;

 await fetch(SLACK_WEBHOOK,{
  method:"POST",
  headers:{
   "Content-Type":"application/json"
  },
  body:JSON.stringify({text})
 });

 console.log("Slack通知完了");

}

await browser.close();

})();

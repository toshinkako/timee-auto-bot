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

/* email入力 */
await page.type('input[type="email"], input[name*="email"], input[placeholder*="メール"]', process.env.TAIMEE_EMAIL);

/* password入力 */
await page.type('input[type="password"]', process.env.TAIMEE_PASSWORD);

/* ログイン */
const loginButton = await page.$(
 'button[type="submit"], button, input[type="submit"]'
);

await loginButton.click();

await page.waitForTimeout(8000);

console.log("ログイン成功");

/* Excel取得 */

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

await browser.close();

})();

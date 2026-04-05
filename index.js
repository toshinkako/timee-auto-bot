process.env.TZ = "Asia/Tokyo";
//const now = new Date();
const now = new Date('2026/3/18 16:00');
const hour = now.getHours();
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const cachePath = './last_status.json';
let lastStatus = { vacant: null, working: null };
if (fs.existsSync(cachePath)) {
 try{
  lastStatus = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  console.log(`前回の状態( ${lastStatus.updatedAt} )`);
 } catch(e) {};
};
if (hour<12 && lastStatus.vacant===false) {
  console.log("残り枠なし。スキップ。");
  //return; またはフラグを立てる
};
if (hour>12 && hour!==16 && lastStatus.working===false) {
  console.log("退勤済み。スキップ。");
 // return; またはフラグを立てる
}
const path = require('path');
const XLSX = require("xlsx");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

const CLIENT_IDS = ["325161","325162"];
const STORE_NAMES = { "325161":"大山","325162":"一宮"};
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;
let browser;

(async () => {
try{
 //準備
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1);
  const dd = String(now.getDate());
  const date = `${yyyy}/${mm}/${dd}`;
  const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const searchDate = `${mm}月${dd}日`;
  const nxDate = now;
  nxDate.setDate(now.getDate() + 1);
   const nxm = String(nxDate.getMonth() + 1);
   const nxd = String(nxDate.getDate());
  const nxDateStr = `${nxm}月${nxd}日`;
  const nxdate = `${yyyy}/${nxm}/${nxd}`;
   
  const downloadPath = process.cwd();
  fs.readdirSync(downloadPath).forEach(f => {
    if(f.endsWith('.csv') || f.endsWith('.xlsx')) fs.unlinkSync(path.join(downloadPath, f));
  });
  browser = await puppeteer.launch({
    executablePath:"/usr/bin/google-chrome",
    headless:"new",
    args:["--no-sandbox","--disable-setuid-sandbox"]
  });
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
  
 //ログイン
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });
  await page.setDefaultNavigationTimeout(60000);
  const loginUrls = [
     "https://app-new.taimee.co.jp/login",
     "https://app.taimee.co.jp/login",
     "https://app-new.taimee.co.jp/account"
  ];
  let loaded=false;
  for(const url of loginUrls){
    try{
      await page.goto(url,{waitUntil:"networkidle2"});
      await page.waitForSelector("input",{timeout:5000});
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
  
  let sendMessage = '【Timee勤務確認】';
  let anyStoreSent = false;
  let isWorking = false;
  let anyVacancies = false;
if (hour<12 && lastStatus.vacant===false)sendMessage += '(テスト) 残なし'
if (hour>12 && hour!==16 && lastStatus.working===false) sendMessage += '(テスト) 終了'
 // 店舗ループ
 for(const CLIENT_ID of CLIENT_IDS){
  if (hour===6 && anyVacancies) continue;
  //リスト表示・データ抽出
  const store = STORE_NAMES[CLIENT_ID];
  let totalStaff = 0;
  let totalHours = 0;
  let staffNames = [];
  let storeSummaryMap = {};
  let totalVacancy = 0;
  let amTotal = 0, pmTotal = 0, shiftLines = [];
  
 console.log(`\n--- ${store} 処理開始 ---`);  
  const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings`;
  await page.goto(offeringsUrl, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 5000));
  // --- ⓵ リスト表示に切り替え ---
  await page.evaluate(async () => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const listBtn = buttons.find(b => (b.innerText || "").includes('リスト表示'));
    if (listBtn) {listBtn.click(); return "clicked"; }
    return "not_found";
  });
  await page.waitForSelector('table', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 5000));
  // --- ⓶ データの抽出
  const results = await page.evaluate((todayStr, tomorrowStr) => {
    // --- ⓵ 内部関数：1行分のテキストからデータを抽出する ---
    const parseRowData = (combinedText, row, jobUrl) => {
      const dateMatch = combinedText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?(\d{1,2}):(\d{2})/);
      if (!dateMatch) return null;
      const [_, y, m, d, hh, mm] = dateMatch.map(Number);
      const jstDateStr = `${m}月${d}日`;
      const jstTimeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (jstDateStr === todayStr || jstDateStr === tomorrowStr) {
        const timeRangeMatch = combinedText.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
        let jstEndH = 0;
        let jstTimeFull = jstTimeStr + "～";
        if (timeRangeMatch) {
          const startTime = timeRangeMatch[1].padStart(5, '0');
          const endTime = timeRangeMatch[2].padStart(5, '0');
          jstTimeFull = `${startTime}～${endTime}`;
          jstEndH = parseInt(endTime.split(':')[0], 10);
        };
        const workerElem = row.querySelector('td.show-only-desktop:nth-child(5)') || row;
        const workerText = workerElem.innerText.match(/(\d+)\s*\/\s*(\d+)/);
        let applied = workerText ? parseInt(workerText[1]) : 0;
        let capacity = workerText ? parseInt(workerText[2]) : 0;
        let status = `${jstTimeFull}　${applied} (${capacity - applied})`
        return {
          targetDate: jstDateStr, time_full: jstTimeFull,
          applied: applied, capacity: capacity, vacancy: capacity - applied,
          startH: hh, endH: jstEndH, url: jobUrl ,sts: status
        };
      }
      return null;
    };
    // --- ⓶ メイン処理 ---
    const extracted = [];
    const seenLinks = new Set();
    const jobLinks = document.querySelectorAll('a[href*="/offerings/"]');
    jobLinks.forEach(link => {
      const jobUrl = link.href;
      if (seenLinks.has(jobUrl)) return;
      const row = link.closest('tr');
      if (!row) return;
      const nextRow = row.nextElementSibling;
      const isMobileRow = nextRow && nextRow.classList.contains('hide-only-desktop');
      const combinedText = (row.innerText + " " + (isMobileRow ? nextRow.innerText : "")).replace(/\s+/g, ' ');
      const data = parseRowData(combinedText, row, jobUrl);
      if (data) {
        seenLinks.add(jobUrl);
        extracted.push(data);
      };
    });
    return extracted;
  }, searchDate, nxDateStr);

  let rDate = '';
  let jobCount = 0;
  let jobStatus = [];
  for (const job of results) {
    await page.goto(job.url, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 3000));
   //募集詳細
    if ((job.targetDate===searchDate && hour<12) || (job.targetDate===nxDateStr && hour>11)) {
     console.log(`詳細対象: ${job.targetDate} ${job.time_full}`);
      if ( rDate==='') rDate = job.targetDate;
      const details = await page.evaluate(() => {
        const matchingDiv = document.querySelector('#matching');
        if (!matchingDiv) return [];
        /// divs =
        /// const countDiv = divs.find(d => d.innerText && d.innerText.includes('マッチングしたワーカー'));
        /// const countText = countDiv ? countDiv.innerText.match(/\d+\s*\/\s*\d+人/)?.[0] || "" : "";
        const rows = Array.from(matchingDiv.querySelectorAll('table tbody tr'));
        const names = rows.map(row => {
          const nameLink = row.querySelector('a[href*="/users/"] span');
          return nameLink ? nameLink.innerText.trim().split(/[ 　]/)[0] : null;
        }).filter(name => name); // nullを除外
        return names;
      });
      jobCount++;
      totalStaff += details.length;
      const namesStr = details.length>0 ? details.join(', ') : "未応募";
      staffNames = staffNames.concat(namesStr);
      jobStatus.push(`　${job.sts}　[${namesStr}]`);
      if (job.startH < 12) amTotal += job.applied;
      if (job.endH > 13) pmTotal += job.applied;
      totalVacancy += job.vacancy;
    };  //((job.targetDate===searchDate && hour<12) || (job.targetDate===nxDateStr && hour>12))
    
    
   //勤務時間
    if (job.targetDate===searchDate && hour>12) {
     console.log(`DL対象: ${job.targetDate} ${job.time_full}`);
      const downloadPath = require('path').resolve('./downloads');
      if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);
      await page._client().send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath,
      });
      let csvBuffer = null;
      const listener = async (res) => {
        const url = res.url();
        if (!url.includes('users.csv')) return;
        if (res.request().method() !== 'GET') return;
       try{
        const buffer = await res.buffer();
        if (buffer.length < 100) return;
        if (buffer && buffer.length > 100) { csvBuffer = buffer; }
       }catch(e){ console.log("CSV取得失敗:", e.message); }
      };
      page.on('response', listener);
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector('button[data-dd-action-name*="CSVダウンロード"]');
        if(btn){
          btn.scrollIntoView();
          btn.click();
          return true;
        }
        return false;
      });
      for(let i=0;i<10;i++){
        if(csvBuffer) break;
        await new Promise(r => setTimeout(r,1000));
      };
      page.off('response', listener);
      if(!csvBuffer){ throw new Error("CSV取得失敗"); }
      const tempCsvName = `users_${CLIENT_ID}_${Date.now()}.csv`;
      const tempCsvPath = path.join(downloadPath, tempCsvName);
      fs.writeFileSync(tempCsvPath, csvBuffer);
      console.log(`CSV保存完了  ${job.targetDate} ${job.time_full}`);
      const csv = csvBuffer.toString("utf-8");
      const lines = csv.split(/\r?\n/).filter(line => line.trim() !== "");
      const data = lines.slice(1).map(l => l.split(","));
      const staff = data.map(row => {
        return { name: row[1], start: row[10], end: row[11] };
      }).filter(Boolean);
      if (fs.existsSync(tempCsvPath)) fs.unlinkSync(tempCsvPath);
      isWorking = staff.some(s => s.end === null || s.end === '');
      if (isWorking) {
        console.log(`${store} 勤務中あり`);
        continue;
      };
      staff.forEach(s => {
        const h = calcIndividualWork(s);
        totalHours += parseFloat(h);
        storeSummaryMap[h] = (storeSummaryMap[h] || 0) + 1;
      });
    }; //(job.targetDate===searchDate) 
  }; //jobループ
  let storeReport = `\n--- ${store} 報告: ${rDate}　${jobCount}件 ---`;
  if (jobCount>0) {
    storeReport += `\n　　午前 ${amTotal}人　午後 ${pmTotal}人\n${jobStatus.sort().join('\n')}\n`;
  } else {
    storeReport += '\n　募集なし';
  };
  if (totalVacancy >0) anyVacancies = true;
  if (hour===16 || hour===8 || !anyVacancies) {
    await writeSheet(nxDate,time,store,totalStaff,staffNames.join(', '),totalVacancy,'','');
  };
  

  
  if (!isWorking && results.length >0 ) {
      ///const staffNamesStr = [...new Set(staffNames)].join(", ");
      const summaryStr = Object.entries(storeSummaryMap).map(([h, c]) => `${c} x ${h}`).join(", ");
      totalHours = totalHours.toFixed(2);
console.log(date,store,totalHours,summaryStr)
     await writeSheet(date,time,store,'','','',totalHours,summaryStr);
      console.log(`${store} シート記録`);
    };



   // 店舗ごとのメッセージ組み立て
    sendMessage += storeReport;
    console.log(`${store} 完了    ${storeReport}`);

    await page.goBack({ waitUntil: "networkidle2" });
  }    //ループ終了
console.log(`anyVacancies: ${anyVacancies}  isWorking: ${isWorking}`)

 /// if (hour===16) anyStoreSent = true;
 anyStoreSent = false
  if (anyStoreSent) {
    await transporter.sendMail({
      from: `"Timee自動報告" <toshin.kakou@gmail.com>`,
      to: "mizuno.yoshifumi@marushin-gp.co.jp",
      subject: `【Timee報告】${searchDate} 勤務確認`,
      text: sendMessage, // Slackと同じ内容を送信
    });
    console.log("Gmail送信完了");
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sendMessage })
    });
    console.log("Slack通知完了");
  };
  
  try{
      const statusData = { hasVacancies: anyVacancies };
      fs.writeFileSync('last_status.json', JSON.stringify(statusData));
      console.log("Vacancyキャッシュ保存完了");
  }catch(e){ console.log('anyVacancies', e) };
  // --- 今回の結果を保存する ---
  const currentStatus = {
    vacant: anyVacancies,
    working: isWorking,
    updatedAt: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
  };
  fs.writeFileSync(cachePath, JSON.stringify(currentStatus));
  
  await browser.close();
} catch (e) { console.error("エラー発生:", e);
} finally { 
  if (browser)await browser.close()
};
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

async function writeSheet(date, time, store, count, staff, vacancy, total, summary) {
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const normalizeDate = (d) => d?.toString().replace(/-/g, '/').split('/').map(p => parseInt(p)).join('/') || "";
  const targetDate = normalizeDate(date);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A:C" });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(row => normalizeDate(row[0])===targetDate && row[2]?.trim()===store.trim());
  if (rowIndex !== -1) {
    const values = [[total, summary]];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!K${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`${store} のデータを上書きしました。${values}`);
  } else {
    const values = [[date, time, store, count, staff, vacancy, total, summary]];
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "Sheet1!A1", valueInputOption: "USER_ENTERED", requestBody: { values }
    });
    console.log(`${store} の新規データを追加しました。\n${values}`);
  }
}

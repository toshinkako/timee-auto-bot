process.env.TZ = "Asia/Tokyo";
const puppeteer = require("puppeteer-core");
const fs = require("fs");
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
  const now = new Date();
  const hour = now.getHours();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1);
  const dd = String(now.getDate());
  const date = `${yyyy}/${mm}/${dd}`;
  const time = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const searchDate = `${mm}月${dd}日`;
  ///const searchDate = "3月19日";
  ///const dateParam = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const MODE = hour < 12 ? "morning" : "workcheck";
  const nxDate = now;
  nxDate.setDate(now.getDate() + 1);
          const nxm = String(nxDate.getMonth() + 1);
          const nxd = String(nxDate.getDate());
  const nxDateStr = `${nxm}月${nxd}日`;
console.log('nxDateStr=',nxDateStr)
   
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

 // 店舗ループ
  let sendMessage = '【Timee勤務確認】';
  let anyStoreSent = true;
  let anyVacancies = false;
  let isWorking = false;
  for(const CLIENT_ID of CLIENT_IDS){
   //リスト表示・データ抽出
    const store = STORE_NAMES[CLIENT_ID];
    let totalStaff = 0;
    let totalHours = 0;
    let staffNames = [];
    let storeSummaryMap = {};
    let totalVacancy = 0;
    let amTotal = 0, pmTotal = 0, shiftLines = [];
    
    const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings`;
    /// https://app-new.taimee.co.jp/clients/325161/offerings ;
   /// const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings?date_from=${dateParam}&date_to=${dateParam}`;
    console.log(`\n--- ${store} 処理開始 ---`);
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
    const results = await page.evaluate((targetDate) => {
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
        
        const dateMatch = combinedText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?(\d{1,2}):(\d{2})/);
        if (dateMatch) {
          const [_, y, m, d, hh, mm] = dateMatch.map(Number);
          const jstDateStr = `${m}月${d}日`;
          const jstTimeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
          

          if (jstDateStr === targetDate ) {
            seenLinks.add(jobUrl);
           //時間帯get
            const timeRangeMatch = combinedText.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
            let jstEndH = 0;
            let jstTimeFull = jstTimeStr + "～";
            if (timeRangeMatch) {
              const startTime = timeRangeMatch[1].padStart(5, '0');
              const endTime = timeRangeMatch[2].padStart(5, '0');
              jstTimeFull = `${startTime}～${endTime}`;
              jstEndH = parseInt(endTime.split(':')[0], 10);
            }
           //募集状況get
            const workerElem = row.querySelector('td.show-only-desktop:nth-child(5)') || row;
            const workerText = workerElem.innerText.match(/(\d+)\s*\/\s*(\d+)/);
            let applied = workerText ? parseInt(workerText[1]) : 0;
            let capacity = workerText ? parseInt(workerText[2]) : 0;
            extracted.push({
              time_full: jstTimeFull,
              applied: applied,
              capacity: capacity,
              vacancy: capacity - applied,
              startH: parseInt(hh),
              endH: jstEndH,
              url: jobUrl
            });
          }
        }
      });
      return extracted;
    }, searchDate);
    
    let jobStatus = `${searchDate}募集: ${results.length}件 || ${nxDateStr}`;
    results.forEach(job => {
      jobStatus += '\n'+ `　時間: ${job.time_full}　${job.applied} | ${job.vacancy}`;
      totalVacancy += job.vacancy;
    });
   console.log(jobStatus);
/////
   try{
     const resultsEX = await page.evaluate((targetDate,nextDate) => {
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
        const dateMatch = combinedText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日.*?(\d{1,2}):(\d{2})/);

        if (!dateMatch) return false;
        const [_, y, m, d, hh, mm] = dateMatch.map(Number);
        const jstDateStr = `${m}月${d}日`;
        const jstTimeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
         
       if (jstTimeStr===targetDate || jstTimeStr===nextDate){
        extracted.push({ oriData: dateMatch ,nextDate:nextDate});
       }
      });
      return extracted;
    }, (searchDate,nxDateStr));
  console.log(resultsEX);
   }catch(e){console.log(e)}
/////   
   //ＣＳＶダウンロード・ワーカー詳細取得
    for (const job of results) {
     console.log(`詳細確認開始: ${job.time_full}`);
      await page.goto(job.url, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 3000));
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
          if (buffer && buffer.length > 100) {
            csvBuffer = buffer;
          }
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
      }
      page.off('response', listener);
      if(!csvBuffer){ throw new Error("CSV取得失敗"); }
      const tempCsvName = `users_${CLIENT_ID}_${Date.now()}.csv`;
      const tempCsvPath = path.join(downloadPath, tempCsvName);
      fs.writeFileSync(tempCsvPath, csvBuffer);
     console.log("CSV保存完了");
      const csv = csvBuffer.toString("utf-8");
      const lines = csv.split(/\r?\n/).filter(line => line.trim() !== "");
      const data = lines.slice(1).map(l => l.split(","));
      const staff = data.map(row => {
        return { name: row[1], start: row[10], end: row[11] };
      }).filter(Boolean);
      if (fs.existsSync(tempCsvPath)) fs.unlinkSync(tempCsvPath);
     //CSV解析
      const staffCount = staff.length;
      totalStaff += staffCount;
      staffNames.push(...staff.map(s => s.name));
     //募集確認（午前＋16時）
      if (hour<12 || hour==16) {
        if (totalVacancy >0 && hour<12) anyVacancies = true;
        if (job.startH < 12) amTotal += job.applied;
        if (job.endH > 13) pmTotal += job.applied;
        shiftLines.push(`　${job.time_full}　　${job.applied}　（${job.vacancy}）　　${staffNames}`);
      };
     //勤務結果
      console.log('勤務結果 chk')
      isWorking = staff.some(s => s.end === null || s.end === '');
      if (!isWorking && hour >12) {
        console.log(`${store} 勤務中あり`);
        if (hour !== 16) return;
        staff.forEach(s => {
          const h = calcIndividualWork(s);
          totalHours += parseFloat(h);
          storeSummaryMap[h] = (storeSummaryMap[h] || 0) + 1;
        });
      };
    }; ///for (const job of results).end
    
    if (!isWorking && results.length >0) {
      const staffNamesStr = [...new Set(staffNames)].join(", ");
      const summaryStr = Object.entries(storeSummaryMap).map(([h, c]) => `${h} x ${c}`).join(", ");
      totalHours = totalHours.toFixed(2);
      await writeSheet(date,time,store,totalStaff,staffNamesStr,totalVacancy,totalHours,summaryStr);
      console.log(`${store} シート記録`);
    };

   // 店舗ごとのメッセージ組み立て
    const storeReport = `\n--- ${store} 報告 ---\n${searchDate}　　午前 ${amTotal}人　午後 ${pmTotal}人\n${shiftLines.sort().join('\n')}\n`;
    sendMessage += storeReport;
    console.log(`${store} 完了    ${storeReport}`);

    await page.goBack({ waitUntil: "networkidle2" });
  }    //ループ終了

 /// if (hour===16) anyStoreSent = true;
 ///anyStoreSent = true
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
    if (anyVacancies){
      const statusData = { hasVacancies: anyVacancies };
      fs.writeFileSync('last_status.json', JSON.stringify(statusData));
    }
  }catch(e){ console.log('anyVacancies', e) };
  
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
  const rowIndex = rows.findIndex(row => normalizeDate(row[0]) === targetDate && row[2]?.trim() === store.trim());
  if (rowIndex !== -1) {
    const values = [[staff,total, summary]];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!J${rowIndex + 1}`,
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

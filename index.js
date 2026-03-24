const puppeteer = require("puppeteer-core");
const fs = require("fs");
const XLSX = require("xlsx");
const { google } = require("googleapis");

const CLIENT_IDS = ["325161","325162"];
const STORE_NAMES = { "325161":"大山","325162":"一宮"};
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

(async () => {
  const browser = await puppeteer.launch({
    executablePath:"/usr/bin/google-chrome",
    headless:"new",
    args:["--no-sandbox","--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });
  await page.setDefaultNavigationTimeout(60000);

  console.log("Timeeログイン開始");
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
      console.log("ログイン　ページ:",url);
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
 
  /* 現在時刻 */
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const hour = jstNow.getHours();
  const MODE = hour < 12 ? "morning" : "workcheck";

  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const yyyy = parts.find(p => p.type === 'year').value;
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value; 
  const date = `${yyyy}/${mm}/${dd}`;
  const time = jstNow.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const searchDate = "3月19日";
  const dateParam = "2026-03-19";
 // const searchDate = `${mm}月${dd}日`;
 // const dateParam = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

  
  let slackMessage = '【Timee勤務確認】';
  let anyStoreSent = false;
  let anyVacancies = false;

 /* 店舗ループ */
  for(const CLIENT_ID of CLIENT_IDS){
    const store = STORE_NAMES[CLIENT_ID];

    const downloadPath = process.cwd();
    fs.readdirSync(downloadPath).forEach(f => {
      if(f.endsWith('.xlsx')) fs.unlinkSync(f);
    });

    const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings?date_from=${dateParam}&date_to=${dateParam}`;
    console.log(`\n--- ${store} 処理開始 ---`);
    await page.goto(offeringsUrl, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 5000));
 
    // --- ⓵ リスト表示に切り替え ---
    try {
      await page.evaluate(async () => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const listBtn = buttons.find(b => (b.innerText || "").includes('リスト表示'));
        if (listBtn) {listBtn.click(); return "clicked"; }
        return "not_found";
      });
      await page.waitForSelector('table', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
      console.log(`${store} リスト切り替え失敗:`, e.message);
      await page.screenshot({ path: `error_${store}_toggle_fail.png` });
    }

    // --- ⓶ データの抽出 (UTCからJSTへの変換含む) ---
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
          const utcDate = new Date(Date.UTC(y, m - 1, d, hh, mm));
          const jstDate = new Date(utcDate.getTime() + (9 * 60 * 60 * 1000));
          const jstMonth = jstDate.getUTCMonth() + 1;
          const jstDay = jstDate.getUTCDate();
          const jstDateStr = `${jstMonth}月${jstDay}日`;
          const jstHours = String(jstDate.getUTCHours()).padStart(2, '0');
          const jstMins = String(jstDate.getUTCMinutes()).padStart(2, '0');
          const jstTimeStr = `${jstHours}:${jstMins}`;

          if (jstDateStr === targetDate) {
            seenLinks.add(jobUrl);
            const timeRangeMatch = combinedText.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
            let jstEndH = 0;
            let jstTimeFull = jstTimeStr + "～";
            if (timeRangeMatch) {
              const [eH, eM] = timeRangeMatch[2].split(':').map(Number);
              const utcEndDate = new Date(Date.UTC(y, m - 1, d, eH, eM));
              const jstEndDate = new Date(utcEndDate.getTime() + (9 * 60 * 60 * 1000));
              jstEndH = jstEndDate.getUTCHours();
              const jstEndM = String(jstEndDate.getUTCMinutes()).padStart(2, '0');
              jstTimeFull = `${jstTimeStr}～${String(jstEndH).padStart(2, '0')}:${jstEndM}`;
            }
            const workerElem = row.querySelector('td.show-only-desktop:nth-child(5)') || row;
            const workerText = workerElem.innerText.match(/(\d+)\s*\/\s*(\d+)/);
            let applied = workerText ? parseInt(workerText[1]) : 0;
            let capacity = workerText ? parseInt(workerText[2]) : 0;
            const statusEl = row.querySelector('div[class*="bg-offeringStatus"]');
            extracted.push({
              time_jst: jstTimeStr,
              time_full: jstTimeFull,
              applied: applied,
              capacity: capacity,
              vacancy: capacity - applied,
              startH: parseInt(jstHours),
              endH: jstEndH,
              url: jobUrl
            });
          }
        }
      });
      return extracted;
    }, searchDate);
    console.log(`${searchDate}募集: ${results.length}件`);

    // --- 詳細画面に移動してワーカー名を取得 ---
    for (const job of results) {
      console.log(`詳細確認中: ${job.time_full}`);
      await page.goto(job.url, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 3000));
      // --- 【デバッグ用】HTMLインナーをログ出力（後日削除） ---
      ///const bodyHTML = await page.evaluate(() => document.body.innerHTML);
      ///console.log("--- DEBUG: 募集詳細 HTML START ---");
      ///console.log(bodyHTML); 
      ///console.log("--- DEBUG: 募集詳細 HTML END ---");
      // --- デバッグ用ここまで ---
      // 2 & 3. マッチング済みセクションからワーカー名を取得
      job.workerDetails = await page.evaluate(() => {
        const details = [];
        const rows = Array.from(document.querySelectorAll('#matching tbody tr:not(.lg\\:hidden)'));
        rows.forEach(row => {
          const nameEl = row.querySelector('.text-m');
          const statusEl = row.querySelector('div[class*="bg-matchingStatus"], span[class*="Status"]');
          if (nameEl) {
            const name = nameEl.innerText.trim().split(/[\s　]+/)[0]; // 苗字のみ
            const status = statusEl ? statusEl.innerText.trim() : "確定"; // ステータスがなければ「確定」
            details.push({ name, status });
          }
        });
        return details;
      });
      console.log(`取得データ: ${job.workerDetails.map(d => `${d.name}(${d.status})`).join(", ")}`);
      
          
     /*
      job.workerNames = await page.evaluate(() => {
        const names = [];
        const selectors = ['.text-m','div[class*="WorkerName"]','.worker-name','[class*="matching"] span'];
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            const name = el.innerText.trim();
            if (name && name.length >= 2 && !names.includes(name) && !["マッチング済み", "チェックイン"].includes(name)) {
              names.push(name);
            }
          });
        });
        // 「マッチング済み」というテキストを含む要素の親を辿ってリストを探す
        // タイミーの現在の構造に合わせたセレクタ（仮：変更の可能性あり）
        const workerElements = document.querySelectorAll('div[class*="WorkerName"], .worker-name, [class*="matching"] span');
        workerElements.forEach(el => {
          const name2 = el.innerText.trim();
          if (name2 && !names.includes(name2)) name2s.push(name2);
        });
        return names;
      });
    */
      
      // 元のリスト画面に戻る
      await page.goBack({ waitUntil: "networkidle2" });
    }
    // --- ⓷ 集計と報告表示 (修正版) ---
    let amTotal = 0, pmTotal = 0, shiftLines = [];
    for (const job of results) {
      // ⓵ ワーカー名の後ろに状態を追加（ここでは一律「済み」とするか、要素から取得可能）
      const workerDisplayNames = (job.workerDetails || []).map(d => {
        return `${d.name}（${d.status}）`;
      });
      const workersStr = workerDisplayNames.join('、');      
      // ⓷ 残り枠の計算 (applied / capacity から算出)
      const vacancy = job.capacity - job.applied;
      if (vacancy > 0) anyVacancies = true;
      // 午前・午後の集計 ⓶ 報告の形式を作成
      if (job.startH < 12) amTotal += job.applied;
      if (job.endH > 13) pmTotal += job.applied;
      shiftLines.push(`　${job.time_full}　　${job.applied}　（${vacancy}）　　${workersStr}`);
    }
    // 店舗ごとのメッセージ組み立て（既存の slackMessage に追加）
    const storeReport = `\n--- ${store} 報告 ---\n${searchDate}　　午前 ${amTotal}人　午後 ${pmTotal}人\n${shiftLines.sort().join('\n')}\n`;
    slackMessage += storeReport;

    console.log(`${store} 完了`);
    if (amTotal > 0 || pmTotal > 0) anyStoreSent = true;


    // ファイル処理
    const files = fs.readdirSync(downloadPath);
    const latestFile = files.filter(f => f.endsWith('.xlsx')).map(f => ({ name: f, time: fs.statSync(f).mtime.getTime() })).sort((a, b) => b.time - a.time)[0]?.name;
    if (!latestFile) continue;
    
    const filePath = `timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(latestFile, filePath);
    console.log("Excel保存完了:", filePath);
    

  }    //ループ終了

//anyStoreSent = false
  ////ここまでWEBから
  // Slack通知（更新があった場合のみ）
  if (SLACK_WEBHOOK && anyStoreSent) {
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: slackMessage })
    });
    console.log("Slack通知完了");
 }

  const statusData = { hasVacancies: anyVacancies };
  fs.writeFileSync('last_status.json', JSON.stringify(statusData));
  await browser.close();
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

// 日付表記を統一して比較・更新する関数
async function writeSheet(date, time, store, count, staff, total, vacancy, summary) {
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;

  const normalizeDate = (d) => d?.toString().replace(/-/g, '/').split('/').map(p => parseInt(p)).join('/') || "";
  const targetDate = normalizeDate(date);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A:C" });
  const rows = res.data.values || [];
  
  // A列(日付)とC列(店舗)が一致する行を探す
  const rowIndex = rows.findIndex(row => normalizeDate(row[0]) === targetDate && row[2]?.trim() === store.trim());
  const values = [[date, time, store, count, staff, vacancy, total, summary]];
  if (rowIndex !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`${store} のデータを上書きしました。`);
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "Sheet1!A1", valueInputOption: "USER_ENTERED", requestBody: { values }
    });
    console.log(`${store} の新規データを追加しました。`);
  }
}

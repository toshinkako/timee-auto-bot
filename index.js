const puppeteer = require("puppeteer-core");
const fs = require("fs");
const XLSX = require("xlsx");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");

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
 // const searchDate = "3月19日";
 // const dateParam = "2026-03-19";
  const searchDate = `${mm}月${dd}日`;
  const dateParam = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

  
  let slackMessage = '【Timee勤務確認】';
  let anyStoreSent = false;
  let anyVacancies = false;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

 /* 店舗ループ */
  for(const CLIENT_ID of CLIENT_IDS){
    const store = STORE_NAMES[CLIENT_ID];
/*
    const downloadPath = process.cwd();
    fs.readdirSync(downloadPath).forEach(f => {
      if(f.endsWith('.xlsx')) fs.unlinkSync(f);
    });
*/
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

          // --- ⓵ チェックイン/アウト時間を取得 (4番目の列を想定) ---
          const timeCell = row.querySelectorAll('td')[3]; // 0から数えて3番目＝4列目
          let checkTime = "未読";
          if (timeCell) {
            checkTime = timeCell.innerText.trim().replace(/\s+/g, ' ');
          }

        
          if (nameEl) {
            const name = nameEl.innerText.trim().split(/[\s　]+/)[0]; // 苗字のみ
            const status = statusEl ? statusEl.innerText.trim() : "確定";
            details.push({ name, status });
          }
        });
        return details;
      });
      console.log(`取得データ: ${job.workerDetails.map(d => `${d.name}(${d.status})`).join(", ")}`);

      // ログ出力（チェックイン/アウト時間を含む）
      job.workerDetails.forEach(d => {
        console.log(`　[ログ] ${d.name}: 状態=${d.status}, 時間=${d.checkTime}`);
      });            
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

///ここから要確認
    // --- ⓶ 「CSVダウンロード」ボタンの存在確認ログ ---
      const hasCsvBtn = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('button, a'));
        const target = elements.find(el => {
          const text = el.innerText || "";
          return text.includes('CSV') && text.includes('ダウンロード');
        });
        return target ? { found: true, text: target.innerText.trim() } : { found: false };
      });
console.log(`　[ログ] CSVダウンロードボタン: ${hasCsvBtn.found ? "あり (" + hasCsvBtn.text + ")" : "なし"}`);

    // --- ⓷ CSVダウンロード実行 ---
      if (hasCsvBtn.found) {
        try{
          const downloadPath = process.cwd();
          fs.readdirSync(downloadPath).forEach(f => {
            if(f.endsWith('.xlsx')) fs.unlinkSync(f);
          });

          // ボタンをクリック
          console.log(`　[操作] CSVダウンロードをクリック...`);
          await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, a'));
            const btn = elements.find(el => el.innerText.includes('CSV') && el.innerText.includes('ダウンロード'));
            if (btn) btn.click();
          });
          let fileName = "";
          for (let i = 0; i < 10; i++) {
            const files = fs.readdirSync(downloadPath).filter(f => !f.endsWith('.crdownload')); // 一時ファイルを除外
            if (files.length > 0) {
              fileName = files[0];
              break;
            }
            await new Promise(r => setTimeout(r, 1000)); // 1秒待機
          }
          if (fileName) {
            console.log(`　[成功] ダウンロード完了: ${fileName}`);
            // --- ここでCSVの中身を確認 (最初の数行だけ) ---
            const csvContent = fs.readFileSync(path.join(downloadPath, fileName), 'utf8');
            console.log(`　[ログ] CSV冒頭: ${csvContent.split('\n').slice(0, 2).join(' ')}`);
            
            // 次の処理のためにファイルを消しておく（任意）
            // fs.unlinkSync(path.join(downloadPath, fileName));
          } else {
            console.log(`　[警告] タイムアウト: ファイルが確認できませんでした`);
          }

        } catch (e) {
          console.error(`　[エラー] CSV処理失敗: ${e.message}`);
        }
      }
          
          

        /*try {
          const downloadPath = require('path').resolve('./downloads');
          if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);
          
          await page._client().send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
          });
          console.log(`　[操作] CSVダウンロードを開始します...`);
          await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, a'));
            const btn = elements.find(el => el.innerText.includes('CSV') && el.innerText.includes('ダウンロード'));
            if (btn) btn.click();
          });
          await new Promise(resolve => setTimeout(resolve, 5000));
          const files = fs.readdirSync(downloadPath);
          console.log(`　[ログ] ダウンロード済みファイル: ${files.join(', ') || 'なし'}`);
        } catch (e) {
          console.error(`　[エラー] CSVクリック失敗: ${e.message}`);
        }
        */
      }

//ここまでテスト１

  // ボタンクリック処理
  try {
    console.log(`${store} のメニュー操作を開始...`);
    const clickResult = await page.evaluate(async (mm, dd) => {
      const rows = Array.from(document.querySelectorAll('tr.css-1wwuwwa'));  
      // 対象の日付を含む行を探す
      const targetRow = rows.find(r => r.innerText.includes(searchDate));
      if (!targetRow) return { success: false, reason: `日付(${searchDate})の行が見つかりません` };  
      // その行の中にある split-button-menu を探して、中にある展開ボタンをクリック
      const menuContainer = targetRow.querySelector('[data-testid="split-button-menu"]');
      const toggleBtn = menuContainer?.querySelector('button');  
      if (!toggleBtn) return { success: false, reason: "メニューボタンが見つかりません" };  
      toggleBtn.click();
      await new Promise(r => setTimeout(r, 2000));
      
      // 出現したメニューから「1日分をまとめて」ボタンを探す
      const menuItems = Array.from(document.querySelectorAll('button, li, [role="menuitem"]'));
      const downloadBtn = menuItems.find(i => i.innerText.includes("1日分") || i.innerText.includes("まとめて"));
      if (downloadBtn) {
        downloadBtn.click();
        return { success: true };
      }
      return { success: false, reason: "ダウンロード項目が見つかりません" };
    }, mm, dd);
    if (!clickResult.success) {
      console.log(`${store} スキップ: ${clickResult.reason}`);
      await page.screenshot({ path: `error_${store}_menu.png` });
      continue;
    }
    await new Promise(r => setTimeout(r, 10000)); // DL待機
  } catch (e) {
    console.log(`${store} 操作エラー:`, e.message);
  }

    // 元のリスト画面に戻る（コメントアウトを外して復旧）
      await page.goBack({ waitUntil: "networkidle2" });

  // ファイル処理
  //const files = fs.readdirSync(downloadPath);
  const latestFile = files.filter(f => f.endsWith('.xlsx')).map(f => ({ name: f, time: fs.statSync(f).mtime.getTime() })).sort((a, b) => b.time - a.time)[0]?.name;
  if (!latestFile) continue;
    
  const filePath = `timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  fs.renameSync(latestFile, filePath);
  console.log("Excel保存完了:", filePath);
  
  // Excel解析
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const staff = rawData.slice(1).map(row => {
      if (!row[1] || row[1] === "氏名") return null;
      return { name: row[1], start: row[4], end: row[5] };
   }).filter(Boolean);
  // ⓵ 就業中判断
  const isWorkingNow = staff.some(s => {
    if (!s.end) return false;
    const [h, m] = s.end.split(':');
    const endTime = new Date(jstNow);
    endTime.setHours(parseInt(h), parseInt(m), 0);
    return jstNow < endTime; 
  });
  if (MODE === "workcheck" && isWorkingNow) {
    console.log(`${store} 勤務中`);
    //     sendSlack = false;
    //continue;
  }
  // ⓶ 勤務時間・サマリー
  let totalHours = "0.00";
  let summaryStr = "";
  if (staff.length > 0) {
    let totalNum = 0;
    const summaryMap = {};
    staff.forEach(s => {
      const h = calcIndividualWork(s);
      totalNum += parseFloat(h);
      summaryMap[h] = (summaryMap[h] || 0) + 1;
    });
    totalHours = totalNum.toFixed(2);
    summaryStr = Object.entries(summaryMap).map(([h, c]) => `${h}時間x${c}人`).join(", ");
  }
  ///message += `\n${store}\n人数:${staff.length}\n`;
  ///staff.forEach(s => { message += `・${s.name} (${s.start}〜${s.end})\n`; });
  ///message += `合計勤務時間:${totalHours}時間\n内訳:${summaryStr}\n募集残:${vacancy}人\n`;
  ///anyStoreSent = true;
 
  // ⓷ シート上書き
  await writeSheet(date, time, store, count, staff.map(s => s.name.replace(/\s.*/g,'')).join(","), totalHours, vacancy, summaryStr);
    

}    //ループ終了

anyStoreSent = false

  if (anyStoreSent) {
      try {
      await transporter.sendMail({
        from: `"Timee自動報告システム" <toshin.kakou@gmail.com>`,
        to: "mizuno.yoshifumi@marushin-gp.co.jp",
        subject: `【Timee報告】${searchDate} 勤務確認`,
        text: slackMessage, // Slackと同じ内容を送信
      });
      console.log("Gmail送信完了");
    } catch (e) {
      console.error("Gmail送信エラー:", e.message);
    }
  }

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
    
 try{
  if (anyVacancies){
    const statusData = { hasVacancies: anyVacancies };
    fs.writeFileSync('last_status.json', JSON.stringify(statusData));
  }
}catch(e){console.log(e)}
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

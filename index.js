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
//今回追加分
    console.log(`--- ${store} 解析開始 ---`);
    await page.goto(offeringsUrl, { waitUntil: "networkidle2" });
    await new Promise(r => setTimeout(r, 3000));
    // ⓵ 募集詳細を開いてワーカー名とステータスを取得
    const detailLinkSelector = `xpath///tr[contains(., "${targetDate}")]//a[contains(@href, "offerings")]`;
    try {
      await page.waitForSelector(detailLinkSelector, { timeout: 5000 });
      await page.click(detailLinkSelector);
      await page.waitForSelector('#matching', { timeout: 10000 });
      // 詳細画面でのデータ解析
      const workerData = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#matching tbody tr:not(.lg\\:hidden)'));
        let allCheckedOut = true;
        const workers = [];
        rows.forEach(row => {
          const nameEl = row.querySelector('.text-m');
          const statusEl = row.querySelector('.bg-matchingStatus-worked-normal');
          const timeEl = row.querySelector('td:nth-child(4)'); // チェックイン/アウト列
          if (nameEl) {
            const fullName = nameEl.innerText.trim();
            const timeStr = timeEl ? timeEl.innerText : "";
            const isWorked = statusEl !== null;
            if (!isWorked) allCheckedOut = false;
            workers.push({
              name: fullName.split(/[\s　]+/)[0], // 苗字のみ
              time: timeStr
            });
            console.log(workers)
          }
        });
        return { workers, allCheckedOut };
      });
      // Slackメッセージ用：時間帯別の振り分け
      const timeGroups = { "08:30": [], "09:00": [], "13:00": [] };
      workerData.workers.forEach(w => {
        if (w.time.includes("23:30") || w.time.includes("08:30")) timeGroups["08:30"].push(w.name);
        else if (w.time.includes("09:00")) timeGroups["09:00"].push(w.name);
        else if (w.time.includes("13:00")) timeGroups["13:00"].push(w.name);
      });
      // 店舗ごとの報告ライン作成 (数値は適宜変数化してください)
      const storeReport = `
      --- ${store} 報告 ---
      ${targetDate}　　午前 5人　午後 7人
      08:30～14:30　　3　（0）　　　${timeGroups["08:30"].join('、')}
      09:00～14:30　　2　（0）　　　${timeGroups["09:00"].join('、')}
      09:00～14:30　　2　（0）　　　${timeGroups["09:00"].join('、')}
      `.trim();
      finalSlackMessage += storeReport + "\n";
      // ② 全員チェックアウト済みの場合のみ、就業予定表をダウンロード
      if (workerData.allCheckedOut) {
        console.log(`${store}: 全員稼働済みを確認。ダウンロードを開始します。`);
        const attendUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/attendances`;
        await page.goto(attendUrl, { waitUntil: "networkidle2" });
        // 該当日を探してダウンロードをクリック
        const dlBtnSelector = `xpath///tr[contains(., "${targetDate}")]//button[contains(., "ダウンロード")]`;
        await page.waitForSelector(dlBtnSelector, { timeout: 5000 });
        await page.click(dlBtnSelector);
        // 「1日分をまとめて」をクリック
        await page.waitForSelector('text/1日分をまとめて', { timeout: 5000 });
        await page.click('text/1日分をまとめて');
        await new Promise(r => setTimeout(r, 8000)); // DL完了待ち
        console.log(`${store}: ダウンロード完了`);
      } else {
        console.log(`${store}: 未稼働者がいるためDLスキップ`);
      }
    } catch (e) {
      console.log(`${store} 解析エラー:`, e.message);
    }
    
//名前取得テスト中ここから
    // --- 【新規追加】詳細画面に移動してワーカー名を取得 ---
    for (const job of results) {
      console.log(`詳細確認中: ${job.time_full}`);
      // 1. 募集詳細へ移動（jobUrlを抽出に含めるようresultsを微調整する必要があります）
      // ここでは、リスト画面で見つけたリンクを元に新しいタブか同じページで移動します
      await page.goto(job.url, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 3000));
      // --- 【デバッグ用】HTMLインナーをログ出力（後日削除） ---
      const bodyHTML = await page.evaluate(() => document.body.innerHTML);
      console.log("--- DEBUG: 募集詳細 HTML START ---");
      console.log(bodyHTML); 
      console.log("--- DEBUG: 募集詳細 HTML END ---");
      // --- デバッグ用ここまで ---
      // 2 & 3. マッチング済みセクションからワーカー名を取得
      job.workerNames = await page.evaluate(() => {
        const names = [];
        // 「マッチング済み」というテキストを含む要素の親を辿ってリストを探す
        // タイミーの現在の構造に合わせたセレクタ（仮：変更の可能性あり）
        const workerElements = document.querySelectorAll('div[class*="WorkerName"], .worker-name, [class*="matching"] span');
        
        workerElements.forEach(el => {
          const name = el.innerText.trim();
          if (name && !names.includes(name)) {
            names.push(name);
          }
        });
        return names;
      });

      console.log(`取得ワーカー: ${job.workerNames.join(", ") || "なし"}`);
      
      // 元のリスト画面に戻る
      await page.goBack({ waitUntil: "networkidle2" });
    }

    
//名前取得テスト中
    // --- ⓷ 集計と報告表示 ---
    let amTotal = 0, pmTotal = 0, shiftLines = [];
    results.forEach(job => {
      if (job.startH < 12) amTotal += job.applied;
      if (job.endH > 13) pmTotal += job.applied;
      shiftLines.push(`　${job.time_full}　　${job.applied}　（${job.vacancy}）`);
      if (job.vacancy > 0) anyVacancies = true;
    });
    slackMessage += `\n--- ${store} 報告 ---\n${searchDate}　　午前 ${amTotal}人　午後 ${pmTotal}人\n${shiftLines.sort().join('\n')}\n`;
    console.log(`${store} 完了  ${slackMessage}`);
    if(amTotal>0||pmTotal>0) anyStoreSent = true;
  }    //ループ終了

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

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const XLSX = require("xlsx");
const { google } = require("googleapis");

const CLIENT_IDS = ["325161", "325162"];
const STORE_NAMES = { "325161": "大山", "325162": "一宮" };
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.setDefaultNavigationTimeout(60000);

  console.log("Timeeログイン開始");
  await page.goto("https://app-new.taimee.co.jp/account", { waitUntil: "networkidle2" });

  await page.type('input[type="email"]', process.env.TAIMEE_EMAIL);
  await page.type('input[type="password"]', process.env.TAIMEE_PASSWORD);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click('button[type="submit"]')
  ]);
  console.log("ログイン成功");

  await page.goto("https://app-new.taimee.co.jp/dashboard", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 3000));

  /* 時刻・日付設定 */
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const hour = jstNow.getHours();
  const MODE = hour < 12 ? "morning" : "workcheck";

  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const yyyy = parts.find(p => p.type === 'year').value;
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  const date = `${yyyy}/${mm}/${dd}`;
  const targetDateStr = `${yyyy}年${mm}月${dd}日`;
  const time = jstNow.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  let message = `【Timee勤務確認】 ${date} ${time}\n`;
  let sendSlack = true;

  for (const CLIENT_ID of CLIENT_IDS) {
    const store = STORE_NAMES[CLIENT_ID];
    const dashboardUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/users/attendings`;

    console.log(`${store} への遷移を開始...`);
    await page.goto(dashboardUrl, { waitUntil: "networkidle2" });
    
    // --- ⓵ 募集残の取得 ---
    const vacancy = await page.evaluate(() => {
      const match = document.body.innerText.match(/あと\s*(\d+)\s*人/);
      return match ? match[1] : "0";
    });
    console.log(`${store} 募集残: ${vacancy}人`);

    // --- ダウンロード操作 ---
    const downloadPath = process.cwd();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

    const clickResult = await page.evaluate(async (dateStr) => {
      const dateElement = Array.from(document.querySelectorAll('div, span, p, td')).find(e => e.innerText.trim() === dateStr);
      if (!dateElement) return { success: false, reason: "日付が見つかりません" };
      const row = dateElement.closest('div[class*="row"], tr, [class*="item"], .css-0');
      const splitMenu = row?.querySelector('[data-testid="split-button-menu"]');
      if (!splitMenu) return { success: false, reason: "ボタンなし" };
      splitMenu.querySelector('button').click();
      await new Promise(r => setTimeout(r, 1200));
      const item = Array.from(document.querySelectorAll('button, .css-v2z2ni')).find(i => i.innerText.includes("1日分をまとめて"));
      if (item) { item.click(); return { success: true }; }
      return { success: false, reason: "メニューなし" };
    }, targetDateStr);

    if (!clickResult.success) { console.log(`${store} スキップ: ${clickResult.reason}`); continue; }
    await new Promise(r => setTimeout(r, 8000));

    // ファイル処理
    const files = fs.readdirSync(downloadPath);
    const latestFile = files.filter(f => f.endsWith('.xlsx')).map(f => ({ name: f, time: fs.statSync(f).mtime.getTime() })).sort((a, b) => b.time - a.time)[0]?.name;
    if (!latestFile) continue;

    const filePath = `timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(latestFile, filePath);

    // Excel解析
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const staff = rawData.slice(1).map(row => {
      if (!row[1] || row[1] === "氏名") return null;
      return { name: row[1], start: row[4], end: row[5] };
    }).filter(Boolean);

    const count = staff.length;

    // --- ⓶ 就業中判断の修正 ---
    const isWorkingNow = staff.some(s => {
      if (!s.end) return false;
      const [h, m] = s.end.split(':');
      const endTime = new Date(jstNow);
      endTime.setHours(parseInt(h), parseInt(m), 0);
      return jstNow < endTime;
    });

    if (MODE === "workcheck" && isWorkingNow) {
      console.log(`${store} 勤務中のため15:30報告を待機します。`);
      sendSlack = false;
      continue;
    }

    // --- ③ 勤務時間サマリーの計算 ---
    let totalHours = "0.00";
    let summaryStr = "";
    if (count > 0) {
      let totalNum = 0;
      const summaryMap = {};
      staff.forEach(s => {
        const hours = calcIndividualWork(s);
        totalNum += parseFloat(hours);
        summaryMap[hours] = (summaryMap[hours] || 0) + 1;
      });
      totalHours = totalNum.toFixed(2);
      summaryStr = Object.entries(summaryMap).map(([h, c]) => `${h}時間x${c}人`).join(", ");
    }

    // Slack用メッセージ構築
    message += `\n${store}\n人数:${count}\n`;
    staff.forEach(s => { message += `・${s.name} (${s.start}〜${s.end})\n`; });
    if (!isWorkingNow || MODE === "morning") {
      message += `合計勤務時間:${totalHours}時間\n内訳:${summaryStr}\n募集残:${vacancy}人\n`;
    }

    // --- ④ スプレッドシート上書き記録 ---
    await writeSheet(date, time, store, count, staff.map(s => s.name).join(","), totalHours, vacancy, summaryStr);
  }

  if (SLACK_WEBHOOK && sendSlack) {
    await fetch(SLACK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message }) });
    console.log("Slack通知完了");
  }
  await browser.close();
})();

function calcIndividualWork(s) {
  if (!s.start || !s.end) return "0.00";
  const start = roundUp(new Date(`1970-01-01T${s.start}:00`));
  const end = roundDown(new Date(`1970-01-01T${s.end}:00`));
  let h = (end - start) / 3600000;
  if (h > 3.5) h -= 1;
  return h.toFixed(2);
}

function roundUp(d) { d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15); return d; }
function roundDown(d) { d.setMinutes(Math.floor(d.getMinutes() / 15) * 15); return d; }

async function writeSheet(date, time, store, count, staff, total, vacancy, summary) {
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const normalizeDate = (d) => d?.toString().replace(/-/g, '/').split('/').map(p => parseInt(p)).join('/') || "";
  
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A:C" });
  const rows = res.data.values || [];
  const targetDate = normalizeDate(date);
  const rowIndex = rows.findIndex(row => normalizeDate(row[0]) === targetDate && row[2]?.trim() === store.trim());

  const values = [[date, time, store, count, staff, vacancy, total, summary]];
  if (rowIndex !== -1) {
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `Sheet1!A${rowIndex + 1}`, valueInputOption: "USER_ENTERED", requestBody: { values } });
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId, range: "Sheet1!A1", valueInputOption: "USER_ENTERED", requestBody: { values } });
  }
}

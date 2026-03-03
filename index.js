const puppeteer = require("puppeteer-core");
const fs = require('fs');
const { google } = require('googleapis');

const CLIENT_ID = "325162";

(async () => {

  const browser = await puppeteer.launch({
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();

  // ログイン
  await page.goto('https://app-new.taimee.co.jp/account');

  await page.type('input[name="email"]', process.env.TIMEE_ID);
  await page.type('input[name="password"]', process.env.TIMEE_PASS);

  await page.click('button[type="submit"]');
  await page.waitForNavigation();

  // 今日の日付（JST）
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');

  const from = `${yyyy}-${mm}-${dd}T00:00:00+09:00`;
  const to   = `${yyyy}-${mm}-${dd}T23:59:59+09:00`;

  const apiUrl =
    `https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx` +
    `?start_at_from=${encodeURIComponent(from)}` +
    `&start_at_to=${encodeURIComponent(to)}`;

  const response = await page.goto(apiUrl);
  const buffer = await response.buffer();

  const filePath = `timee_${yyyy}${mm}${dd}.xlsx`;
  fs.writeFileSync(filePath, buffer);

  // Driveアップロード
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GDRIVE_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  const drive = google.drive({ version: 'v3', auth });

  await drive.files.create({
    requestBody: {
      name: filePath,
      parents: [process.env.DRIVE_FOLDER_ID]
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(filePath)
    }
  });

  await browser.close();
})();

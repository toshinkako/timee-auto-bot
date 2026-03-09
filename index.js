const puppeteer = require("puppeteer-core");
const fs = require("fs");
const { google } = require("googleapis");

const CLIENT_ID = "325162";

(async () => {
  try {

    const browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome",
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

console.log("Timeeログイン開始");

await page.goto("https://app-new.taimee.co.jp/account", {
  waitUntil: "networkidle2"
});

await page.type('input[name="email"]', process.env.TIMEE_ID);
await page.type('input[name="password"]', process.env.TIMEE_PASS);

await page.click('button[type="submit"]');

await page.waitForTimeout(8000);

console.log("ログイン成功");
    
    // JST日付
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");

    const from = `${yyyy}-${mm}-${dd}T00:00:00+09:00`;
    const to = `${yyyy}-${mm}-${dd}T23:59:59+09:00`;

    const apiUrl =
      `https://api-app-new.taimee.co.jp/app/api/v1/clients/${CLIENT_ID}/attending_worker_lists/workers.xlsx` +
      `?start_at_from=${encodeURIComponent(from)}` +
      `&start_at_to=${encodeURIComponent(to)}`;

    console.log("Excelダウンロード開始");

    const buffer = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        credentials: "include"
      });
      const arrayBuffer = await res.arrayBuffer();
      return Array.from(new Uint8Array(arrayBuffer));
    }, apiUrl);

    const filePath = `timee_${yyyy}${mm}${dd}.xlsx`;

    fs.writeFileSync(filePath, Buffer.from(buffer));

    console.log("Excel保存完了:", filePath);

    // Google Drive 認証
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GDRIVE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/drive"]
    });

    const drive = google.drive({
      version: "v3",
      auth
    });

    console.log("Driveアップロード開始");

    await drive.files.create({
      requestBody: {
        name: filePath,
        parents: [process.env.DRIVE_FOLDER_ID]
      },
      media: {
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: fs.createReadStream(filePath)
      }
    });

    console.log("Driveアップロード完了");

    await browser.close();

    console.log("処理完了");

  } catch (error) {

    console.error("エラー発生");
    console.error(error);

    process.exit(1);
  }
})();

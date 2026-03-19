for(const CLIENT_ID of CLIENT_IDS){
  const store = STORE_NAMES[CLIENT_ID];
  const targetDate = "2026年3月19日"; // ここで定義

  const downloadPath = process.cwd();
  fs.readdirSync(downloadPath).forEach(f => {
    if(f.endsWith('.xlsx')) fs.unlinkSync(f);
  });

  const dateParam = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const offeringsUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/offerings?date_from=${dateParam}&date_to=${dateParam}`;
  console.log(`${store} 求人一覧へ遷移中...`, offeringsUrl);
  await page.goto(offeringsUrl, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 5000));

  // --- ⓵ リスト表示に切り替え ---
  try {
    console.log(`${store} リスト表示への切り替えを試行...`);
    await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const listBtn = buttons.find(b => (b.innerText || "").includes('リスト表示'));
      if (listBtn) { listBtn.click(); return "clicked"; }
      return "not_found";
    });
    console.log(`${store} リスト反映待ち...`);
    await page.waitForSelector('table', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 3000));
  } catch (e) {
    console.log(`${store} リスト切り替え失敗または既にリスト表示です`);
  }

  // --- ⓶ ページをめくってターゲットの日付を探す ---
  let foundStats = null;
  let pageNum = 1;
  while (pageNum <= 5) {
    console.log(`${store} ${pageNum}ページ目をスキャン中...`);
    
    const result = await page.evaluate((dateStr) => {
      const rows = Array.from(document.querySelectorAll('tr.css-1wwuwwa'));
      const targetRow = rows.find(row => row.innerText.includes(dateStr));
      if (targetRow) {
        const cells = Array.from(targetRow.querySelectorAll('td'));
        const workerCell = cells.find(td => td.innerText.includes('人'));
        return { found: true, text: workerCell ? workerCell.innerText.trim() : "0 / 0人" };
      }
      return { found: false };
    }, targetDate);

    if (result.found) {
      foundStats = result;
      console.log(`[SUCCESS] ${store} ${targetDate} を発見: ${result.text}`);
      break;
    }

    const hasNextPage = await page.evaluate(() => {
      const nextBtn = Array.from(document.querySelectorAll('button, div, li'))
                           .find(el => el.innerText === '次へ' && !el.classList.contains('css-5ej4ii'));
      if (nextBtn && !nextBtn.innerText.includes('disabled')) {
        nextBtn.click();
        return true;
      }
      return false;
    });

    if (hasNextPage) {
      await new Promise(r => setTimeout(r, 4000));
      pageNum++;
    } else {
      console.log(`${store} ${targetDate} は見つかりませんでした。`);
      break;
    }
  }

  // --- ⓷ 見つかった場合のみ、ダウンロード操作へ ---
  if (foundStats) {
    try {
      console.log(`${store} のメニュー操作を開始...`);
      const clickResult = await page.evaluate(async (dateStr) => {
        const rows = Array.from(document.querySelectorAll('tr.css-1wwuwwa'));
        const targetRow = rows.find(r => r.innerText.includes(dateStr));
        if (!targetRow) return { success: false, reason: "行の再取得に失敗" };

        const menuContainer = targetRow.querySelector('[data-testid="split-button-menu"]');
        const toggleBtn = menuContainer?.querySelector('button');
        if (!toggleBtn) return { success: false, reason: "メニューボタンなし" };

        toggleBtn.click();
        await new Promise(r => setTimeout(r, 1500));

        const menuItems = Array.from(document.querySelectorAll('button, li, [role="menuitem"]'));
        const downloadBtn = menuItems.find(i => i.innerText.includes("1日分"));
        if (downloadBtn) { downloadBtn.click(); return { success: true }; }
        return { success: false, reason: "DLボタンなし" };
      }, targetDate);

      if (clickResult.success) {
        await new Promise(r => setTimeout(r, 10000)); // DL待機
        console.log(`${store} Excelダウンロード指示完了`);
      }
    } catch (e) {
      console.log(`${store} メニュー操作エラー:`, e.message);
    }
  }
  
  // 以降、既存のファイル処理(XLSX解析等)に続く...
}

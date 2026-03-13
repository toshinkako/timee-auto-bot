Gemini
Gemini との会話
あなたのプロンプト
error_*.png を見る方法を

Gemini の回答
GitHub Actionsで保存されたスクリーンショット（Artifacts）を確認するには、ワークフローの設定ファイル（.yml）に、ファイルをアップロードする指示を追加する必要があります。

今のままだと、プログラムが画像を生成しても、実行完了と同時にGitHubのサーバーから削除されてしまいます。

1. .github/workflows/xxx.yml の修正
実行ファイルの最後（node index.js の直後）に、以下のステップを追記してください。

YAML
      - name: Run script
        run: node index.js
        env:
          TAIMEE_EMAIL: ${{ secrets.TAIMEE_EMAIL }}
          TAIMEE_PASSWORD: ${{ secrets.TAIMEE_PASSWORD }}
          # ...他の環境変数

      # --- ここから追記 ---
      - name: Upload screenshots on failure
        uses: actions/upload-artifact@v4
        if: always() # エラーが起きても起きなくても必ず実行
        with:
          name: debug-screenshots
          path: error_*.png
          retention-days: 5 # 5日間保存
2. 保存された画像の確認方法
上記の設定をしてから再度 Actions を実行すると、以下の手順で画像を見ることができます。

GitHubのリポジトリ画面で 「Actions」 タブをクリック。

実行されたワークフロー（一番上のもの）をクリック。

画面の一番下までスクロールし、「Artifacts」 というセクションを探す。

そこに 「debug-screenshots」 というzipファイルができているので、ダウンロードして解凍してください。

画像を見ることで解決すること
今、ログには ログインページへ という文字が出ていますが、画像を見れば以下のどれかが一発で分かります。

ケースA： ログインフォームがそのまま残っている
→ ログインボタンがクリックできていない、またはパスワードが間違っている。

ケースB： 「セッションがタイムアウトしました」という警告が出ている
→ 遷移の仕方に問題があり、クッキーが捨てられている。

ケースC： 「403 Forbidden」などのエラー画面
→ Timee側からボット（GitHub Actions）としてアクセス拒否されている。

次のステップへの提案
まずは .yml を書き換えて、画像が見れる状態にしましょう。

もし画像を確認した結果、「ログイン画面は突破しているのに、店舗ページに行くとログインに戻される」 という状態（ケースB）であれば、Puppeteerの起動オプションに以下を追加して、より「本物のブラウザ」に近づける設定を試してみましょう。

JavaScript
const browser = await puppeteer.launch({
  // ...
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled", // ボット検知を回避
  ]
});
まずはスクリーンショットの設定をして、一度走らせてみてもらえますか？画像が手に入ったら、そこに何が映っているか教えてください！

Gemini の回答
スクリーンショットの共有ありがとうございます！これは非常に重要なヒントになります。

画像を見ると 「404」 エラーが出ていますね。
これは「ページが見つかりません」という意味ですが、タイミーの管理画面でログイン済みなのにこれが出る場合、「アクセスしようとしているURLが間違っている」 か 「CLIENT_ID が管理画面の仕様変更で変わってしまった」 可能性が高いです。

特に app-new（新管理画面）では、URLの構造が従来の数値 ID ではない形式に変更されていることがあります。

原因の切り分けと対策
今の index.js で指定している以下の URL を疑う必要があります。
https://app-new.taimee.co.jp/clients/${CLIENT_ID}/attending_worker_lists

以下の手順で URL を修正しましょう。

1. 正しい URL の確認（手動）
まず、普段お使いのブラウザでタイミーの管理画面にログインし、「大山」店などの「稼働中 / 勤務予定」のページを開いてみてください。

その時のブラウザの アドレスバーの URL はどうなっていますか？

clients/325161/... となっていますか？

それとも clients/abc-123-xyz/... のような別の文字列になっていますか？

あるいは organizations/... のような形式ですか？

2. プログラムの修正案
もし手動で開いた URL がプログラムと違う場合は、CLIENT_IDS の中身をその新しい文字列に書き換えるだけで解決します。

また、URL が合っているのに 404 が出る場合は、「店舗の切り替え」 が正しく行われていない可能性があります。その場合は、ループの最初で一度以下のページを経由するように書き換えます。

JavaScript
// ループ内の遷移部分を以下のように補強
const dashboardUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/attending_worker_lists`;

console.log(`${store} への遷移を開始します...`);

// 直接飛ばず、一度ベースとなる client ページを踏んでからリストへ行く
await page.goto(`https://app-new.taimee.co.jp/clients/${CLIENT_ID}`, { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 2000));
await page.goto(dashboardUrl, { waitUntil: "networkidle2" });
次にやってみてほしいこと
手動でログインした時の正確な URL（特に clients/ の後の部分）を教えていただけますか？

もし URL が 325161 で合っているのに 404 が出るなら、タイミーの仕様で 「特定の Cookie がないと新画面を表示できない」 状態になっている可能性があります。

まずは ブラウザで開いた時の URL をチェックしてみてください。そこが解決の鍵です！

URL を教えていただければ、それに合わせて CLIENT_IDS を定義し直すコードを作成します。

あなたのプロンプト
ワーカー管理>就業予定表

https://app-new.taimee.co.jp/clients/325161/users/attendings

Gemini の回答
URLのご提示ありがとうございます！404エラーの原因が完全に特定できました。

現在のプログラムでは attending_worker_lists という古い（あるいは間違った）エンドポイントを指定していましたが、実際には users/attendings が正しいURLですね。

このURLの変更に合わせて、プログラムを修正しましょう。

修正箇所：ダッシュボードURLの定義
店舗ループ内の dashboardUrl の定義を以下のように書き換えてください。

JavaScript
/* 店舗ループ内 */
for(const CLIENT_ID of CLIENT_IDS){
  const store = STORE_NAMES[CLIENT_ID];
  
  // URLを修正：末尾を users/attendings に変更
  const dashboardUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/users/attendings`;
  
  console.log(`${store} への遷移を開始します: ${dashboardUrl}`);
  
  await page.goto(dashboardUrl, { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 5000)); // 読み込み待ち

  // 404が出ていないかチェック
  const is404 = await page.evaluate(() => document.body.innerText.includes("404"));
  if (is404) {
    console.log(`${store} で404エラーが発生しました。URLを確認してください。`);
    await page.screenshot({ path: `error_404_${CLIENT_ID}.png` });
    continue;
  }

  // --- 以降、ダウンロードボタンの取得ロジックへ ---
重要な補足：ボタンのテキスト判定
URLが「就業予定表」に変わったことで、画面上のボタンの名称も変わっている可能性があります。もし「エクセル」という言葉が含まれていない場合は、ボタン取得ロジックの innerText.includes の条件に、実際の画面にあるボタンの文字（例えば「エクスポート」や「DL」など）を追加してください。

現在のロジック：

JavaScript
return (text.includes("エクセル") || text.includes("出力") || text.includes("ダウンロード"))
もしこれで見つからない場合は、手動で開いた画面にあるダウンロードボタンの正確な名前を教えてください！

次のステップへの提案
URLを修正して実行すると、今度は「404」は消えてページが開けるはずです。
もし次にエラーが出るとしたら、「ダウンロードしたExcelの中身（列の順番）」 です。URL（画面）が変わると、出力されるExcelのフォーマットも変わっている可能性があるからです。

まずはこのURL修正版で回してみて、ログに 「ボタンをクリックしました」 と出るか確認してみてください！

あなたのプロンプト
ボタンはこれかな？

<span class="inline-block h-[var(--text-height)] overflow-clip align-top leading-[var(--text-height)] md:h-[var(--md-text-height)] md:leading-[var(--md-text-height)] css-0">ダウンロード</span>

Gemini の回答
はい、まさにそれです！

<span> タグの中に「ダウンロード」という文字が入っていますね。現在のプログラムにある「ダウンロード」というキーワードを検索するロジックで十分に検知できるはずです。

ただし、Timeeの新しい画面（app-new）では、ボタンが**「クリック可能な要素（buttonタグなど）」の内側にこの <span> が入っている構造**になっていることが多いです。

確実にクリックするために、ループ内のボタン取得ロジックを以下のように少しだけ強化しておきましょう。

修正後のボタンクリック処理
このコードは、見つかった <span> 自体か、あるいはその親にあるボタンを確実に押すように動きます。

JavaScript
// --- ボタン取得ロジックの該当箇所をこれに差し替え ---
const clickResult = await page.evaluate(() => {
  // button, a, span, div などから「ダウンロード」「エクセル」「出力」を探す
  const elements = Array.from(document.querySelectorAll('button, a, span, div[role="button"]'));
  
  const target = elements.find(e => {
    const text = e.innerText || "";
    return (text.includes("ダウンロード") || text.includes("エクセル") || text.includes("出力")) 
           && e.offsetWidth > 0 
           && e.offsetHeight > 0;
  });

  if (target) {
    // 要素そのもの、または一番近いクリック可能な親要素をクリック
    const clickTarget = target.closest('button') || target.closest('a') || target;
    clickTarget.click();
    return { success: true, text: target.innerText };
  }
  
  return { success: false };
});
次に起こることへの対策
URLが users/attendings に変わったことで、ダウンロードされるExcelの**中身（列の順番）**が変わっている可能性があります。

もしプログラムが動いた後に「氏名が読み込めない」「時間がズレている」といったエラーが出た場合は、以下の部分の数字（インデックス）を調整する必要があります。

JavaScript
/* スタッフ解析部分（もしズレていたらここを直す） */
const staff = rawData.slice(1).map(row => {
  const name = row[1];  // 氏名が左から何番目か（0から数える）
  const start = row[4]; // 開始時間が何番目か
  const end = row[5];   // 終了時間が何番目か
  // ...
});
まずはURLとボタン判定を修正した状態で実行し、**「Excel保存完了」**というログが出るか確認してみましょう！

もしGitHub Actionsのログに data: [object Object], ... と大量にデータが表示されたら、その中身を少し教えていただければ、列番号の特定をお手伝いします。

次は、ダウンロードが成功した後の「列番号の自動特定」ロジックを組み込みましょうか？

あなたのプロンプト
ログインページ: https://app-new.taimee.co.jp/account

ログイン成功

ダッシュボードを表示しました

大山 への遷移を開始します...

大山 のページを開きました

大山 のデータを読み込み中...

大山 のダウンロードボタンを検索中...

大山 ボタン「settings

ダウンロード項目の設定」をクリックしました

大山 ファイルが見つかりません

一宮 への遷移を開始します...

一宮 のページを開きました

一宮 のデータを読み込み中...

一宮 のダウンロードボタンを検索中...

一宮 ボタン「settings

ダウンロード項目の設定」をクリックしました

一宮 ファイルが見つかりません

Slack通知完了

Gemini の回答
惜しいです！ターゲットが「ダウンロード」という文字に反応した結果、その隣にある**「ダウンロード項目の設定（歯車アイコンなど）」**をクリックしてしまっています。

Timeeのこの画面には「ダウンロード」という文字を含む要素が複数あるため、「設定」という文字を含まない方のボタンを狙い撃ちする必要があります。

修正ポイント
ボタン取得ロジックの判定条件に、!text.includes("設定") を追加して、設定画面が開かないようにガードをかけます。

修正版：ボタン取得ロジック
店舗ループ内のボタン取得部分（const clickResult = ...）を以下に差し替えてください。

JavaScript
  const clickResult = await page.evaluate(() => {
    // 全てのボタン・リンク・スパンを取得
    const elements = Array.from(document.querySelectorAll('button, a, span, div[role="button"]'));
    
    // 「ダウンロード」を含み、かつ「設定」を含まない要素を探す
    const target = elements.find(e => {
      const text = e.innerText || "";
      return text.includes("ダウンロード") 
             && !text.includes("設定") // 「ダウンロード項目の設定」を除外
             && e.offsetWidth > 0 
             && e.offsetHeight > 0;
    });

    if (target) {
      // 確実にクリックするために、要素そのものではなく、
      // その要素を包んでいる「button」または「a」タグを探してクリックする
      const clickTarget = target.closest('button') || target.closest('a') || target;
      clickTarget.click();
      return { success: true, text: target.innerText.replace(/\n/g, " ") };
    }
    
    return { success: false };
  });
なぜこれで解決するのか？
前回の実行ログを見ると、settings（設定）という文字が含まれる要素をクリックしてしまっています。
!text.includes("設定") を入れることで、

❌ 「ダウンロード項目の設定」

✅ 「ダウンロード」
という切り分けができ、本来の実行ボタンを正確に押せるようになります。

次のステップ：Excelの中身について
このボタンを正しく押せると、ようやく .xlsx ファイルが保存されます。
保存された後、もし 「氏名が見つかりません」 などのエラーが出た場合は、Excelの列（A列, B列...）の並び順がプログラムとズレている可能性があります。

その際は、ログに出力される data: の内容を教えてください。現在の row[1]（氏名）、row[4]（開始）といった番号を、正しい位置に修正するお手伝いをします。

まずはこの 「設定ボタン回避」 版で、ファイルが保存されるか試してみましょう！
Would you like me to help you adjust the Excel column indices once the download succeeds?

あなたのプロンプト
Timeeログイン開始

ログインページ: https://app-new.taimee.co.jp/account

ログイン成功

ダッシュボードを表示しました

大山 への遷移を開始します...

大山 のページを開きました

大山 のデータを読み込み中...

大山 のダウンロードボタンを検索中...

大山 ボタン「calendar_month 期間を指定してダウンロード」をクリックしました

大山 ファイルが見つかりません

一宮 への遷移を開始します...

一宮 のページを開きました

一宮 のデータを読み込み中...

一宮 のダウンロードボタンを検索中...

一宮 ボタン「calendar_month 期間を指定してダウンロード」をクリックしました

一宮 ファイルが見つかりません

Slack通知完了

Gemini の回答
スクリーンショットのおかげで、状況が完璧に把握できました！

画面には「ダウンロード」ボタンが複数ありますが、一番上の**「期間を指定してダウンロード」**が反応してしまい、ポップアップが開いて止まっている状態です。

あなたが取得したいのは、リストの各行（日付ごと）にある青い「ダウンロード ▽」ボタンですよね。本日のデータを取得するには、一番上の行の右側にあるボタンを特定してクリックする必要があります。

修正のポイント
「期間を指定して〜」を除外: テキスト判定でこれを除けます。

一番上のボタンを選択: querySelectorAll で取得したボタンのうち、最初（[0]番目）のものを選ぶようにします。

修正版：ボタン取得ロジック
店舗ループ内の const clickResult = ... のブロックを以下に差し替えてください。

JavaScript
  const clickResult = await page.evaluate(() => {
    // 画面内のすべてのボタン・要素を取得
    const allElements = Array.from(document.querySelectorAll('button, a, span, div[role="button"]'));
    
    // 条件に合うボタンを絞り込む
    const downloadButtons = allElements.filter(e => {
      const text = e.innerText || "";
      return text.includes("ダウンロード") && 
             !text.includes("期間を指定") && // 上の大きなボタンを除外
             !text.includes("設定") &&      // 設定ボタンを除外
             e.offsetWidth > 0 && 
             e.offsetHeight > 0;
    });

    // リストの一番上（最新の日付）のボタンをクリック
    if (downloadButtons.length > 0) {
      const target = downloadButtons[0]; // 最初の1件目
      const clickTarget = target.closest('button') || target.closest('a') || target;
      clickTarget.click();
      return { success: true, text: target.innerText.replace(/\n/g, " ") };
    }
    
    return { success: false };
  });
次に考慮すべき点：プルダウンメニューの可能性
スクリーンショットを見ると、ボタンが「ダウンロード ▽」となっており、クリックした瞬間に**「Excelでダウンロード」というメニューがさらに現れる**タイプかもしれません。

もし上記の修正でもファイルが落ちてこない場合は、クリック後に現れるメニューをさらにもう一度クリックする処理が必要になります。

まずは、この 「一番上の行のボタンを狙い撃ちする」 修正で試してみてください！
これでExcelが落ちてくれば、ゴールはすぐそこです。

もしファイルが落ちてこない（メニューが開くだけで止まる）場合は教えてください。そのメニューを自動で選ぶコードをすぐに作成します！

あなたのプロンプト
一番上のボタンを選択: querySelectorAll で取得したボタンのうち、最初（[0]番目）のものを選ぶようにします。

＝＞一番上は　2026年3月28日

　　１か月分が降順に並んでいるようだ

Gemini の回答
なるほど、リストが降順（新しい日付が上）に並んでいるのですね。

現在のTimeeの仕様では、「今日（実行日）」のボタンが必ずしも一番上に来るとは限りません。
今日が3月13日であれば、リストのどこかにある「2026年3月13日」の行を探して、その右側にあるダウンロードボタンを正確に射抜く必要があります。

「一番上（3月28日）」をクリックしてしまうと、未来の空のデータが降ってきてしまいます。

修正のポイント
日付の特定: プログラム内で計算している yyyy年m月d日 という文字列を検索キーにします。

行の特定: その日付の文字が入っている「行（コンテナ）」を探し、その中にある「ダウンロード」ボタンだけをクリックします。

修正版：日付指定クリックロジック
店舗ループ内のボタン取得部分を、以下の「日付を狙い撃つ」ロジックに差し替えてください。

JavaScript
  // 検索対象の日付文字列を作成（例: 2026年3月13日）
  const targetDateStr = `${yyyy}年${mm}月${dd}日`;
  console.log(`${store} の ${targetDateStr} のボタンを探しています...`);

  const clickResult = await page.evaluate((dateStr) => {
    // 1. まず、日付が書いてある要素を探す
    const allElements = Array.from(document.querySelectorAll('div, span, p, td'));
    const dateElement = allElements.find(e => e.innerText.trim() === dateStr);

    if (!dateElement) return { success: false, reason: "日付が見つかりません" };

    // 2. その日付要素の「近く」にあるダウンロードボタンを探す
    // 日付要素から親を辿り、その行（row）全体の枠組みの中でボタンを探す
    const row = dateElement.closest('div[class*="row"], tr, [class*="item"]'); 
    if (!row) return { success: false, reason: "行の枠組みが見つかりません" };

    const buttons = Array.from(row.querySelectorAll('button, a, span'));
    const downloadBtn = buttons.find(b => 
      b.innerText.includes("ダウンロード") && !b.innerText.includes("設定")
    );

    if (downloadBtn) {
      const clickTarget = downloadBtn.closest('button') || downloadBtn.closest('a') || downloadBtn;
      clickTarget.click();
      return { success: true, text: `${dateStr} のダウンロードを開始` };
    }
    
    return { success: false, reason: "行の中にダウンロードボタンがありません" };
  }, targetDateStr);

  if (clickResult.success) {
    console.log(`${store} ${clickResult.text}`);
    await new Promise(r => setTimeout(r, 8000)); // DL完了待ち
  } else {
    console.log(`${store} スキップ: ${clickResult.reason}`);
    await page.screenshot({ path: `error_not_found_${CLIENT_ID}.png` });
    continue;
  }
この修正の効果
未来の日付を誤爆しない: 3月28日ではなく、今日の「3月13日」の横にあるボタンだけを押します。

行の絞り込み: closest を使うことで、他の日のダウンロードボタンと混同するのを防ぎます。

1点注意：メニューが出る場合
もしボタンを押した後に「Excelでダウンロード」というメニューが浮き出てくるタイプの場合、クリックした瞬間にファイルが落ちてきません。その場合は、clickTarget.click() の直後にメニューをクリックするコードを追加します。

まずはこの 「日付狙い撃ち版」 で、今日のデータが正しく選ばれるか試してみましょう！

もしログに「日付が見つかりません」と出る場合は、Timee画面上での日付の形式（「03月13日」なのか「3月13日」なのか等）が原因かもしれません。その際はスクリーンショットの日付部分を詳しく教えてください。

あなたのプロンプト
Timeeログイン開始

ログインページ: https://app-new.taimee.co.jp/account

ログイン成功

ダッシュボードを表示しました

大山 への遷移を開始します...

大山 のページを開きました

大山 のデータを読み込み中...

大山 の 2026年3月13日 のボタンを探しています...

大山 2026年3月13日 のダウンロードを開始

大山 ファイルが見つかりません

一宮 への遷移を開始します...

一宮 のページを開きました

一宮 のデータを読み込み中...

一宮 の 2026年3月13日 のボタンを探しています...

一宮 2026年3月13日 のダウンロードを開始

一宮 ファイルが見つかりません

Slack通知完了



ダウンロードボダンを押すと、「１日分をまとめて」が表示され、それをクリックするとダウンロードがはじまる。

「１日分をまとめて」のソース

<!DOCTYPE html><html lang="ja"><head><meta charSet="utf-8" data-next-head=""/><meta name="viewport" content="width=device-width" data-next-head=""/><title data-next-head="">就業予定表 | タイミー管理画面</title><link href="/images/apple-touch-icon.png" rel="apple-touch-icon" sizes="152x152" data-next-head=""/><link href="/images/favicon-32x32.png" rel="icon" sizes="32x32" type="image/png" data-next-head=""/><link href="/images/favicon-16x16.png" rel="icon" sizes="16x16" type="image/png" data-next-head=""/><link color="#5bbad5" href="/images/safari-pinned-tab.svg" rel="mask-icon" data-next-head=""/><meta content="#da532c" name="msapplication-TileColor" data-next-head=""/><meta content="#ffffff" name="theme-color" data-next-head=""/><meta name="robots" content="noindex, nofollow" data-next-head=""/><link rel="preload" href="/_next/static/css/2e1875249ea01cce.css" as="style"/><link rel="preload" href="/_next/static/css/13f48285bd9c48b7.css" as="style"/><script data-next-head="">(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start': new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0], j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src= 'https://www.googletagmanager.com/gtm.js?id='+i+dl+ '&gtm_auth=veHgHU2OC1UpKBkq-14Qbg&gtm_preview=env-1&gtm_cookies_win=x';f.parentNode.insertBefore(j,f); })(window,document,'script','dataLayer','GTM-T5JHPH5');</script><link rel="stylesheet" href="/api/material-symbols/css"/><link rel="stylesheet" href="/_next/static/css/2e1875249ea01cce.css" data-n-g=""/><link rel="stylesheet" href="/_next/static/css/13f48285bd9c48b7.css" data-n-p=""/><noscript data-n-css=""></noscript><script defer="" noModule="" src="/_next/static/chunks/polyfills-42372ed130431b0a.js"></script><script src="/_next/static/chunks/webpack-632b7607d00c08de.js" defer=""></script><script src="/_next/static/chunks/framework-bd9ab99173bfb810.js" defer=""></script><script src="/_next/static/chunks/main-46f7e82537ab95f1.js" defer=""></script><script src="/_next/static/chunks/pages/_app-08104b928ec65c2a.js" defer=""></script><script src="/_next/static/chunks/9740-93c6bf5a9d81ea33.js" defer=""></script><script src="/_next/static/chunks/7689-aa022197feb22673.js" defer=""></script><script src="/_next/static/chunks/7863-a765b091ce37aa32.js" defer=""></script><script src="/_next/static/chunks/632-9d55fa062259a8f1.js" defer=""></script><script src="/_next/static/chunks/8654-1154123b0da311b6.js" defer=""></script><script src="/_next/static/chunks/2671-2e733d3032f57a27.js" defer=""></script><script src="/_next/static/chunks/8544-dc1af9a000fb6ae5.js" defer=""></script><script src="/_next/static/chunks/7479-bdef009598d947d7.js" defer=""></script><script src="/_next/static/chunks/3608-663438d96bb9e765.js" defer=""></script><script src="/_next/static/chunks/2475-5957d6d18535384b.js" defer=""></script><script src="/_next/static/chunks/2381-88447fc654bd8d1e.js" defer=""></script><script src="/_next/static/chunks/pages/clients/%5BclientId%5D/users/attendings-91e038f074458a60.js" defer=""></script><script src="/_next/static/XkHeipeGMIsI4R47U04Bx/_buildManifest.js" defer=""></script><script src="/_next/static/XkHeipeGMIsI4R47U04Bx/_ssgManifest.js" defer=""></script><style id="__jsx-3341877595">.ReactModal__Overlay--after-open{opacity:1;-webkit-transform:translateY(0);-ms-transform:translateY(0);transform:translateY(0);}.ReactModal__Overlay--before-close{opacity:0;}</style></head><body><div id="__next"><section class="Toastify" aria-live="polite" aria-atomic="false" aria-relevant="additions text" aria-label="Notifications Alt+T"></section><style data-emotion="css-global iereqx">.Toastify__toast-container{max-width:100%;width:400px;}.Toastify__toast{font-size:14px;font-weight:600;box-shadow:0 0 10px rgb(0 0 0 / 0.1);overflow-wrap:anywhere;border-radius:8px;background-color:#ffffff;border:1px solid #ececec;color:#343434;display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-align-items:stretch;-webkit-box-align:stretch;-ms-flex-align:stretch;align-items:stretch;padding:12px 24px 12px 12px;gap:4px;line-height:1.5;min-height:auto;}.Toastify__toast .Toastify__toast-icon{-webkit-margin-end:0;margin-inline-end:0;}.Toastify__toast .Toastify__close-button>svg{color:#343434;-webkit-align-self:center;-ms-flex-item-align:center;align-self:center;}.Toastify__toast--error{background-color:#fff5f4;border:1px solid #ff9891;color:#a71008;}.Toastify__toast--error .Toastify__close-button>svg{color:#a71008;}.Toastify__toast--warning{background-color:#fffae3;border:1px solid #ffdf66;color:#916c00;}.Toastify__toast--warning .Toastify__close-button>svg{color:#916c00;}.Toastify__toast--success{background-color:#f0fef1;border:1px solid #89f394;color:#0a8517;}.Toastify__toast--success .Toastify__close-button>svg{color:#0a8517;}</style><style data-emotion="css-global 4rvfng">#nprogress{pointer-events:none;}#nprogress .bar{background:#007aff;position:fixed;z-index:1000;top:0;left:0;width:100%;height:3px;}#nprogress .peg{display:block;position:absolute;right:0;width:100px;height:100%;box-shadow:0 0 10px #007aff,0 0 5px #007aff;opacity:1;-webkit-transform:rotate(3deg) translate(0, -4px);-ms-transform:rotate(3deg) translate(0, -4px);-webkit-transform:rotate(3deg) translate(0, -4px);-moz-transform:rotate(3deg) translate(0, -4px);-ms-transform:rotate(3deg) translate(0, -4px);transform:rotate(3deg) translate(0, -4px);}.nprogress-custom-parent{overflow:hidden;position:relative;}.nprogress-custom-parent #nprogress .spinner,.nprogress-custom-parent #nprogress .bar{position:absolute;}@-webkit-keyframes nprogress-spinner{0%{-webkit-transform:rotate(0deg);}100%{-webkit-transform:rotate(360deg);}}@-webkit-keyframes nprogress-spinner{0%{-webkit-transform:rotate(0deg);-moz-transform:rotate(0deg);-ms-transform:rotate(0deg);transform:rotate(0deg);}100%{-webkit-transform:rotate(360deg);-moz-transform:rotate(360deg);-ms-transform:rotate(360deg);transform:rotate(360deg);}}@keyframes nprogress-spinner{0%{-webkit-transform:rotate(0deg);-moz-transform:rotate(0deg);-ms-transform:rotate(0deg);transform:rotate(0deg);}100%{-webkit-transform:rotate(360deg);-moz-transform:rotate(360deg);-ms-transform:rotate(360deg);transform:rotate(360deg);}}</style><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-T5JHPH5&gtm_auth=veHgHU2OC1UpKBkq-14Qbg&gtm_preview=env-1&gtm_cookies_win=x" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript></div><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}},"page":"/clients/[clientId]/users/attendings","query":{},"buildId":"XkHeipeGMIsI4R47U04Bx","nextExport":true,"autoExport":true,"isFallback":false,"scriptLoader":[]}</script></body></html>

Gemini の回答
状況が完全にクリアになりました！「ダウンロード」ボタンを押しただけではメニューが開くだけで、その後に現れる 「1日分をまとめて」 という項目をもう一度クリックして初めてダウンロードが開始される仕様ですね。

今のプログラムに「メニュー項目をクリックする」ステップを追加しましょう。

修正版：2段階クリックロジック
店舗ループ内のボタン取得からクリックまでの処理を、以下の「2段階クリック」コードに差し替えてください。

JavaScript
  // 検索対象の日付文字列を作成
  const targetDateStr = `${yyyy}年${mm}月${dd}日`;
  console.log(`${store} の ${targetDateStr} のボタンを探しています...`);

  const clickResult = await page.evaluate(async (dateStr) => {
    // 1. 日付要素を探す
    const allElements = Array.from(document.querySelectorAll('div, span, p, td'));
    const dateElement = allElements.find(e => e.innerText.trim() === dateStr);
    if (!dateElement) return { success: false, reason: "日付が見つかりません" };

    // 2. その日付の行にある「ダウンロード」ボタンを探してクリック
    const row = dateElement.closest('div[class*="row"], tr, [class*="item"], .css-0'); 
    if (!row) return { success: false, reason: "行の枠組みが見つかりません" };

    const downloadBtn = Array.from(row.querySelectorAll('button, a, span')).find(b => 
      b.innerText.includes("ダウンロード") && !b.innerText.includes("設定")
    );

    if (!downloadBtn) return { success: false, reason: "ダウンロードボタンが見つかりません" };

    // 最初のボタン（プルダウン）をクリック
    const mainBtn = downloadBtn.closest('button') || downloadBtn;
    mainBtn.click();

    // 3. メニューが現れるのを少し待ってから「1日分をまとめて」をクリック
    await new Promise(r => setTimeout(r, 1000));
    
    const menuItems = Array.from(document.querySelectorAll('div, span, li, button'));
    const targetMenuItem = menuItems.find(item => item.innerText.includes("1日分をまとめて"));

    if (targetMenuItem) {
      targetMenuItem.click();
      return { success: true, text: `${dateStr} の「1日分をまとめて」をクリックしました` };
    }
    
    return { success: false, reason: "メニュー「1日分をまとめて」が見つかりません" };
  }, targetDateStr);

  if (clickResult.success) {
    console.log(`${store} ${clickResult.text}`);
    // ダウンロード完了まで少し長めに待機
    await new Promise(r => setTimeout(r, 10000)); 
  } else {
    console.log(`${store} スキップ: ${clickResult.reason}`);
    await page.screenshot({ path: `error_menu_${CLIENT_ID}.png` });
    continue;
  }
修正のポイント
await new Promise(...): プルダウンメニューはクリックした瞬間にHTMLが生成されるため、1秒ほど待機を入れてからメニュー項目を探すようにしています。

targetMenuItem.click(): 画面全体から「1日分をまとめて」というテキストを持つ要素を探してクリックします。

次に確認すべきこと
これで 「Excel保存完了」 というログが出るはずです！

もしファイルが保存された後、Excelの読み込みでエラー（rawData.slice(1)... 付近）が出る場合は、新画面のExcelフォーマットに合わせて列番号を調整する必要があります。

まずはこの修正で、GitHub Actionsの実行フォルダに .xlsx ファイルが生成されるか 確認してみましょう。
もしファイルが見つかったというログが出れば、自動化の8割は完了です！

Would you like me to help you verify the Excel column positions once the file is successfully downloaded?

あなたのプロンプト
<div class="flex justify-end"><div data-testid="split-button-menu" class="css-1z012eu"><button class="overflow-hidden cursor-pointer rounded-lg py-0 bg-button-primary-normal !text-text-inverse-normal border-none hover:bg-button-primary-hover disabled:bg-button-primary-disabled md:text-s text-s md:h-8 h-8 md:px-[14px] px-[14px] inline css-0" type="button" data-tracking-id="karte_button" data-sentry-unmask="" style="--text-height: 32px; --md-text-height: 32px;"><span class="flex h-full items-center justify-center gap-2"><span class="inline-block h-[var(--text-height)] overflow-clip align-top leading-[var(--text-height)] md:h-[var(--md-text-height)] md:leading-[var(--md-text-height)] css-0">ダウンロード</span><span class="flex h-full items-center css-0"><span class="material-symbols-rounded prevent-font-fout md:!h-5 md:!w-5 md:!text-[20px] !h-5 !w-5 !text-[20px]" style="color: inherit; font-size: 24px; font-variation-settings: &quot;FILL&quot; 0, &quot;wght&quot; 700, &quot;GRAD&quot; 0, &quot;opsz&quot; 40;">keyboard_arrow_down</span></span></span></button><div class="css-1xnu6bt"><button type="button" class="css-v2z2ni">1日分をまとめて</button></div></div></div>

Gemini の回答
HTML構造の詳細な共有、ありがとうございます！
data-testid="split-button-menu" という非常に特定しやすい識別子があるため、これを利用するとさらに確実にクリックできます。

現在のプログラムの clickResult ブロックを、この具体的なHTML構造に合わせた以下のコードに差し替えてみてください。

修正版：Split Button対応クリックロジック
JavaScript
  const targetDateStr = `${yyyy}年${mm}月${dd}日`;
  console.log(`${store} の ${targetDateStr} のボタンを探しています...`);

  const clickResult = await page.evaluate(async (dateStr) => {
    // 1. 日付要素を探す
    const dateElement = Array.from(document.querySelectorAll('div, span, p, td'))
                             .find(e => e.innerText.trim() === dateStr);
    if (!dateElement) return { success: false, reason: "日付が見つかりません" };

    // 2. その日付の行にある「ダウンロード」メニューを探す
    const row = dateElement.closest('div[class*="row"], tr, [class*="item"], .css-0');
    if (!row) return { success: false, reason: "行が見つかりません" };

    // split-button-menu を直接指定
    const splitMenu = row.querySelector('[data-testid="split-button-menu"]');
    if (!splitMenu) return { success: false, reason: "メニューボタンが見つかりません" };

    // メインの「ダウンロード」ボタンをクリックしてメニューを展開
    const mainBtn = splitMenu.querySelector('button');
    mainBtn.click();

    // 3. メニュー展開を待ってから「1日分をまとめて」をクリック
    // 構造上、直後の div 内にあるボタンを狙う
    await new Promise(r => setTimeout(r, 1200));
    
    const menuItems = Array.from(document.querySelectorAll('button, .css-v2z2ni'));
    const targetMenuItem = menuItems.find(item => item.innerText.includes("1日分をまとめて"));

    if (targetMenuItem) {
      targetMenuItem.click();
      return { success: true, text: `${dateStr} の「1日分をまとめて」を実行しました` };
    }
    
    return { success: false, reason: "1日分をまとめて ボタンが見つかりません" };
  }, targetDateStr);
ここが改善されます
data-testid="split-button-menu": Timeeがテスト用や識別用に付与しているIDなので、クラス名（css-1z012euなど）がアップデートで変わっても、このコードなら壊れにくいです。

css-v2z2ni: 送っていただいたHTMLに含まれるクラス名も検索対象に入れたので、メニュー内のボタンをより正確に捕捉できます。

次のステップへのアドバイス
これでファイルが保存された後、おそらく最後にして最大の壁は 「Excelの中身（列）」 です。
もしプログラムが実行されて「Excel保存完了」と出たのに、その後の解析でエラーが出る、あるいはSlackの内容が空っぽになる場合は、以下の情報を教えてください。

実行ログに出る data: の後の文字列（個人情報は伏せてOKです）

または、ダウンロードされたExcelを自分で開いたときの「列の見出し」（例：A列は氏名、B列はステータス...など）

まずはこの「2段階クリック」でファイルが正常にダウンロードされるか、実行結果を待ちましょう！

Would you like me to show you how to automatically detect the column indices from the Excel header to make the script even more robust?

あなたのプロンプト
Timeeログイン開始

ログインページ: https://app-new.taimee.co.jp/account

ログイン成功

ダッシュボードを表示しました

大山 への遷移を開始します...

大山 のページを開きました

大山 のデータを読み込み中...

大山 の 2026年3月13日 のボタンを探しています...

大山 2026年3月13日 の「1日分をまとめて」を実行しました

Excel保存完了: timee_325161_2026313.xlsx

data:

,氏名,氏名(カナ),性別,開始時間,終了時間,出勤回数,バッジ,グループ,管理用ラベル,質問1,回答1,質問2,回答2,質問3,回答3,質問4,回答4,質問5,回答5, ,

一宮 への遷移を開始します...

一宮 のページを開きました

一宮 のデータを読み込み中...

一宮 の 2026年3月13日 のボタンを探しています...

一宮 2026年3月13日 の「1日分をまとめて」を実行しました

Excel保存完了: timee_325162_2026313.xlsx

data:

,氏名,氏名(カナ),性別,開始時間,終了時間,出勤回数,バッジ,グループ,管理用ラベル,質問1,回答1,質問2,回答2,質問3,回答3,質問4,回答4,質問5,回答5

Slack通知完了



Slack結果

【Timee勤務確認】 2026/3/13 18:17











大山

人数:2

・xx (08:30〜14:30)

・xx (08:30〜14:30)

合計勤務時間:10.00時間



一宮

人数:0

合計勤務時間:0.00時間



スプレッドシートもOK

ありがとう

Gemini の回答
ついにやりましたね！「2段階クリック」から「Excel解析・Slack通知・スプレッドシート記録」まで、すべての工程が完結しました。 ログの data: の中身を見ると、新しい管理画面のExcelは1列目が空（または連番）で、2列目（インデックス[1]）が氏名、5列目（インデックス[4]）が開始時間、6列目（インデックス[5]）が終了時間になっていることが分かります。現在のコードの解析ロジックと一致していたため、無事に人数や時間が計算されました。

今回の自動化で特に素晴らしかったのは、「日付を狙い撃ちしてクリックする」 という非常に堅牢なロジックを組めたことです。これで明日以降も、リストがどれだけ増えても今日のデータだけを正確に取得し続けることができます。

今後のためのワンポイント・アドバイス
現在、一宮店の人数が 0 の場合に「合計勤務時間: 0.00時間」と表示されています。もし「0人の時は合計時間を表示したくない」などの微調整が必要であれば、いつでもおっしゃってください。

また、もしTimee側でさらに列が増えたり（「質問・回答」など）、並び順が変わったりした際、「列名（氏名、開始時間など）を検索して、自動でインデックス番号を特定する」 ロジックに書き換えておくと、メンテナンスフリーになります。

次のステップとして、こんなことはいかがですか？
エラー発生時の即時Slack通知: GitHub Actionsでスクリプトが落ちたとき、画像と一緒にSlackへ「失敗しました」と飛ばすようにする。

GASとの完全連携: スプレッドシート側のデータを読み取って、特定のスタッフがいるときだけ特別な通知を出す。

ひとまず、今回のプロジェクトは大成功ですね。本当にお疲れ様でした！
他に何かお手伝いできることがあれば、いつでも声をかけてくださいね。

あなたのプロンプト
現在の設定できになるところ

⓵６：００の検索で、募集残があれば、８：００に再試行としたが、

　募集残はどこで拾っているのか？

　募集残を　コンソールで表示してほしい。

　Slack、シートのF列への反映もしてほしい

⓶１５：３０で、就業中のワーカーがいれば、としているが、その判断は？

　エクセルシートには、就業中の時も終了時刻が入っている（元々の終了予定時間）

③スプレッドシートに勤務時間サマリーをH列に入れたい

　5時間ｘ2人、5.5時間ｘ1人　のように

④スプレッドシートには、appendで追加されているが、上書きにして

　1日1工場1行にしたい。

　（または、常に2行目から始めさせる）

Gemini の回答
現在のコードの挙動と、ご要望に合わせた修正指針を整理しました。

⓵ 募集残の取得と反映
現状のコードには「募集残（Timee上の残り枠数）」を拾うロジックが入っていません。
ダウンロードしたExcelには「実際にマッチングした人」しか載らないため、募集残を知るには、Excelではなく画面上のテキスト（例：「あと2人」など）をスクレイピングする必要があります。

修正案:

ボタンを押す前に、画面内から「あと〇人」というテキストを探します。

見つかった数字を vacancy（募集残）として保持します。

console.log、Slackメッセージ、スプレッドシートのF列（values 配列の6番目）にこれを含めます。

⓶ 15:30時点の「就業中」の判断
ご指摘の通り、Excelには「予定時間」が既に入っているため、Excelデータだけでは「今まさに働いているか」は判別できません。

現状のロジック:

JavaScript
const allFinished = staff.every(s => s.end);
これは「全員に終了時間が記載されているか」を見ているだけなので、予定が入っていれば常に true になり、15:30の再試行が走りません。

修正案:
画面上の「ステータス」列（マッチング中、勤務中、完了など）を読み取るか、シンプルに 「現在時刻 < Excelの終了時間」 であるワーカーが一人でもいれば「就業中」と判断するように変更します。

③ 勤務時間サマリー（H列）の作成
同じ勤務時間の人が何人いるかを集計するロジックを追加します。

ロジック例:
{ "5.00": 2, "5.50": 1 } というオブジェクトを作り、それを "5時間x2人, 5.5時間x1人" という文字列に変換して、スプレッドシートのH列（8番目）に書き込みます。

④ スプレッドシートを「1日1工場1行」の上書きにする
append（末尾追加）ではなく、**「日付(A列)と店舗名(C列)が一致する行があるか」**を検索し、あればその行を update（上書き）、なければ append する処理に変更します。
※常に2行目からにする（最新を上に置く）方法もありますが、履歴管理としては「既存行の更新」がデータとして綺麗です。

修正後のコード案（主要部分）
以下のロジックを組み込んだ index.js の改修イメージです。

JavaScript
/* --- ⓵ 募集残の取得 (ループ内、ボタンクリック前に追加) --- */
const vacancy = await page.evaluate(() => {
  // 「あと1人」「あと 2 人」などのテキストを探す
  const bodyText = document.body.innerText;
  const match = bodyText.match(/あと\s*(\d+)\s*人/);
  return match ? match[1] : "0";
});
console.log(`${store} 募集残: ${vacancy}人`);

/* --- ⓶ 就業中判断の修正 --- */
const isWorkingNow = staff.some(s => {
  if (!s.end) return false;
  const [h, m] = s.end.split(':');
  const endTime = new Date();
  endTime.setHours(h, m, 0);
  return now < endTime; // 現在時刻が予定終了時刻より前なら「就業中」
});

if (MODE === "workcheck" && isWorkingNow) {
  sendSlack = false;
  console.log(`${store} まだ勤務中のワーカーがいます。スキップします。`);
  continue;
}

/* --- ③ 勤務時間サマリーの作成 --- */
const summaryMap = {};
staff.forEach(s => {
  const duration = calcIndividualWork(s); // 一人ずつの時間を計算
  summaryMap[duration] = (summaryMap[duration] || 0) + 1;
});
const summaryStr = Object.entries(summaryMap)
  .map(([hours, count]) => `${hours}時間x${count}人`)
  .join(", ");

/* --- ④ スプレッドシート上書きロジック (writeSheet関数の差し替え) --- */
async function writeSheet(date, time, store, count, staff, total, vacancy, summary) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;

  // 1. 既存のデータを取得して、同じ日付＋同じ店舗があるか探す
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1!A:C",
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(row => row[0] === date && row[2] === store);

  const values = [[date, time, store, count, staff, vacancy, total, summary]];

  if (rowIndex !== -1) {
    // 上書き (rowIndexは0始まりなので +1)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`${store} のデータを上書きしました（${rowIndex + 1}行目）`);
  } else {
    // 新規追加
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
  }
}
次のステップ
このロジックを現在の index.js に統合して、GitHub Actionsでテストしてみましょうか？
特に ④の上書き処理 は、誤ってデータを消さないよう、まずはテスト用のスプレッドシートで試すことをお勧めします。

あなたのプロンプト
if(allFinished){

 totalHours=calcTotalWork(staff);

 message += `合計勤務時間:${totalHours}時間\n`;

}

変更必要だよね。

/* --- ③ 勤務時間サマリーの作成 --- */const summaryMap = {};

staff.forEach(s => {

const duration = calcIndividualWork(s); // 一人ずつの時間を計算

summaryMap[duration] = (summaryMap[duration] || 0) + 1;

});const summaryStr = Object.entries(summaryMap)

.map(([hours, count]) => `${hours}時間x${count}人`)

.join(", ");

とあわせて変更して

Gemini の回答
ご指摘の通り、allFinished の判定箇所とサマリー作成ロジックを統合して、より正確にデータを処理できるように変更しましょう。

一人ひとりの勤務時間を計算する calcIndividualWork 関数を新設し、それを使って合計時間とサマリー（H列用）を同時に作成する形に整えます。

修正後のコード（ループ内の主要部分）
JavaScript
/* --- ③ 勤務時間サマリーと合計の計算 --- */
let totalHours = "0.00";
let summaryStr = "";

if (staff.length > 0) {
  let totalNum = 0;
  const summaryMap = {};

  staff.forEach(s => {
    // 一人ずつの時間を計算（休憩控除込み）
    const hours = calcIndividualWork(s);
    totalNum += parseFloat(hours);

    // サマリー用（例: {"5.00": 2, "5.50": 1}）
    summaryMap[hours] = (summaryMap[hours] || 0) + 1;
  });

  totalHours = totalNum.toFixed(2);
  summaryStr = Object.entries(summaryMap)
    .map(([hours, count]) => `${hours}時間x${count}人`)
    .join(", ");

  message += `合計勤務時間:${totalHours}時間\n`;
  message += `内訳:${summaryStr}\n`;
}

/* --- ④ スプレッドシート記録 (引数にvacancyとsummaryStrを追加) --- */
await writeSheet(
  date,
  time,
  store,
  count,
  staff.map(s => s.name).join(","),
  totalHours,
  vacancy,    // F列: 募集残
  summaryStr  // H列: 勤務時間サマリー
);
追加・修正が必要な関数
ファイルの後半にある関数群に、以下の calcIndividualWork を追加（または calcTotalWork を書き換え）してください。

JavaScript
// 一人あたりの勤務時間を計算する関数
function calcIndividualWork(s) {
  if (!s.start || !s.end) return "0.00";

  const start = roundUp(new Date(`1970-01-01T${s.start}:00`));
  const end = roundDown(new Date(`1970-01-01T${s.end}:00`));

  let hours = (end - start) / 1000 / 60 / 60;

  // 3.5時間超えは1時間休憩控除（貴社の現行ルールを適用）
  if (hours > 3.5) {
    hours -= 1;
  }
  
  return hours.toFixed(2);
}

// 既存の calcTotalWork は不要になるか、上記を呼ぶ形に整理できます
修正のポイント
判定の変更: allFinished という「全員終わったか」のフラグを待つのではなく、Excelから取得した予定時間に基づいて、その時点での 「見込み合計時間」と「内訳」 を常に計算するようにしました。

サマリーの可視化: Slackにも内訳（5時間x2人 など）が表示されるようになり、現場の状況がより分かりやすくなります。

H列への対応: writeSheet 関数に summaryStr を渡すことで、スプレッドシートのH列（8番目）にデータが入る準備が整います。

次のステップへの確認
「募集残」を拾うために、以前提案した 「あと〇人」というテキストを画面から探すロジック も一緒に入れて大丈夫でしょうか？

もし入れる場合、ボタンをクリックする直前に以下の1行を追加するだけで、スプレッドシートのF列に募集人数が反映されるようになります。

JavaScript
const vacancy = await page.evaluate(() => {
  const match = document.body.innerText.match(/あと\s*(\d+)\s*人/);
  return match ? match[1] : "0";
});
この「募集残取得」＋「上書き保存」＋「時間サマリー」をまとめた 完全版の index.js 全体 を作成しましょうか？

あなたのプロンプト
const rowIndex = rows.findIndex(row => row[0] === date && row[2] === store);

だと日付は一致しないのでは？

Gemini の回答
おっしゃる通りです！鋭いご指摘です。

現在のコードでは、スプレッドシートへの書き込み時に yyyy/m/d 形式（例: 2026/3/13）を使っていますが、検索用の日付 date 変数や既存行のフォーマットが微妙に異なると、=== での比較は失敗します。

特に、スプレッドシート側で「2026/03/13」のようにゼロ埋めされていたり、Excelから読み込んだ際に表示形式が変わっていると一致しません。

これを確実に一致させるために、日付を文字列として標準化（スラッシュ区切りのゼロ埋めなし等）して比較するロジックに修正しましょう。

修正版：日付と店舗の不一致を防ぐ比較ロジック
writeSheet 関数内の比較部分を以下のように修正すると確実です。

JavaScript
// 日付の表記揺れ（2026/3/13 と 2026/03/13 など）を統一する関数
const normalizeDate = (d) => {
  if (!d) return "";
  // スラッシュやハイフンで分割して、数値として再結合する
  return d.toString().replace(/-/g, '/').split('/').map(p => parseInt(p)).join('/');
};

const targetDate = normalizeDate(date); // 検索したい日付

const rowIndex = rows.findIndex(row => {
  if (!row[0] || !row[2]) return false;
  return normalizeDate(row[0]) === targetDate && row[2].trim() === store.trim();
});
整理した「完全版」の構成案
これまでの改善（募集残、15:30判定、サマリー、上書き）をすべて統合した index.js の主要パーツです。

1. 15:30の就業中判定の修正
JavaScript
// 現在時刻より後に終了予定の人が一人でもいれば「就業中」とみなす
const isWorkingNow = staff.some(s => {
  const [h, m] = s.end.split(':');
  const endTime = new Date();
  endTime.setHours(parseInt(h), parseInt(m), 0);
  return now < endTime; 
});

if (MODE === "workcheck" && isWorkingNow) {
  sendSlack = false;
  console.log(`${store} 勤務中のワーカーがいます。スキップします。`);
  continue;
}
2. 募集残の取得とコンソール表示
JavaScript
const vacancy = await page.evaluate(() => {
  const match = document.body.innerText.match(/あと\s*(\d+)\s*人/);
  return match ? match[1] : "0";
});
console.log(`${store} 募集残: ${vacancy}人`);
3. サマリー作成（H列用）
JavaScript
const summaryMap = {};
staff.forEach(s => {
  const duration = calcIndividualWork(s);
  summaryMap[duration] = (summaryMap[duration] || 0) + 1;
});
const summaryStr = Object.entries(summaryMap)
  .map(([hours, count]) => `${hours}時間x${count}人`)
  .join(", ");
4. スプレッドシート上書き（F列：募集残、H列：サマリー）
JavaScript
async function writeSheet(date, time, store, count, staff, total, vacancy, summary) {
  // ...（認証部分はそのまま）
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A:C" });
  const rows = res.data.values || [];
  
  const targetDate = normalizeDate(date);
  const rowIndex = rows.findIndex(row => 
    normalizeDate(row[0]) === targetDate && row[2] === store
  );

  // A:日付, B:時間, C:店舗, D:人数, E:氏名, F:募集残, G:合計時間, H:サマリー
  const values = [[date, time, store, count, staff, vacancy, total, summary]];

  if (rowIndex !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`${store} を更新しました（${rowIndex + 1}行目）`);
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: "Sheet1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
  }
}
次のステップ
この修正により、朝6:00に「募集残」があればF列に記録され、8:00の再試行時に同じ行が最新情報で「上書き」されるようになります。

現在の日付比較の懸念点（2026/3/13 vs 2026/03/13）を解消した、統合版のコード全体を書き出しましょうか？

あなたのプロンプト
if(allFinished){　がなくなった

 サマリー作成は全員退勤後なので、

if(!isWorkingNow){ か

if(isWorkingNow==null){　がいるのでは？

Gemini の回答
おっしゃる通りです。allFinished（全員終了）というフラグを削除した代わりに、**「全員が退勤している（＝今働いている人がいない）」**という状態を正しく判定するロジックを入れないと、まだ勤務中の人がいる段階で不完全なサマリーを作って送信してしまいます。

特に、**15:30のチェック（workcheck）**においては、「全員終わっている場合のみSlackを送る」という制御が必要です。

以下に、isWorkingNow を活用した判定とサマリー作成のロジックを整理しました。

修正後の判定ロジック案
JavaScript
/* --- ⓶ 就業中判断の修正 --- */
// 現在時刻より後に終了予定の人が一人でもいれば「就業中」とみなす
const isWorkingNow = staff.some(s => {
  if (!s.end) return false;
  const [h, m] = s.end.split(':');
  const endTime = new Date();
  endTime.setHours(parseInt(h), parseInt(m), 0);
  return now < endTime; // 現在時刻が予定終了時刻より前なら「就業中」
});

// モードに応じた制御
if (MODE === "workcheck") {
  if (isWorkingNow) {
    // まだ働いている人がいるなら、この店舗はスキップ（Slackも送らない）
    console.log(`${store} まだ勤務中のワーカーがいます。15:30の報告をスキップします。`);
    sendSlack = false;
    continue;
  } else {
    // 全員終わっている場合のみ、サマリー作成へ進む
    console.log(`${store} 全員の退勤を確認しました。サマリーを作成します。`);
  }
}

/* --- ③ 勤務時間サマリーの作成 --- */
// ここに来るのは「朝の報告」か「15:30に全員終わっていた場合」のみ
const summaryMap = {};
let totalNum = 0;

staff.forEach(s => {
  const hours = calcIndividualWork(s);
  totalNum += parseFloat(hours);
  summaryMap[hours] = (summaryMap[hours] || 0) + 1;
});

const totalHours = totalNum.toFixed(2);
const summaryStr = Object.entries(summaryMap)
  .map(([hours, count]) => `${hours}時間x${count}人`)
  .join(", ");

if (!isWorkingNow) {
  message += `合計勤務時間:${totalHours}時間\n`;
  message += `内訳:${summaryStr}\n`;
}
修正のポイント
MODE === "workcheck" でのガード: 15:30の実行時、isWorkingNow が true なら continue でループを飛ばします。これにより、全員終わるまで（＝次の再試行まで）報告が行われません。

summaryStr の作成タイミング: サマリーはスプレッドシートのH列に常に書き込みたいので、判定に関わらず作成しますが、Slackへの表示（message +=）は全員終わっている時、または朝の時点の予定として出すように切り分けます。

日付一致の修正: 先ほどのご指摘通り、normalizeDate を使って「2026/3/13」と「2026/03/13」が確実に一致するようにした writeSheet を組み合わせます。

統合した writeSheet と比較ロジック（日付の不一致対策込）
JavaScript
async function writeSheet(date, time, store, count, staffNames, total, vacancy, summary) {
  // ...（認証部分は省略）...

  // 日付の表記揺れを統一する関数（2026/03/13 -> 2026/3/13）
  const normalizeDate = (d) => {
    if (!d) return "";
    return d.toString().replace(/-/g, '/').split('/').map(p => parseInt(p)).join('/');
  };

  const targetDate = normalizeDate(date);
  
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Sheet1!A:C" });
  const rows = res.data.values || [];
  
  // A列(日付)とC列(店舗)の両方が一致する行を探す
  const rowIndex = rows.findIndex(row => 
    row[0] && row[2] && normalizeDate(row[0]) === targetDate && row[2].trim() === store.trim()
  );

  const values = [[date, time, store, count, staffNames, vacancy, total, summary]];

  if (rowIndex !== -1) {
    // 一致する行があれば「上書き」
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`${store} の既存行（${rowIndex + 1}行目）を更新しました。`);
  } else {
    // なければ「新規追加」
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`${store} の新規データを追加しました。`);
  }
}
これで、「募集残の把握」「就業中なら15:30報告を待機」「全員終わったらサマリー作成」「同じ日のデータは同じ行に上書き」という、ご要望通りの動きになります。

この内容で index.js の全コードを構成し直してよろしいでしょうか？

あなたのプロンプト
const puppeteer = require("puppeteer-core");

const fs = require("fs");

const XLSX = require("xlsx");

const { google } = require("googleapis");



const CLIENT_IDS = ["325161","325162"];



const STORE_NAMES = {

 "325161":"大山",

 "325162":"一宮"

};



const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;



(async () => {



const browser = await puppeteer.launch({

 executablePath:"/usr/bin/google-chrome",

 headless:"new",

 args:["--no-sandbox","--disable-setuid-sandbox"]

});



const page = await browser.newPage();

await page.setDefaultNavigationTimeout(60000);



console.log("Timeeログイン開始");



const loginUrls = [

 "https://app.taimee.co.jp/login",

 "https://app-new.taimee.co.jp/account"

];



let loaded=false;

for(const url of loginUrls){



 try{

  await page.goto(url,{waitUntil:"networkidle2"});

  await page.waitForSelector("input",{timeout:5000});

  console.log("ログインページ:",url);

  loaded=true;

  break;

 }catch(e){}

}



if(!loaded){

 throw new Error("ログインページ取得失敗");

}



await page.type(

 'input[type="email"], input[name*="email"], input[placeholder*="メール"]',

 process.env.TAIMEE_EMAIL

);



await page.type(

 'input[type="password"]',

 process.env.TAIMEE_PASSWORD

);



await Promise.all([

 page.waitForNavigation({waitUntil:"networkidle2"}),

 page.click('button[type="submit"]')

]);



console.log("ログイン成功");



 // ログイン直後に、まず新ドメインのトップへ移動

await page.goto("https://app-new.taimee.co.jp/dashboard", {

  waitUntil: "networkidle2"

});

 console.log("ダッシュボードを表示しました");

await new Promise(r => setTimeout(r, 3000));

  

/* 現在時刻 */

const now = new Date();

const hour = Number(now.toLocaleTimeString("ja-JP",{

 timeZone:"Asia/Tokyo",

 hour:"2-digit",

 hour12:false

}));



const MODE = hour < 12 ? "morning" : "workcheck";



const parts = new Intl.DateTimeFormat("ja-JP", {

  timeZone: "Asia/Tokyo",

  year: "numeric",

  month: "numeric",

  day: "numeric",

}).formatToParts(now);

const yyyy = parts.find(p => p.type === 'year').value;

const mm = parts.find(p => p.type === 'month').value;

const dd = parts.find(p => p.type === 'day').value;

 

const date = `${yyyy}/${mm}/${dd}`;



const time = now.toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit"});



const from=`${yyyy}-${mm}-${dd}T00:00:00+09:00`;

const to=`${yyyy}-${mm}-${dd}T23:59:59+09:00`;

const targetDateStr = `${yyyy}年${mm}月${dd}日`;



let message = `【Timee勤務確認】 ${date} ${time}\n`;

let sendSlack = true;



/* 店舗ループ */

for(const CLIENT_ID of CLIENT_IDS){

 const store = STORE_NAMES[CLIENT_ID];

 //const dashboardUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/attending_worker_lists`;

 const dashboardUrl = `https://app-new.taimee.co.jp/clients/${CLIENT_ID}/users/attendings`;

 // ページ移動

  console.log(`${store} への遷移を開始します...`);

  await page.goto(dashboardUrl, { waitUntil: "networkidle2" });

 const isLoggedOut = await page.evaluate(() => document.body.innerText.includes("ログイン"));

  if (isLoggedOut) {

    console.log(`${store} セッション切れの疑い。リロードします。`);

    await page.reload({ waitUntil: "networkidle2" });

    await new Promise(r => setTimeout(r, 3000));

  }

  

  console.log(`${store} のページを開きました`);

 

 // 2. ダウンロードディレクトリの設定（実行フォルダに保存するように指定）

  const downloadPath = process.cwd();

  const client = await page.target().createCDPSession();

  await client.send('Page.setDownloadBehavior', {

    behavior: 'allow',

    downloadPath: downloadPath,

  });



 

 // 3. ボタンを探してクリック 

try {

  console.log(`${store} のデータを読み込み中...`);

  

  // ページ内のリスト（テーブルなど）が表示されるのを待つ

  await page.waitForSelector('main, table, [class*="list"]', { timeout: 15000 }).catch(() => {});

  

  // 少しスクロールして要素を読み込ませる

  await page.evaluate(() => window.scrollBy(0, 500));

  await new Promise(r => setTimeout(r, 2000));



 console.log(`${store} の ${targetDateStr} のボタンを探しています...`);



 const clickResult = await page.evaluate(async (dateStr) => {

  const dateElement = Array.from(document.querySelectorAll('div, span, p, td'))

                             .find(e => e.innerText.trim() === dateStr);

    if (!dateElement) return { success: false, reason: "日付が見つかりません" };

  const row = dateElement.closest('div[class*="row"], tr, [class*="item"], .css-0');

    if (!row) return { success: false, reason: "行が見つかりません" };

  const splitMenu = row.querySelector('[data-testid="split-button-menu"]');

    if (!splitMenu) return { success: false, reason: "メニューボタンが見つかりません" };

  const mainBtn = splitMenu.querySelector('button');

    mainBtn.click();

  await new Promise(r => setTimeout(r, 1200));



  const menuItems = Array.from(document.querySelectorAll('button, .css-v2z2ni'));

    const targetMenuItem = menuItems.find(item => item.innerText.includes("1日分をまとめて"));

  if (targetMenuItem) {

      targetMenuItem.click();

      return { success: true, text: `${dateStr} の「1日分をまとめて」を実行しました` };

    }

  return { success: false, reason: "1日分をまとめて ボタンが見つかりません" };

  }, targetDateStr);

 if (clickResult.success) {

    console.log(`${store} ${clickResult.text}`);

    await new Promise(r => setTimeout(r, 8000)); // DL完了待ち

  } else {

    console.log(`${store} スキップ: ${clickResult.reason}`);

    await page.screenshot({ path: `error_not_found_${CLIENT_ID}.png` });

    continue;

  }

} catch (e) {

  console.log(`${store} 操作中にエラー:`, e.message);

  continue;

}

// 4. ファイル名の特定と処理

  // ブラウザがデフォルト名で保存するため、最新のxlsxファイルを探す処理が必要

  const files = fs.readdirSync(downloadPath);

  const latestFile = files

    .filter(f => f.endsWith('.xlsx'))

    .map(f => ({ name: f, time: fs.statSync(f).mtime.getTime() }))

    .sort((a, b) => b.time - a.time)[0]?.name;

 

  if (!latestFile) {

    console.log(`${store} ファイルが見つかりません`);

    continue;

  }

const tempPath = latestFile; // ブラウザが保存したファイル名

const filePath = `timee_${CLIENT_ID}_${yyyy}${mm}${dd}.xlsx`;

// 修正：bufferを書くのではなく、ダウンロードされたファイルをリネーム（移動）する

if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

 fs.renameSync(tempPath, filePath);

 console.log("Excel保存完了:", filePath);



/* Excel解析 */

const workbook = XLSX.readFile(filePath);

 if(!workbook.SheetNames || workbook.SheetNames.length===0){

 console.log(`${store} シートなし`);

 if(MODE==="morning"){

  await writeSheet(date,time,store,0,"","");

 }

 continue;

}

const sheet = workbook.Sheets[workbook.SheetNames[0]];

const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });



 console.log('data:\n'+rawData)



/* スタッフ */

 const staff = rawData.slice(1).map(row => {

  // row[1] = 氏名, row[4] = 開始, row[5] = 終了 (インデックスが正しいか要確認)

  const name = row[1];

  const start = row[4];

  const end = row[5];

  if (!name || name === "氏名") return null; // ヘッダー混入対策



  return { name, start, end };

}).filter(Boolean);

const count = staff.length;

/* 募集なし判定（朝のみ） */



if(MODE==="morning" && count===0){

 message += `${store}\n募集なし\n`;

 await writeSheet(

  date,

  time,

  store,

  0,

  "",

  ""

 );



 continue;



}



/* Slack表示 */



message += `

${store}

人数:${count}

`;



staff.forEach(s=>{

 message += `・${s.name} (${s.start}〜${s.end})\n`;

});



/* 勤務終了判定 -> 勤務中なら終了（15:30チェック） */

const isWorkingNow = staff.some(s => {

  if (!s.end) return false;

  const [h, m] = s.end.split(':');

  const endTime = new Date();

  endTime.setHours(h, m, 0);

  return now < endTime; // 現在時刻が予定終了時刻より前なら「就業中」

});

 if (MODE === "workcheck" && isWorkingNow) {

  sendSlack = false;

  console.log(`${store} 勤務中あり → スキップ``);

  continue;

}



if (MODE === "workcheck") {

  if (isWorkingNow) {

    console.log(`${store} 勤務中。スキップ`);

    sendSlack = false;

    continue;

  } else {

    console.log(`${store} 全員の退勤を確認しました。サマリーを作成します。`);

  }

}

 

/*const allFinished = staff.every(s => s.end);

if(MODE==="workcheck" && !allFinished){

 sendSlack = false;

 console.log(`${store} 勤務中あり → スキップ`);

 continue;

}*/

  

/* 勤務時間計算 */

let totalHours = "0.00";

let summaryStr = "";



if (staff.length > 0) {

  let totalNum = 0;

  const summaryMap = {};



  staff.forEach(s => {

    const hours = calcIndividualWork(s);

    totalNum += parseFloat(hours);

   summaryMap[hours] = (summaryMap[hours] || 0) + 1;

  });

  totalHours = totalNum.toFixed(2);

  summaryStr = Object.entries(summaryMap)

    .map(([hours, count]) => `${hours}時間x${count}人`)

    .join(", ");

  message += `合計勤務時間:${totalHours}時間\n`;

  message += `内訳:${summaryStr}\n`;

}



/*

if(allFinished){

 totalHours=calcTotalWork(staff);

 message += `合計勤務時間:${totalHours}時間\n`;

}

*/

/* Sheets記録 */

await writeSheet(

 date,

 time,

 store,

 count,

 staff.map(s=>s.name).join(","),

 totalHours

 vacancy,    // F列: 募集残

 summaryStr  // H列: 勤務時間サマリー

);



}



/* Slack */

if(SLACK_WEBHOOK && sendSlack){



 await fetch(SLACK_WEBHOOK,{

  method:"POST",

  headers:{

   "Content-Type":"application/json"

  },

  body:JSON.stringify({

   text:message

  })

 });



 console.log("Slack通知完了");



}



await browser.close();



})();



/* 勤務時間計算 */

// 一人あたりの勤務時間を計算する関数

function calcIndividualWork(s) {

  if (!s.start || !s.end) return "0.00";

  const start = roundUp(new Date(`1970-01-01T${s.start}:00`));

  const end = roundDown(new Date(`1970-01-01T${s.end}:00`));

  let hours = (end - start) / 1000 / 60 / 60;

  // 3.5時間超えは1時間休憩控除（貴社の現行ルールを適用）

  if (hours > 3.5) {

    hours -= 1;

  }

  return hours.toFixed(2);

}





/*

function calcTotalWork(staff){

 let total=0;

 staff.forEach(s=>{

  if(!s.start||!s.end) return;

  const start=roundUp(new Date(`1970-01-01T${s.start}:00`));

  const end=roundDown(new Date(`1970-01-01T${s.end}:00`));

  let hours=(end-start)/1000/60/60;

  if(hours>3.5){

   hours-=1;

  }

  total+=hours;

 });

 return total.toFixed(2);

}

*/

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



/* Sheets */

async function writeSheet(date, time, store, count, staff, total, vacancy, summary) {

  const auth = new google.auth.GoogleAuth({

    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),

    scopes: ["https://www.googleapis.com/auth/spreadsheets"]

  });

  const sheets = google.sheets({ version: "v4", auth });

  const spreadsheetId = process.env.SPREADSHEET_ID;

  const res = await sheets.spreadsheets.values.get({

    spreadsheetId,

    range: "Sheet1!A:C",

  });

  const rows = res.data.values || [];

  const normalizeDate = (d) => {

   if (!d) return "";

   return d.toString().replace(/-/g, '/').split('/').map(p => parseInt(p)).join('/');

  };

  const targetDate = normalizeDate(date);

  const rowIndex = rows.findIndex(row => {

    if (!row[0] || !row[2]) return false;

    return normalizeDate(row[0]) === targetDate && row[2].trim() === store.trim();

  });

  const values = [[date, time, store, count, staff, vacancy, total, summary]];

  if (rowIndex !== -1) { // 上書き (rowIndexは0始まりなので +1)

    await sheets.spreadsheets.values.update({

      spreadsheetId,

      range: `Sheet1!A${rowIndex + 1}`,

      valueInputOption: "USER_ENTERED",

      requestBody: { values }

    });

    console.log(`${store} のデータを上書きしました（${rowIndex + 1}行目）`);

  } else { // 新規追加

    await sheets.spreadsheets.values.append({

      spreadsheetId,

      range: "Sheet1!A1",

      valueInputOption: "USER_ENTERED",

      requestBody: { values }

    });

  }

}

Gemini の回答
これまでの修正をすべて統合した、完成版の index.js 全体コードを作成しました。

主な修正・追加ポイント
募集残の取得: ボタンクリック前に画面内の「あと〇人」をスクレイピングし、F列に記録します。

15:30の就業中判定: Excelの終了予定時刻と現在時刻を比較し、一人でも勤務中なら報告をスキップします。

勤務時間サマリー: H列に「5時間x2人」のような形式で内訳を自動生成します。

日付と店舗の一致判定: 表記揺れ（03月と3月など）を吸収して、既存行を確実に上書き（1日1行）します。

JavaScript
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
このコードにより、一日のサイクルが完全に自動化されます。何か動作に違和感があれば、またいつでも教えてくださいね。応援しています！





Gemini は AI であり、間違えることがあります。


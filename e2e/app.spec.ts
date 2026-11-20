// 実際の画面を自動で操作して、記録が残ることを確かめる（教材本文は使わず、架空の30語で行う）
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const N = 30;
function chapterMd(): string {
  const lines = ["# テスト用レベル / 01_test_track01", ""];
  for (let n = 1; n <= N; n++) {
    const no = String(n).padStart(3, "0");
    lines.push(
      `## ${no} word${n}`,
      `- 番号: kinfre-${String(n).padStart(4, "0")}`,
      `- 章: テスト用レベル / track ${Math.ceil(n / 15)}`,
      `- 品詞: ${n % 2 ? "名" : "動"}`,
      `- 日本語訳: 意味${n}`,
      `- 例文EN: a w---${n}`,
      `- 例文JA: 例文の訳${n}`,
      "- 品質: ok",
      "",
    );
  }
  return lines.join("\n");
}

async function importChapter(page: Page) {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.locator("label", { hasText: "教材データを読み込む" }).locator("input[type=file]").setInputFiles({
    name: "01_test_track01.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(chapterMd(), "utf-8"),
  });
  await expect(page.getByText(`${N}語を読み込みました`)).toBeVisible();
}

/** 表示中の単語 wordN を読み、正解（意味N）か、わざと別の選択肢を押す */
async function answer(page: Page, wrongNos: Set<number>) {
  const word = (await page.locator(".word").innerText()).trim();
  const n = Number(word.replace("word", ""));
  const isRetry = await page.locator(".retry-tag").isVisible();
  const wantWrong = wrongNos.has(n) && !isRetry;
  const correct = page.locator(".choice", { hasText: new RegExp(`^意味${n}$`) });
  if (wantWrong) {
    await page.locator(".choice").filter({ hasNotText: new RegExp(`^意味${n}$`) }).first().click();
    await expect(page.getByText("× 不正解")).toBeVisible();
    await expect(page.locator(".confused")).toContainText("の意味");
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.locator(".feedback")).toBeHidden(); // 次の問題か結果の画面に変わるまで待つ
  } else {
    await correct.click();
    await expect(page.getByText("○ 正解")).toBeVisible();
    // 既定では、迷わず正解しても回答後の画面（訳・例文・補足）で止まる
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.locator(".feedback")).toBeHidden();
  }
  return { n, wantWrong };
}

test("読み込み → 周回 → ミス → 再起動しても記録が残る → バックアップ → 別の端末で復元", async ({ page, browser }) => {
  await page.goto("./");
  await expect(page.getByText("はじめに")).toBeVisible();
  await page.screenshot({ path: "test-results/01_home_empty.png" });

  await importChapter(page);
  await page.screenshot({ path: "test-results/02_settings.png", fullPage: true });

  // 1周目を始める（本編すべて＝30語）
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（30語）/ }).click();
  await expect(page.locator(".word")).toBeVisible();
  await page.screenshot({ path: "test-results/03_study.png" });

  // 1〜10番を解く。2番と5番はわざと間違える
  const wrong = new Set([2, 5]);
  let shotFeedback = false;
  for (let guard = 0; guard < 20; guard++) {
    if (await page.getByText("セット完了").isVisible().catch(() => false)) break;
    if (await page.locator(".score").isVisible()) break;
    const { wantWrong } = await answer(page, wrong);
    if (wantWrong && !shotFeedback) shotFeedback = true;
  }
  await expect(page.locator(".score-num")).toContainText("8");
  await expect(page.locator(".score-num")).toContainText("/ 10 正解");
  await expect(page.locator("section.card", { has: page.getByRole("heading", { name: "ミスした語", exact: true }) })).toContainText("word2");
  await expect(page.locator("section.card", { has: page.getByRole("heading", { name: "ミスした語", exact: true }) })).toContainText("word5");
  await expect(page.getByText("10 / 30 語")).toBeVisible();
  await page.screenshot({ path: "test-results/04_result.png", fullPage: true });

  // アプリを閉じて開き直す（再読み込み）
  await page.reload();
  await expect(page.locator(".round-label")).toContainText("1周目");
  await expect(page.getByText("10 / 30 語")).toBeVisible();
  await page.screenshot({ path: "test-results/05_home_after_reload.png", fullPage: true });

  // 記録 → ミス一覧
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await expect(page.getByText("ミスした語 2語")).toBeVisible();
  await page.screenshot({ path: "test-results/06_records.png", fullPage: true });
  await page.locator(".row", { hasText: "word2" }).click();
  await expect(page.getByText("回答の履歴（2回）")).toBeVisible(); // 1回目×・その場のもう一度○
  await page.locator("label", { hasText: "どこを間違えたか" }).locator("textarea").fill("意味5と混同");
  await page.getByRole("button", { name: "メモを保存" }).click();
  await expect(page.getByRole("button", { name: "保存しました" })).toBeVisible();
  await page.screenshot({ path: "test-results/07_detail.png", fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await page.locator(".row", { hasText: "word2" }).click();
  await expect(page.locator("label", { hasText: "どこを間違えたか" }).locator("textarea")).toHaveValue("意味5と混同");

  // 今日の学習（ミスした語が出る）
  await page.getByRole("button", { name: "戻る" }).click();
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: /今日の学習（10問）/ }).click();
  await expect(page.locator(".word")).toBeVisible();
  await page.getByRole("button", { name: "✕ やめる" }).click({ trial: true });

  // バックアップを書き出す
  await page.goto("./");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  // 書き出す前に、毎回の保存先が見えている
  await expect(page.locator(".backup-place")).toContainText("保存先：iCloud Drive › TOEICトレーナー › バックアップ");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "バックアップを書き出す", exact: true }).click();
  const download = await downloadPromise;
  const path = "test-results/backup.json";
  await download.saveAs(path);
  expect(download.suggestedFilename()).toMatch(/^toeic-trainer-backup-\d{8}-\d{4}\.json$/);
  await expect(page.getByRole("status")).toContainText("保存先「iCloud Drive › TOEICトレーナー › バックアップ」に入っているか");
  await page.screenshot({ path: "test-results/08_backup_place.png", fullPage: true });

  // 保存先を変えると、開き直しても残り、案内も変わる
  const placeInput = page.locator("label", { hasText: "バックアップの保存先" }).locator("input");
  await placeInput.fill("架空ドライブ › 保管");
  await placeInput.blur();
  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.locator(".backup-place")).toContainText("保存先：架空ドライブ › 保管");
  await placeInput.fill("");
  await placeInput.blur();
  await expect(page.locator(".backup-place")).toContainText("保存先：iCloud Drive › TOEICトレーナー › バックアップ"); // 空にすると既定に戻る
  const backup = JSON.parse(readFileSync(path, "utf-8"));
  expect(backup.app).toBe("kinfre-trainer");
  expect(backup.logs.length).toBeGreaterThanOrEqual(12); // 10問＋もう一度2問
  expect(JSON.stringify([backup.logs, backup.cards, backup.rounds])).not.toMatch(/意味\d/); // 教材の訳は入れない（番号だけ。メモは自分の文なので対象外）
  expect(backup.logs.find((l: { correct: boolean }) => !l.correct).chosen).toMatch(/^kinfre-\d{4}$/);

  // まっさらな別の端末で、教材を読み込み → バックアップから戻す
  const other = await browser.newContext({ ...test.info().project.use });
  const p2 = await other.newPage();
  await p2.goto("./");
  await importChapter(p2);
  p2.on("dialog", (d) => d.accept());
  await p2.locator("label", { hasText: "バックアップから戻す" }).locator("input[type=file]").setInputFiles(path);
  await expect(p2.getByText(/バックアップから戻しました/)).toBeVisible();
  await p2.getByRole("button", { name: "記録", exact: true }).click();
  await expect(p2.getByText("ミスした語 2語")).toBeVisible();
  await p2.getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(p2.getByText("10 / 30 語")).toBeVisible();
  await other.close();
});

test("めくるモード：自己採点で記録される", async ({ page }) => {
  await page.goto("./");
  await importChapter(page);
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "めくる" }).click();
  await page.getByRole("button", { name: /今日の学習（10問）/ }).click();
  await page.getByRole("button", { name: "答えを見る" }).click();
  await page.screenshot({ path: "test-results/08_flip.png", fullPage: true });
  await page.locator(".rate-1").click(); // もう一度
  await expect(page.locator(".study-count")).toHaveText("2 / 11");
  await page.getByRole("button", { name: "✕ やめる" }).click({ trial: true });
});

test("今日の分が終わったら「終わりました」と出し、期限前の語は押したときだけ出す", async ({ page }) => {
  await page.goto("./");
  await importChapter(page);
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(page.getByText("今日の新しい語 あと 20")).toBeVisible();
  // 新しい語の上限（既定20語）まで、2セットを迷わず正解で解く（はじめての語は「簡単」になり、次は1週間ほど先）
  for (let set = 0; set < 2; set++) {
    await page.getByRole("button", { name: /今日の学習（10問）/ }).click();
    for (let i = 0; i < 10; i++) await answer(page, new Set());
    await page.getByRole("button", { name: "ホームへ" }).click();
  }
  await expect(page.getByText("✅ 今日の分は終わりました")).toBeVisible();
  await expect(page.getByText("今日の新しい語 あと 0")).toBeVisible();
  await expect(page.getByRole("button", { name: /今日の学習（/ })).toBeHidden();
  await page.screenshot({ path: "test-results/13_done_today.png", fullPage: true });
  // 追加で回す：直前の1時間に答えた語は出さないので、いまは出せる語が無い
  const msg = new Promise<string>((resolve) => page.once("dialog", (d) => (resolve(d.message()), void d.accept())));
  await page.getByRole("button", { name: /追加で回す（期限前の語・10問）/ }).click();
  expect(await msg).toContain("直前の1時間");
});

test("苦手だけの周回：ミスした語だけを範囲から選んで回す", async ({ page }) => {
  page.on("dialog", (d) => d.accept()); // 「ここでやめますか？」
  await page.goto("./");
  await importChapter(page);
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（30語）/ }).click();
  for (let i = 0; i < 3; i++) await answer(page, new Set([2])); // 2番だけわざと間違える
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();
  await page.getByRole("button", { name: "別の周回を始める" }).click();
  await page.getByLabel(/苦手だけ（ミスした語/).check();
  await expect(page.getByText("いまの対象：1語")).toBeVisible();
  await page.screenshot({ path: "test-results/14_weak_round.png", fullPage: true });
  await page.getByRole("button", { name: /2周目を始める（1語）/ }).click();
  await expect(page.locator(".word")).toHaveText("word2");
});

test("学習記録をやり直す：バックアップを書き出してから、記録だけを消す（教材・設定は残る）", async ({ page }) => {
  page.on("dialog", (d) => d.accept()); // 「消しますか？」
  await page.goto("./");
  await importChapter(page);
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: /今日の学習（10問）/ }).click();
  // 3番をわざと間違えるので、セットの最後にもう一度が1問増える（結果の画面が出るまで答える）
  for (let i = 0; i < 12 && !(await page.locator(".score-num").isVisible()); i++) await answer(page, new Set([3]));
  await page.getByRole("button", { name: "ホームへ" }).click();
  await expect(page.getByText("今日の新しい語 あと 10")).toBeVisible();

  await page.getByRole("button", { name: "設定", exact: true }).click();
  const card = page.locator("section.reset-records");
  await expect(card).toContainText("回答 11回"); // 10問＋セット内のもう一度1回
  await expect(card.getByRole("button", { name: "② 単語と文法の記録を消す" })).toBeEnabled();
  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: /① 先にバックアップを書き出す/ }).click();
  await download;
  await expect(card.getByRole("button", { name: "① 先にバックアップを書き出す（済み）" })).toBeVisible();
  await card.getByRole("button", { name: "② 単語と文法の記録を消す" }).click();
  await expect(card.getByRole("status")).toContainText("を消しました");
  await expect(card).toContainText("回答 0回");
  await expect(card.getByRole("button", { name: "② 単語と文法の記録を消す" })).toBeDisabled();
  await page.screenshot({ path: "test-results/15_reset.png", fullPage: true });

  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await expect(page.getByText("今日の新しい語 あと 20")).toBeVisible();
  await expect(page.locator(".stats-row")).toContainText("0/30");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByText("単語 30語")).toBeVisible(); // 教材は残る
});

test("データベースを開けないときは、読み込み中のまま止まらず理由と対処を出す", async ({ page }) => {
  // 端末側の不調で IndexedDB を開けない状態を作る（Dexie 4 は版の違い・表の欠けは自分で直して開くので、それでは止まらない）
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException("テスト用：開けない", "UnknownError");
    };
  });
  await page.goto("./");
  await expect(page.getByText("記録のデータベースを開けません")).toBeVisible();
  await expect(page.getByText("一時的につながりません")).toBeVisible();
  await expect(page.getByText("記録は消えていません")).toBeVisible();
  await expect(page.getByRole("button", { name: "もう一度読み込む" })).toBeVisible();
  await page.screenshot({ path: "test-results/12_db_error.png", fullPage: true });
});

test("一度開けば、電波がなくても起動できる", async ({ page, context }) => {
  await page.goto("./");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // Service Worker が画面を受け持つ状態にする
  await expect(page.getByText("はじめに")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("はじめに")).toBeVisible();
  await context.setOffline(false);
});

test("ほかの端末の記録と合わせる：両方の端末で解いた回答が、どちらも消えずに残る", async ({ page, browser }) => {
  async function daily(p: Page, wrong: Set<number>) {
    await p.getByRole("button", { name: "ホーム", exact: true }).click();
    await p.getByRole("button", { name: /今日の学習（10問）/ }).click();
    for (let guard = 0; guard < 20; guard++) {
      if (await p.locator(".score").isVisible()) break;
      await answer(p, wrong);
    }
    await expect(p.locator(".score")).toBeVisible();
    await p.goto("./");
  }

  // 端末A（iPhone）：今日の学習で word2 だけ間違える → バックアップを書き出す
  await page.goto("./");
  await importChapter(page);
  await daily(page, new Set([2]));
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "バックアップを書き出す", exact: true }).click();
  const path = "test-results/merge_backup_a.json";
  await (await downloadPromise).saveAs(path);
  const a = JSON.parse(readFileSync(path, "utf-8"));

  // 端末B（iPad）：別に今日の学習を全部正解 → Aのバックアップを「合わせて読み込む」
  const other = await browser.newContext({ ...test.info().project.use });
  const p2 = await other.newPage();
  await p2.goto("./");
  await importChapter(p2);
  await daily(p2, new Set());
  await p2.getByRole("button", { name: "設定", exact: true }).click();
  let dialogText = "";
  p2.on("dialog", (d) => ((dialogText = d.message()), d.accept()));
  await p2.locator("label", { hasText: "合わせて読み込む" }).locator("input[type=file]").setInputFiles(path);
  await expect(p2.getByText(new RegExp(`合わせました（足した回答 ${a.logs.length}件`))).toBeVisible();
  expect(dialogText).toContain("この端末の記録は消えません");
  expect(dialogText).toContain(`単語 ${a.logs.length}件`);
  await p2.screenshot({ path: "test-results/09_merge.png", fullPage: true });

  // Bの記録に、Aのミスが入っている。Bの回答も残っている
  await p2.getByRole("button", { name: "記録", exact: true }).click();
  await expect(p2.getByText("ミスした語 1語")).toBeVisible();
  await p2.locator(".row", { hasText: "word2" }).click();
  await expect(p2.getByText("回答の履歴（3回）")).toBeVisible(); // Aの×・Aのもう一度○・Bの○

  // 同じファイルをもう一度合わせても、増えない
  await p2.getByRole("button", { name: "戻る" }).click();
  await p2.getByRole("button", { name: "設定", exact: true }).click();
  await p2.locator("label", { hasText: "合わせて読み込む" }).locator("input[type=file]").setInputFiles(path);
  await expect(p2.getByText(/すべてこの端末に入っています/)).toBeVisible();
  await other.close();
});

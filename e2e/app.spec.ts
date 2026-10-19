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
  } else {
    await correct.click();
    await expect(page.locator(".feedback")).toBeVisible();
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
    if (!wantWrong) await page.waitForTimeout(900); // 自動で次へ
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
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "バックアップを書き出す" }).click();
  const download = await downloadPromise;
  const path = "test-results/backup.json";
  await download.saveAs(path);
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

// 文法（Part 5）を実際の画面で操作して、記録が残ること・単語の記録が壊れないことを確かめる
// 教材本文は使わず、架空の問題（章12問＋模試5問）と架空の30語で行う
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const LETTERS = "ABCD";
const answerOf = (n: number) => LETTERS[n % 4];

function wordsMd(): string {
  const lines = ["# テスト用レベル / 01_test_track01", ""];
  for (let n = 1; n <= 30; n++) {
    lines.push(
      `## ${String(n).padStart(3, "0")} word${n}`,
      `- 番号: kinfre-${String(n).padStart(4, "0")}`,
      `- 章: テスト用レベル / track ${Math.ceil(n / 15)}`,
      `- 品詞: ${n % 2 ? "名" : "動"}`,
      `- 日本語訳: 意味${n}`,
      "- 品質: ok",
      "",
    );
  }
  return lines.join("\n");
}

function grammarMd(heading: string, from: number, to: number, blocks: string[]): string {
  const lines = [`# ${heading}`, "", "- 出典: テスト用の架空データ", "- 要点B: 架空の手順", "", "---"];
  for (let n = from; n <= to; n++) {
    const no = String(n).padStart(4, "0");
    const block = blocks[Math.floor(((n - from) * blocks.length) / (to - from + 1))];
    lines.push(
      `## ${no}`,
      `- id: deru1000-${no}`,
      `- section: テスト分野${n % 2 ? "X" : "Y"}`,
      `- block: ${block}（ローカル${n - from + 1}）`,
      `- stem: Q${n} The fictional ------- is here.`,
      "- choices:",
      `  - (A) alpha${n}`,
      `  - (B) beta${n}`,
      `  - (C) gamma${n}`,
      `  - (D) delta${n}`,
      `- answer: ${answerOf(n)}`,
      `- explanation: 架空の解説${n}`,
      `- translation: 架空の訳${n}`,
      "- vocab:",
      `  - word${n}: 架空の語彙`,
      "- quality: ok",
      "---",
    );
  }
  return lines.join("\n");
}

const FILES = [
  { name: "01_test_track01.md", mimeType: "text/markdown", buffer: Buffer.from(wordsMd(), "utf-8") },
  { name: "01_testA_1.md", mimeType: "text/markdown", buffer: Buffer.from(grammarMd("第1章 テスト用の章A", 1, 12, ["練習：前半", "練習：後半"]), "utf-8") },
  { name: "08_testmock_1.md", mimeType: "text/markdown", buffer: Buffer.from(grammarMd("テスト模試 セット1", 13, 17, ["テスト模試 セット1"]), "utf-8") },
];

async function importAll(page: Page) {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.locator("label", { hasText: "教材データを読み込む" }).locator("input[type=file]").setInputFiles(FILES);
  await expect(page.getByText("30語を読み込みました")).toBeVisible();
  await expect(page.getByText("文法 17問を読み込みました（章・模試セット 2）")).toBeVisible();
}

/** 表示中の問題を読み、正解か、わざと別の選択肢を押す。あやふやを押してから答えることもできる */
async function answerPart5(page: Page, wrongNos: Set<number>, unsureNos: Set<number>) {
  const n = Number((await page.locator(".p5-head .no").innerText()).trim());
  const isRetry = await page.locator(".retry-tag").isVisible();
  const wantWrong = wrongNos.has(n) && !isRetry;
  const unsure = unsureNos.has(n) && !isRetry;
  if (unsure) await page.getByRole("button", { name: /あやふや/ }).click();
  const right = `(${answerOf(n)}) `;
  if (wantWrong) {
    await page.locator(".choice").filter({ hasNotText: right }).first().click();
    await expect(page.getByText("× 不正解")).toBeVisible();
    await expect(page.getByText(`架空の解説${n}`)).toBeVisible(); // ×のときは解説が開いている
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.locator(".feedback")).toBeHidden(); // 次の問題か結果の画面に変わるまで待つ
  } else if (unsure) {
    await page.locator(".choice", { hasText: right }).click();
    await expect(page.getByText("○ 正解")).toBeVisible();
    await expect(page.getByText(`架空の解説${n}`)).toBeVisible(); // あやふやで正解しても解説が開く
    await page.screenshot({ path: "test-results/deru_03_unsure.png", fullPage: true });
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.locator(".feedback")).toBeHidden(); // 次の問題か結果の画面に変わるまで待つ
  } else {
    await page.locator(".choice", { hasText: right }).click();
    await expect(page.getByText("○ 正解")).toBeVisible();
    await expect(page.getByText(`架空の解説${n}`)).toBeVisible(); // 既定では迷わず正解でも解説を開く（自動で次へは進まない）
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.locator(".feedback")).toBeHidden(); // 次の問題か結果の画面に変わるまで待つ
  }
}

test("文法：読み込み → 章の周回 → ミス・あやふや → 再起動しても残る → 単語の記録もそのまま → バックアップで別の端末へ", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("./");
  await importAll(page);

  // 単語の周回を少し進めておく（3語正解してやめる）
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（30語）/ }).click();
  for (let i = 1; i <= 3; i++) {
    await page.locator(".choice", { hasText: new RegExp(`^意味${i}$`) }).click();
    await expect(page.locator(".study-count")).toHaveText(`${i + 1} / 10`, { timeout: 3000 });
  }
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();
  await expect(page.getByText("3 / 30 語")).toBeVisible();

  // 文法に切り替える
  await page.getByRole("button", { name: "文法 Part 5" }).click();
  await expect(page.getByText("復習の時期が来た問題")).toBeVisible();
  await page.screenshot({ path: "test-results/deru_01_home.png", fullPage: true });
  await page.getByRole("button", { name: "周回を始める" }).click();
  await expect(page.getByRole("combobox", { name: "章" })).toContainText("第1章 テスト用の章A（12問）");
  await page.screenshot({ path: "test-results/deru_02_setup.png", fullPage: true });
  await page.getByRole("button", { name: /1周目を始める（12問）/ }).click();
  await expect(page.locator(".stem")).toContainText("Q1 The fictional");
  await expect(page.locator(".timer")).toBeVisible();
  await expect(page.locator(".choice").first()).toHaveText("(A) alpha1");
  await page.screenshot({ path: "test-results/deru_02b_question.png", fullPage: true });

  // 2番と5番はわざと間違え、3番は「あやふや」で正解する
  const wrong = new Set([2, 5]);
  const unsure = new Set([3]);
  for (let guard = 0; guard < 20; guard++) {
    if (await page.locator(".score").isVisible()) break;
    await answerPart5(page, wrong, unsure);
  }
  await expect(page.locator(".score-num")).toContainText("8");
  await expect(page.locator(".score-num")).toContainText("/ 10 正解");
  const missCard = page.locator("section.card", { has: page.getByRole("heading", { name: "ミスした問題", exact: true }) });
  await expect(missCard).toContainText("0002");
  await expect(missCard).toContainText("0005");
  await expect(page.locator("section.card", { has: page.getByRole("heading", { name: "正解したけど遅い・あやふや" }) })).toContainText("0003");
  await expect(page.getByText("10 / 12 問")).toBeVisible();
  await page.screenshot({ path: "test-results/deru_04_result.png", fullPage: true });

  // アプリを開き直しても、文法のまま・周回の位置も残る
  await page.reload();
  await expect(page.locator(".round-label")).toContainText("1周目：第1章 テスト用の章A");
  await expect(page.getByText("10 / 12 問")).toBeVisible();

  // 記録 → ミス一覧 → 詳細（選んだ記号・メモ）
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await expect(page.getByText("ミスした問題 2問")).toBeVisible();
  await page.locator(".row", { hasText: "0002" }).click();
  await expect(page.getByText("回答の履歴（2回）")).toBeVisible();
  await expect(page.locator(".history")).toContainText("を選択");
  await expect(page.locator(".p5-choice-list li.correct")).toHaveText(`(${answerOf(2)}) gamma2`);
  await page.locator("label", { hasText: /^メモ/ }).locator("textarea").fill("架空のメモ");
  await page.getByRole("button", { name: "メモを保存" }).click();
  await expect(page.getByRole("button", { name: "保存しました" })).toBeVisible();
  await page.screenshot({ path: "test-results/deru_05_detail.png", fullPage: true });
  await page.getByRole("button", { name: "戻る" }).click();
  await page.getByRole("button", { name: "範囲別" }).click();
  await expect(page.locator(".group", { hasText: "第1章 テスト用の章A" })).toContainText("解いた 10/12");
  await expect(page.locator(".group", { hasText: "テスト模試 セット1" })).toContainText("解いた 0/5");

  // 単語に戻すと、単語の周回・記録はそのまま
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "単語", exact: true }).click();
  await expect(page.getByText("3 / 30 語")).toBeVisible();
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await expect(page.getByText("まだミスはありません。")).toBeVisible();

  // 書き出し：バックアップ（選んだ記号だけ・本文なし）と学習メモ形式
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "バックアップを書き出す" }).click();
  const backupPath = "test-results/deru_backup.json";
  await (await dl).saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
  expect(backup).toMatchObject({ app: "kinfre-trainer", version: 2 });
  const grammarLogs = backup.logs.filter((l: { id: string }) => l.id.startsWith("deru1000-"));
  expect(grammarLogs.length).toBeGreaterThanOrEqual(12);
  expect(grammarLogs.find((l: { correct: boolean }) => !l.correct).chosen).toMatch(/^[A-D]$/);
  expect(backup.logs.filter((l: { id: string }) => l.id.startsWith("kinfre-"))).toHaveLength(3);
  expect(backup.rounds.map((r: { deck: string }) => r.deck).sort()).toEqual(["deru1000", "kinfre"]);
  expect(JSON.stringify([backup.logs, backup.cards, backup.rounds])).not.toMatch(/fictional|alpha\d|架空の解説|架空の訳/);

  const memoDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "学習メモ用.md" }).click();
  const memoPath = "test-results/deru_memo.md";
  await (await memoDl).saveAs(memoPath);
  const memo = readFileSync(memoPath, "utf-8");
  expect(memo).toContain("## 0002");
  expect(memo).toContain("- note: 架空のメモ");
  expect(memo).toMatch(/- wrong: \([ABCD]\)を選択・正解\(C\)・ミス1回/);
  await page.screenshot({ path: "test-results/deru_06_settings.png", fullPage: true });

  // まっさらな別の端末で、教材を読み込み → バックアップから戻す
  const other = await browser.newContext({ ...test.info().project.use });
  const p2 = await other.newPage();
  p2.on("dialog", (d) => d.accept());
  await p2.goto("./");
  await importAll(p2);
  await p2.locator("label", { hasText: "バックアップから戻す" }).locator("input[type=file]").setInputFiles(backupPath);
  await expect(p2.getByText(/バックアップから戻しました/)).toBeVisible();
  await p2.getByRole("button", { name: "ホーム", exact: true }).click();
  await p2.getByRole("button", { name: "文法 Part 5" }).click();
  await expect(p2.getByText("10 / 12 問")).toBeVisible();
  await p2.getByRole("button", { name: "記録", exact: true }).click();
  await expect(p2.getByText("ミスした問題 2問")).toBeVisible();
  await p2.getByRole("button", { name: "ホーム", exact: true }).click();
  await p2.getByRole("button", { name: "単語", exact: true }).click();
  await expect(p2.getByText("3 / 30 語")).toBeVisible();
  await other.close();
});

test("文法：模試セットの周回と、今日の学習（文法だけが出る）", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("./");
  await importAll(page);
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "文法 Part 5" }).click();

  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("radio", { name: "模試セットごと" }).check();
  await expect(page.getByRole("combobox", { name: "模試セット" })).toContainText("テスト模試 セット1（5問）");
  await page.getByRole("radio", { name: "ブロックごと（章の中の区切り）" }).check();
  await expect(page.getByRole("combobox", { name: "ブロック", exact: true })).toContainText("練習：前半（6問）");
  await page.getByRole("radio", { name: "模試セットごと" }).check();
  await page.getByRole("button", { name: /1周目を始める（5問）/ }).click();
  await expect(page.locator(".p5-head .no")).toHaveText("0013");
  await page.getByRole("button", { name: "✕ やめる" }).click({ trial: true });

  await page.goto("./");
  await page.getByRole("button", { name: /今日の学習（10問）/ }).click();
  await expect(page.locator(".p5-head")).toBeVisible();
  await expect(page.locator(".study-count")).toHaveText("1 / 10");
});

// 回答後の教材の見せ方：例文は全文（穴あきではなく）・右欄補足は開いて出す・語彙が本に無い問題は解説から拾う
// 教材本文は使わず、架空のデータだけ
import { expect, test } from "@playwright/test";

const answerOf = (n: number) => "ABCD"[n % 4];

function wordsMd(): string {
  const entry = (n: number, fields: string[]) => [
    `## ${String(n).padStart(3, "0")} fictword${n}`,
    `- 番号: kinfre-${String(n).padStart(4, "0")}`,
    "- 章: テスト用レベル / track 1",
    "- 品詞: 動",
    `- 日本語訳: 架空の意味${n}`,
    ...fields,
    "",
  ];
  return [
    "# テスト用レベル / 01_test_track01",
    "",
    // 1: 全文と穴あきの両方がある（全文を出す）
    ...entry(1, ["- 例文EN: We fictword1ed the plan.", "- 例文JA: 架空の例文訳1", "- 穴あき: We f--- the plan.", "- 右欄補足: 架空の補足1 fictnoun1 名 架空の名詞"]),
    // 2: 例文に見出し語が抜けている（読み取り漏れ。頭文字だけ残る）
    ...entry(2, ["- 例文EN: We read f", "- 例文JA: 架空の例文訳2", "- 穴あき: We read f", "- 右欄補足: 架空の補足2"]),
    ...entry(3, ["- 例文EN: The fictword3 is here.", "- 右欄補足: 架空の補足3"]),
    ...entry(4, ["- 例文EN: The fictword4 is here.", "- 右欄補足: 架空の補足4"]),
  ].join("\n");
}

function grammarMd(): string {
  const lines = ["# 第1章 テスト用の章A", "", "---"];
  const extra: Record<number, string[]> = {
    1: ["- explanation: 架空の解説1", "- vocab: □ fictvocab1：架空の語注1"],
    2: ["- explanation: 空所には fictadverb（架空の副詞）が入る。(A) fictadj（架空の形容詞）は形容詞。"],
    3: ["- explanation: 架空の解説3（英語なし）"],
  };
  for (let n = 1; n <= 3; n++) {
    const no = String(n).padStart(4, "0");
    lines.push(
      `## ${no}`,
      `- id: deru1000-${no}`,
      "- section: テスト分野X",
      "- block: 練習（ローカル1）",
      `- stem: Q${n} The fictional ------- is here.`,
      "- choices:",
      `  - (A) alpha${n}`,
      `  - (B) beta${n}`,
      `  - (C) gamma${n}`,
      `  - (D) delta${n}`,
      `- answer: ${answerOf(n)}`,
      ...extra[n],
      `- translation: 架空の訳${n}`,
      "- quality: ok",
      "---",
    );
  }
  return lines.join("\n");
}

test("回答後：例文は全文・読み取り漏れの印・右欄補足は開いて出す・語彙は本の注か解説から", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("./");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page
    .locator("label", { hasText: "教材データを読み込む" })
    .locator("input[type=file]")
    .setInputFiles([
      { name: "01_test_track01.md", mimeType: "text/markdown", buffer: Buffer.from(wordsMd(), "utf-8") },
      { name: "01_testA_1.md", mimeType: "text/markdown", buffer: Buffer.from(grammarMd(), "utf-8") },
    ]);
  await expect(page.getByText("文法 3問を読み込みました")).toBeVisible();

  // 単語：わざと間違えて回答後の画面を出す
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（4語）/ }).click();
  await page.locator(".choice").filter({ hasNotText: /^架空の意味1$/ }).first().click();
  await expect(page.locator(".example-en")).toHaveText("We fictword1ed the plan."); // 穴あき（f---）ではなく全文
  await expect(page.locator(".example-warn")).toHaveCount(0);
  await expect(page.getByText("架空の補足1 fictnoun1 名 架空の名詞")).toBeVisible(); // 右欄補足は開いている
  await page.screenshot({ path: "test-results/itemtext_01_word.png", fullPage: true });
  await page.getByRole("button", { name: "次へ" }).click();

  await page.locator(".choice").filter({ hasNotText: /^架空の意味2$/ }).first().click();
  await expect(page.locator(".example-en")).toHaveText("We read f");
  await expect(page.locator(".example-warn")).toContainText("見出し語が読み取れていません");
  await expect(page.getByText("架空の補足2")).toBeVisible();
  await page.screenshot({ path: "test-results/itemtext_02_word_missing.png", fullPage: true });
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();

  // 文法：解説は毎回開く（既定）。語彙は 本の注 → 解説から拾う → 無ければ「本に語注なし」
  await page.getByRole("button", { name: "文法 Part 5" }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（3問）/ }).click();
  await page.locator(".choice", { hasText: `(${answerOf(1)}) ` }).click();
  await expect(page.getByText("□ fictvocab1：架空の語注1")).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();

  await page.locator(".choice", { hasText: `(${answerOf(2)}) ` }).click();
  const vocab = page.locator("details", { hasText: "語彙（解説に出てくる語句）" });
  await expect(vocab).toContainText("本の語注（注）がありません");
  await expect(vocab.locator(".vocab-list li")).toHaveText(["fictadverb：架空の副詞", "fictadj：架空の形容詞"]);
  await page.screenshot({ path: "test-results/itemtext_03_vocab_from_explanation.png", fullPage: true });
  await page.getByRole("button", { name: "次へ" }).click();

  await page.locator(".choice", { hasText: `(${answerOf(3)}) ` }).click();
  await expect(page.locator(".vocab-none")).toHaveText("語彙：この問題には本の語注（注）がありません");
});

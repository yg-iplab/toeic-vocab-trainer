// 回答後の解説を毎回開く設定と、発音ボタン（端末の読み上げ機能）を実際の画面で確かめる
// 読み上げは本物の音を出さず、渡された文を記録するにせものに置き換える。教材本文は使わず架空のデータだけ
import { expect, test, type Page } from "@playwright/test";

const answerOf = (n: number) => "ABCD"[n % 4];

function grammarMd(): string {
  const lines = ["# 第1章 テスト用の章A", "", "---"];
  for (let n = 1; n <= 6; n++) {
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
      `- explanation: 架空の解説${n}`,
      `- translation: 架空の訳${n}`,
      "- quality: ok",
      "---",
    );
  }
  return lines.join("\n");
}

function wordsMd(): string {
  const lines = ["# テスト用レベル / 01_test_track01", ""];
  for (let n = 1; n <= 8; n++) {
    lines.push(`## ${String(n).padStart(3, "0")} word${n}`, `- 番号: kinfre-${String(n).padStart(4, "0")}`, "- 章: テスト用レベル / track 1", "- 品詞: 名", `- 日本語訳: 意味${n}`, `- 例文EN: The fictional word${n} example.`, "");
  }
  return lines.join("\n");
}

// rate はブラウザの中で 32bit の小数になる（0.9 → 0.8999…）ので、小数2桁にそろえて比べる
const spoken = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __spoken: { text: string; lang: string; rate: number }[] }).__spoken.map((x) => ({ ...x, rate: Math.round(x.rate * 100) / 100 })),
  );

test("文法の解説を毎回開く（設定で切り替え）・発音ボタンで正解の文と単語を読む", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: unknown[] };
    w.__spoken = [];
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.__spoken.push({ text: u.text, lang: u.lang, rate: u.rate });
    window.speechSynthesis.cancel = () => {};
  });
  page.on("dialog", (d) => d.accept());
  await page.goto("./");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page
    .locator("label", { hasText: "教材データを読み込む" })
    .locator("input[type=file]")
    .setInputFiles([
      { name: "01_testA_1.md", mimeType: "text/markdown", buffer: Buffer.from(grammarMd(), "utf-8") },
      { name: "01_test_track01.md", mimeType: "text/markdown", buffer: Buffer.from(wordsMd(), "utf-8") },
    ]);
  await expect(page.getByText("文法 6問を読み込みました")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /解説と全訳をいつも開く/ })).toBeChecked();

  // 文法：迷わず正解しても解説・全訳が開き、自動で次へ進まない
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "文法 Part 5" }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（6問）/ }).click();
  await page.locator(".choice", { hasText: `(${answerOf(1)}) ` }).click();
  await expect(page.getByText("○ 正解")).toBeVisible();
  await expect(page.getByText("架空の解説1")).toBeVisible();
  await expect(page.getByText("架空の訳1")).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator(".study-count")).toHaveText("1 / 6");

  // 発音ボタン：空所に正解を入れた文と、正解の語句を、英語・設定の速さで
  await page.getByRole("button", { name: "🔊 正解の文を聞く" }).click();
  await page.getByRole("button", { name: "🔊 正解の語句" }).click();
  expect(await spoken(page)).toEqual([
    { text: "Q1 The fictional beta1 is here.", lang: "en-US", rate: 0.9 },
    { text: "beta1", lang: "en-US", rate: 0.9 },
  ]);
  await page.screenshot({ path: "test-results/explain_01_feedback.png", fullPage: true });
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.locator(".p5-head .no")).toHaveText("0002");
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();

  // 設定で切ると、迷わず正解なら解説は閉じたまま自動で次へ（Phase 2 までと同じ）
  await page.getByRole("button", { name: "設定", exact: true }).click();
  // 設定は保存してから画面に反映されるので、押してから外れるのを待つ
  await page.getByRole("checkbox", { name: /解説と全訳をいつも開く/ }).click();
  await expect(page.getByRole("checkbox", { name: /解説と全訳をいつも開く/ })).not.toBeChecked();
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: /続きから/ }).click();
  await expect(page.locator(".p5-head .no")).toHaveText("0002");
  await page.locator(".choice", { hasText: `(${answerOf(2)}) ` }).click();
  await expect(page.locator(".feedback")).toBeVisible();
  await expect(page.getByText("架空の解説2")).toBeHidden();
  await expect(page.locator(".p5-head .no")).toHaveText("0003", { timeout: 3000 });

  // 単語：回答後に単語と例文を読める
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();
  await page.getByRole("button", { name: "単語", exact: true }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（8語）/ }).click();
  await page.locator(".choice").filter({ hasNotText: /^意味1$/ }).first().click();
  await page.getByRole("button", { name: "🔊 単語" }).click();
  await page.getByRole("button", { name: "🔊 例文" }).click();
  expect((await spoken(page)).slice(-2).map((x) => x.text)).toEqual(["word1", "The fictional word1 example."]);
});

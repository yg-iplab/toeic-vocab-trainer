// 公式音声：ZIP と時間の表を読み込む → 🔊 が「公式」になり、決まった秒を鳴らす → 無い所は「合成」→ 開き直しても残る → 消せる
// 音声は架空のバイト列だけ。再生は本物の音を出さず、渡された src を記録するにせものに置き換える
import { expect, test, type Page } from "@playwright/test";
import { makeZip, silentBytes } from "../tests/helpers";

const answerOf = (n: number) => "ABCD"[n % 4];

function wordsMd(): string {
  const lines = ["# テスト用レベル / 01_test_track01", ""];
  for (let n = 1; n <= 4; n++) {
    lines.push(`## ${String(n).padStart(3, "0")} fictword${n}`, `- 番号: kinfre-${String(n).padStart(4, "0")}`, "- 章: テスト用レベル / track 1", "- 品詞: 名", `- 日本語訳: 架空の意味${n}`, `- 例文EN: The fictword${n} is here.`, "");
  }
  return lines.join("\n");
}

function grammarMd(): string {
  const lines = ["# 第1章 テスト用の章A", "", "---"];
  for (let n = 1; n <= 2; n++) {
    const no = String(n).padStart(4, "0");
    lines.push(`## ${no}`, `- id: deru1000-${no}`, "- section: テスト分野X", "- block: 練習（ローカル1）", `- stem: Q${n} The fictional ------- is here.`, "- choices:", `  - (A) alpha${n}`, `  - (B) beta${n}`, `  - (C) gamma${n}`, `  - (D) delta${n}`, `- answer: ${answerOf(n)}`, `- explanation: 架空の解説${n}`, "- quality: ok", "---");
  }
  return lines.join("\n");
}

const played = (page: Page) => page.evaluate(() => (window as unknown as { __played: string[] }).__played);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test("公式音声：読み込み → 🔊 が公式（決まった秒）／無い所は合成 → 開き直しても残る → 消せる", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __played: string[]; __spoken: string[] };
    w.__played = [];
    w.__spoken = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__played.push(this.src);
      return Promise.resolve();
    };
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.__spoken.push(u.text);
    window.speechSynthesis.cancel = () => {};
  });
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
  await expect(page.getByText("文法 2問を読み込みました")).toBeVisible();

  // 音声：単語は track 1 の1本（＋使わない track 7）と時間の表、文法は 0001 だけ
  const wordsZip = makeZip([
    { name: "fict_en01.mp3", data: silentBytes(6000), deflate: true },
    { name: "fict_en07.mp3", data: silentBytes(1000), deflate: true },
  ]);
  const grammarZip = makeZip([{ name: "Fict_0001.mp3", data: silentBytes(3000) }]);
  const index = { app: "kinfre-trainer", kind: "audio-index", version: 1, items: [{ id: "kinfre-0001", track: 1, word: [0.4, 1.0], example: [1.4, 3.0] }] };
  await page
    .locator("label", { hasText: "音声を読み込む" })
    .locator("input[type=file]")
    .setInputFiles([
      { name: "fict_en.zip", mimeType: "application/zip", buffer: Buffer.from(wordsZip) },
      { name: "fict_q.zip", mimeType: "application/zip", buffer: Buffer.from(grammarZip) },
      { name: "kinfre_audio_index.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(index)) },
    ]);
  await expect(page.getByRole("status")).toContainText("単語の音声 1本・文法の音声 1問");
  await expect(page.getByRole("status")).toContainText("時間の表 1語");
  await expect(page.getByText("単語 1本（6KB・時間の表 1語）／文法 1問（3KB）")).toBeVisible();
  await page.screenshot({ path: "test-results/audio_01_settings.png", fullPage: true });

  // 単語：時間の表にある語は「公式」で、その秒だけ。無い語は「合成」
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（4語）/ }).click();
  await page.locator(".choice", { hasText: /^架空の意味1$/ }).click();
  await page.getByRole("button", { name: "🔊 例文（公式）" }).click();
  await page.getByRole("button", { name: "🔊 単語（公式）" }).click();
  const srcs = await played(page);
  expect(srcs).toHaveLength(2);
  expect(srcs[0]).toMatch(/^blob:.+#t=1\.40,3\.00$/);
  expect(srcs[1]).toMatch(/^blob:.+#t=0\.40,1\.00$/);
  await page.screenshot({ path: "test-results/audio_02_word_official.png", fullPage: true });
  await page.getByRole("button", { name: "次へ" }).click();
  await page.locator(".choice", { hasText: /^架空の意味2$/ }).click();
  await expect(page.getByRole("button", { name: "🔊 例文（合成）" })).toBeVisible();
  await page.getByRole("button", { name: "🔊 例文（合成）" }).click();
  expect(await spoken(page)).toEqual(["The fictword2 is here."]);
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();

  // 文法：1問1本は区切らずに鳴らす。音声の無い問題は合成
  await page.getByRole("button", { name: "文法 Part 5" }).click();
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（2問）/ }).click();
  await page.locator(".choice", { hasText: `(${answerOf(1)}) ` }).click();
  await page.getByRole("button", { name: "🔊 正解の文を聞く（公式）" }).click();
  expect((await played(page)).at(-1)).toMatch(/^blob:[^#]+$/);
  await expect(page.getByRole("button", { name: "🔊 正解の語句（合成）" })).toBeVisible();
  await page.getByRole("button", { name: "次へ" }).click();
  await page.locator(".choice", { hasText: `(${answerOf(2)}) ` }).click();
  await expect(page.getByRole("button", { name: "🔊 正解の文を聞く（合成）" })).toBeVisible();
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();

  // 開き直しても音声は残る。バックアップには入らない
  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByText("単語 1本（6KB・時間の表 1語）／文法 1問（3KB）")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "バックアップを書き出す" }).click();
  const path = "test-results/audio_backup.json";
  await (await downloadPromise).saveAs(path);
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(path, "utf-8");
  expect(text).not.toMatch(/kinfre-en-01|deru1000-0001"?,\s*"deck|audioSegs/);
  expect(text.length).toBeLessThan(5000);

  // 消すと「合成」に戻る（学習記録は消えない）
  await page.getByRole("button", { name: "単語の音声を消す" }).click();
  await expect(page.getByText("単語の公式音声を消しました。")).toBeVisible();
  await expect(page.getByText("単語 0本（0B・時間の表 0語）／文法 1問（3KB）")).toBeVisible();
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "単語", exact: true }).click();
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await page.getByRole("searchbox").fill("fictword1");
  await page.locator(".row", { hasText: "fictword1" }).click();
  await expect(page.getByRole("button", { name: "🔊 例文（合成）" })).toBeVisible();
});

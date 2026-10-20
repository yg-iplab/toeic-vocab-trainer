// Phase 2b を実際の画面で：解き方（tips）の読み込みと表示、模試は同じ分野の章の解き方、類題、進捗グラフ、
// それと「版2の DB（Phase 2 の記録）を新しい版で開いても記録が残る」こと
// 教材本文は使わず、架空の問題（章12問＋模試5問）と架空の解き方で行う
import { expect, test, type Page } from "@playwright/test";

const LETTERS = "ABCD";
const answerOf = (n: number) => LETTERS[n % 4];

function grammarMd(heading: string, from: number, to: number, block: string): string {
  const lines = [`# ${heading}`, "", "- 出典: テスト用の架空データ", "", "---"];
  for (let n = from; n <= to; n++) {
    const no = String(n).padStart(4, "0");
    lines.push(
      `## ${no}`,
      `- id: deru1000-${no}`,
      `- section: テスト分野${n % 2 ? "X" : "Y"}${heading.startsWith("第") ? "問題" : ""}`,
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
      "- quality: ok",
      "---",
    );
  }
  return lines.join("\n");
}

function tipsMd(heading: string): string {
  return [
    `# ${heading}`,
    "",
    "架空の変換メモ",
    "",
    "| 架空の列 | 架空の対応表 | 架空の頁 | 架空の元 |",
    "| --- | --- | --- | --- |",
    "| 架空 | p01 | 1 | a.png |",
    "",
    "---",
    "",
    "## 架空の手順",
    "",
    "1. 架空の一歩目",
    "   架空の続き",
    "2. 架空の二歩目",
    "   - 架空の入れ子",
    "",
    "### 架空の表",
    "",
    "| 形 | 例 |",
    "| --- | --- |",
    "| **架空の太字** | <u>架空の下線</u><br>架空の2行目 |",
    "",
    "> 架空の引用",
    "",
    "```",
    "架空の図   ← 字下げ",
    "```",
  ].join("\n");
}

const md = (name: string, text: string) => ({ name, mimeType: "text/markdown", buffer: Buffer.from(text, "utf-8") });

const FILES = [
  md("01_testA_1.md", grammarMd("第1章 テスト用の章A", 1, 12, "練習")),
  md("08_testmock_1.md", grammarMd("テスト模試 セット1", 13, 17, "テスト模試 セット1")),
  md("00_test_tsukaikata.md", tipsMd("架空の本の使い方")),
  md("01_test_tips.md", tipsMd("第1章《テスト》の架空の解き方")),
  md("_LOG.md", "# 架空の履歴\n\n本文"),
];

async function importAll(page: Page) {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.locator("label", { hasText: "教材データを読み込む" }).locator("input[type=file]").setInputFiles(FILES);
  await expect(page.getByText("文法 17問を読み込みました（章・模試セット 2）")).toBeVisible();
  await expect(page.getByText("解き方 2本を読み込みました（巻頭・第1章）")).toBeVisible();
  await expect(page.getByText("飛ばした項目 1件")).toBeVisible();
  await expect(page.getByText(/解き方 2本$/)).toBeVisible();
}

/** 開いている解き方のシートの中身を確かめて閉じる */
async function checkSheet(page: Page, title: RegExp, shot?: string) {
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "架空の手順" })).toBeVisible();
  await expect(sheet.locator("ol > li")).toHaveCount(2);
  await expect(sheet.locator("li li")).toHaveText("架空の入れ子");
  await expect(sheet.locator(".md-table").last().locator("strong")).toHaveText("架空の太字");
  await expect(sheet.locator(".md-table").last().locator("u")).toHaveText("架空の下線");
  await expect(sheet.locator("blockquote")).toHaveText("架空の引用");
  await expect(sheet.locator(".md-pre")).toHaveText("架空の図   ← 字下げ");
  // 変換メモ（元ファイルとの対応表）は畳んである
  await expect(sheet.getByText("このファイルについて")).toBeVisible();
  await expect(sheet.getByText("架空の対応表")).toBeHidden();
  // 横にはみ出さない（表は枠の中で横に動かす）
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (shot) await page.screenshot({ path: shot, fullPage: false });
  await sheet.getByRole("button", { name: "✕ 閉じる" }).click();
  await expect(sheet).toBeHidden();
}

async function answer(page: Page, right: boolean) {
  const n = Number((await page.locator(".p5-head .no").innerText()).trim());
  const label = `(${answerOf(n)}) `;
  if (right) await page.locator(".choice", { hasText: label }).click();
  else await page.locator(".choice").filter({ hasNotText: label }).first().click();
  return n;
}

test("解き方：読み込み → ホーム・回答後・詳細から読む → 模試は同じ分野の章 → 類題 → 進捗グラフ", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("./");
  await importAll(page);

  // ホーム（文法）→ 解き方の一覧 → 第1章
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "文法 Part 5" }).click();
  await page.getByRole("button", { name: "📖 解き方を読む（2本）" }).click();
  await expect(page.locator(".row").first()).toContainText("巻頭");
  await page.locator(".row", { hasText: "第1章" }).click();
  await checkSheet(page, /第1章《テスト》/, "test-results/tips_01_sheet.png");
  await page.getByRole("button", { name: "戻る" }).click();

  // 章の周回：1問目をわざと間違え、回答後に「この章の解き方」を開いて閉じる
  await page.getByRole("button", { name: "周回を始める" }).click();
  await page.getByRole("button", { name: /1周目を始める（12問）/ }).click();
  expect(await answer(page, false)).toBe(1);
  await expect(page.getByText("× 不正解")).toBeVisible();
  await page.getByRole("button", { name: "📖 この章の解き方" }).click();
  await checkSheet(page, /第1章《テスト》/);
  await expect(page.getByText("× 不正解")).toBeVisible(); // 閉じると回答後の画面に戻る
  await page.screenshot({ path: "test-results/tips_02_feedback.png", fullPage: true });
  await page.getByRole("button", { name: "次へ" }).click();
  // 残りは正解して周回を進める（セットの最後に1問目のもう一度が来る）
  for (let guard = 0; guard < 12; guard++) {
    if (await page.locator(".score").isVisible()) break;
    await answer(page, true);
    const next = page.getByRole("button", { name: "次へ" });
    await expect(page.locator(".feedback")).toBeVisible();
    await page.waitForTimeout(900);
    if (await next.isVisible()) await next.click();
    await expect(page.locator(".feedback")).toBeHidden(); // 次の問題か結果の画面に変わるまで待つ
  }
  await expect(page.locator(".score")).toBeVisible();

  // 模試セットの問題 → 同じ分野の第1章の解き方
  await page.getByRole("button", { name: "ホームへ" }).click();
  await page.getByRole("button", { name: "別の周回を始める" }).click();
  await page.getByRole("radio", { name: "模試セットごと" }).check();
  await page.getByRole("button", { name: /2周目を始める（5問）/ }).click();
  expect(await answer(page, false)).toBe(13);
  await page.getByRole("button", { name: "📖 この分野の解き方（第1章）" }).click();
  await expect(page.getByText("この問題と同じ分野の問題がいちばん多い第1章の解き方です。")).toBeVisible();
  await checkSheet(page, /第1章《テスト》/);
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "✕ やめる" }).click();
  await page.getByRole("button", { name: "ホームへ" }).click();

  // 詳細画面からも開ける
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await page.locator(".row", { hasText: "0001" }).click();
  await page.getByRole("button", { name: "📖 この章の解き方" }).click();
  await checkSheet(page, /第1章《テスト》/);
  await page.getByRole("button", { name: "戻る" }).click();

  // 進捗グラフ：章は1周目、模試は2周目の正答率
  await page.getByRole("button", { name: "範囲別" }).click();
  const chart = page.locator("section.card", { has: page.getByRole("heading", { name: "周回ごとの正答率" }) });
  await expect(chart).toBeVisible();
  await expect(chart.locator("li", { hasText: "第1章 テスト用の章A" }).locator(".pass-row")).toHaveText(/1周目.*\d+%/);
  await expect(chart.locator("li", { hasText: "テスト模試 セット1" }).locator(".pass-row")).toHaveText(/2周目\s*0%\s*0\/1/);
  await page.screenshot({ path: "test-results/tips_03_chart.png", fullPage: true });

  // 今日の学習：最近ミスした分野（X）の、まだ解いていない問題が「類題」で出る
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: /今日の学習（10問）/ }).click();
  const similarNos: number[] = [];
  for (let guard = 0; guard < 14; guard++) {
    if (await page.locator(".score").isVisible()) break;
    if (await page.locator(".similar-tag").isVisible()) {
      await expect(page.locator(".similar-tag")).toContainText("類題：最近ミスした分野（テスト分野X");
      if (similarNos.length === 0) await page.screenshot({ path: "test-results/tips_04_similar.png", fullPage: true });
      similarNos.push(Number((await page.locator(".p5-head .no").innerText()).trim()));
    }
    await answer(page, true);
    await expect(page.locator(".feedback")).toBeVisible();
    await page.waitForTimeout(900);
    const next = page.getByRole("button", { name: "次へ" });
    if (await next.isVisible()) await next.click();
    await expect(page.locator(".feedback")).toBeHidden(); // 次の問題か結果の画面に変わるまで待つ
  }
  expect(similarNos.length).toBeGreaterThan(0);
  // 分野Xは奇数番。まだ解いていなかった問題だけ
  for (const n of similarNos) {
    expect(n % 2).toBe(1);
    expect([11, 15, 17]).toContain(n);
  }
});

test("版2の DB（Phase 2 の記録）を新しい版で開いても、記録・周回・設定が残る", async ({ page }) => {
  const NOW = Date.now();
  // アプリを開く前に、同じ場所（オリジン）に Phase 2 と同じ形の DB を作っておく
  await page.goto("./sw.js");
  await page.evaluate(async (now) => {
    const day = 86400000;
    const fsrs = { due: now + 2 * day, stability: 5, difficulty: 5, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 1, state: 2, last_review: now - day };
    const deru = (n: number) => ({
      id: `deru1000-000${n}`, deck: "deru1000", no: n, order: n, section: "テスト分野X", chapter: "c01", block: "練習",
      stem: `Q${n} The fictional ------- is here.`, choices: ["alpha", "beta", "gamma", "delta"], answer: "B", explanation: `架空の解説${n}`,
    });
    const word = (n: number) => ({ id: `kinfre-000${n}`, deck: "kinfre", part: "main", no: n, order: n, section: "テスト用レベル", track: 1, word: `word${n}`, pos: ["名"], ja: `意味${n}` });
    const log = (id: string, ts: number, correct: boolean, rid: number, format: string, chosen?: string) => ({
      id, ts, day: "2026-10-18", mode: "round", round: 1, rid, format, correct, chosen, ms: 5000, unsure: false, rating: correct ? 3 : 1, retry: false,
    });
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("kinfre-trainer", 20); // Dexie の版2 = IndexedDB の版20
      req.onupgradeneeded = () => {
        const d = req.result;
        const store = (name: string, key: string, auto: boolean, idx: string[]) => {
          const s = d.createObjectStore(name, { keyPath: key, autoIncrement: auto });
          for (const i of idx) s.createIndex(i, i);
        };
        store("items", "id", false, ["deck", "order", "section", "part"]);
        store("cards", "id", false, ["due", "status", "miss_count"]);
        store("logs", "seq", true, ["id", "ts", "day", "round"]);
        store("notes", "id", false, []);
        store("rounds", "rid", true, ["deck", "no", "finishedAt"]);
        store("meta", "key", false, []);
        store("chapters", "key", false, ["deck"]);
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const d = req.result;
        const tx = d.transaction(["items", "cards", "logs", "notes", "rounds", "meta", "chapters"], "readwrite");
        for (const i of [deru(1), deru(2), deru(3), word(1), word(2)]) tx.objectStore("items").put(i);
        tx.objectStore("cards").put({ id: "deru1000-0001", due: fsrs.due, fsrs, status: "missed", miss_count: 1, correct_count: 0, last_reviewed: "2026-10-18", last_correct: false });
        tx.objectStore("cards").put({ id: "deru1000-0002", due: fsrs.due, fsrs, status: "learning", miss_count: 0, correct_count: 1, last_reviewed: "2026-10-18", last_correct: true });
        tx.objectStore("cards").put({ id: "kinfre-0001", due: fsrs.due, fsrs, status: "missed", miss_count: 2, correct_count: 0, last_reviewed: "2026-10-18", last_correct: false });
        tx.objectStore("logs").add(log("deru1000-0001", now - day, false, 1, "part5", "C"));
        tx.objectStore("logs").add(log("deru1000-0002", now - day + 1, true, 1, "part5"));
        tx.objectStore("logs").add(log("kinfre-0001", now - day + 2, false, 2, "mc", "kinfre-0002"));
        tx.objectStore("notes").put({ id: "deru1000-0001", custom_note: "架空のメモ" });
        tx.objectStore("rounds").add({ deck: "deru1000", no: 1, label: "1周目：第1章 架空", itemIds: ["deru1000-0001", "deru1000-0002", "deru1000-0003"], cursor: 2, order: "seq", startedAt: now - day });
        tx.objectStore("rounds").add({ deck: "kinfre", no: 1, label: "1周目：本編 1–2", itemIds: ["kinfre-0001", "kinfre-0002"], cursor: 1, order: "seq", startedAt: now - day });
        tx.objectStore("meta").put({ key: "settings", value: { deck: "deru1000", deruSetSize: 15 } });
        tx.objectStore("meta").put({ key: "lastBackupAt", value: now - 60000 });
        tx.objectStore("chapters").put({ key: "c01", deck: "deru1000", label: "第1章 架空", order: 1, tips: [{ k: "要点", v: "架空の要点" }] });
        tx.oncomplete = () => {
          d.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, NOW);

  await page.goto("./");
  // 文法のまま、周回の位置・ミス・メモが残っている
  await expect(page.locator(".round-label")).toContainText("1周目：第1章 架空");
  await expect(page.getByText("2 / 3 問")).toBeVisible();
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await expect(page.getByText("ミスした問題 1問")).toBeVisible();
  await page.locator(".row", { hasText: "0001" }).click();
  await expect(page.locator("label", { hasText: /^メモ/ }).locator("textarea")).toHaveValue("架空のメモ");
  await expect(page.locator(".history")).toContainText("(C) を選択");
  await page.getByRole("button", { name: "戻る" }).click();
  await page.getByRole("button", { name: "範囲別" }).click();
  await expect(page.locator(".pass-row")).toHaveText(/1周目\s*50%\s*1\/2/);
  // 単語の記録もそのまま
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.getByRole("button", { name: "単語", exact: true }).click();
  await expect(page.getByText("1 / 2 語")).toBeVisible();
  await page.getByRole("button", { name: "記録", exact: true }).click();
  await expect(page.getByText("ミスした語 1語")).toBeVisible();

  // DB は版3（IndexedDB の版30）になり、解き方の表が増えて、記録の行数は変わらない
  const after = await page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; logs: number; cards: number }>((resolve) => {
        const req = indexedDB.open("kinfre-trainer");
        req.onsuccess = () => {
          const d = req.result;
          const tx = d.transaction(["logs", "cards"]);
          const logs = tx.objectStore("logs").count();
          const cards = tx.objectStore("cards").count();
          tx.oncomplete = () => {
            resolve({ version: d.version, stores: [...d.objectStoreNames], logs: logs.result, cards: cards.result });
            d.close();
          };
        };
      }),
  );
  expect(after.version).toBe(40); // 版2 → 版4（Dexie の版×10）。版3の解き方・版4の公式音声の表が足される
  expect(after.stores).toContain("tips");
  expect(after.stores).toContain("audio");
  expect(after.stores).toContain("audioSegs");
  expect(after.logs).toBe(3);
  expect(after.cards).toBe(3);
});

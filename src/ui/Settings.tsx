// 設定（教材の読み込み・バックアップ・学習の設定）
import { useEffect, useState } from "react";
import {
  backupFileName,
  buildBackup,
  deruMemoMarkdown,
  deruMissListMarkdown,
  logCounts,
  markBackedUp,
  missListMarkdown,
  overlayJsonl,
  parseBackup,
  restoreBackup,
  saveTextFile,
} from "../data/backup";
import { db, saveSettings, upsertItems } from "../data/db";
import { mergeChapters } from "../data/parseDeru";
import { parseMaterialFile } from "../data/parseFile";
import { ensurePersisted, isStandalone, type PersistState } from "../data/persist";
import { formatDateTime, localDay } from "../lib/date";
import type { ChapterInfo, Item, Settings as SettingsT } from "../types";
import { TopBar } from "./components";
import type { Store } from "./store";

export async function exportBackup(store: Store): Promise<boolean> {
  const now = Date.now();
  const text = JSON.stringify(await buildBackup(now));
  const ok = await saveTextFile(backupFileName(now), text, "application/json");
  if (ok) {
    await markBackedUp(now);
    await store.reload();
  }
  return ok;
}

/** 秒数・問題数などの選択肢 */
function Choice({
  label,
  value,
  options,
  format,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[...new Set([...options, value])]
          .sort((a, b) => a - b)
          .map((n) => (
            <option key={n} value={n}>
              {format(n)}
            </option>
          ))}
      </select>
    </label>
  );
}

export function Settings({ store }: { store: Store }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [persist, setPersist] = useState<PersistState | null>(null);
  const s = store.settings;

  useEffect(() => {
    void ensurePersisted().then(setPersist);
  }, []);

  const update = async (patch: Partial<SettingsT>) => {
    await saveSettings({ ...s, ...patch });
    await store.reload();
  };

  const importItems = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const all: Item[] = [];
    let chapters: ChapterInfo[] = [];
    const skip: string[] = [];
    for (const f of Array.from(files)) {
      const r = parseMaterialFile(f.name, await f.text());
      all.push(...r.items);
      if (r.chapters) chapters = mergeChapters(chapters, r.chapters);
      skip.push(...r.skipped.map((x) => `${f.name}: ${x}`));
    }
    if (all.length === 0) {
      setMsg("読み込める問題がありませんでした。kinfre/chapters または deru1000/chapters の .md ファイルを選んでください。");
      setSkipped(skip);
      return;
    }
    await upsertItems(all, chapters);
    await store.reload();
    const words = all.filter((i) => i.deck === "kinfre");
    const grammar = all.filter((i) => i.deck === "deru1000");
    const parts: string[] = [];
    if (words.length) {
      const main = words.filter((i) => i.deck === "kinfre" && i.part === "main").length;
      parts.push(`${words.length}語を読み込みました（本編 ${main}・Supplement ${words.length - main}）。`);
    }
    if (grammar.length) parts.push(`文法 ${grammar.length}問を読み込みました（章・模試セット ${chapters.length}）。`);
    setMsg(`${parts.join("")}学習記録はそのままです。`);
    setSkipped(skip);
  };

  const restore = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const b = parseBackup(await f.text());
      const now = logCounts(await db.logs.toArray());
      const next = logCounts(b.logs);
      const ok = confirm(
        `いまの記録（単語 ${now.kinfre}件・文法 ${now.deru1000}件）を、バックアップ（${formatDateTime(Date.parse(b.exportedAt))}・単語 ${next.kinfre}件・文法 ${next.deru1000}件）で置き換えます。よろしいですか？`,
      );
      if (!ok) return;
      await restoreBackup(b);
      await store.reload();
      setMsg(`バックアップから戻しました（回答 ${b.logs.length}件）。`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const stamp = () => localDay(Date.now()).replace(/-/g, "");
  const exportKinfreMiss = async () => {
    const md = missListMarkdown(store.items, store.cards, store.notes, store.logs, Date.now());
    await saveTextFile(`金フレ_ミス一覧_${stamp()}.md`, md, "text/markdown");
  };
  const exportDeruMiss = async () => {
    const md = deruMissListMarkdown(store.items, store.chapters, store.cards, store.notes, store.logs, Date.now());
    await saveTextFile(`出る1000_ミス一覧_${stamp()}.md`, md, "text/markdown");
  };
  const exportDeruMemo = async () => {
    const md = deruMemoMarkdown(store.items, store.cards, store.notes, store.logs, Date.now());
    await saveTextFile(`出る1000_学習メモ用_${stamp()}.md`, md, "text/markdown");
  };
  const exportOverlay = async (deck: "kinfre" | "deru1000") => {
    const name = deck === "deru1000" ? "entries_deru1000.jsonl" : "entries.jsonl";
    await saveTextFile(name, overlayJsonl(store.cards, store.notes, deck), "application/x-ndjson");
  };

  const words = store.items.filter((i) => i.deck === "kinfre");
  const main = words.filter((i) => i.deck === "kinfre" && i.part === "main").length;
  const grammar = store.items.filter((i) => i.deck === "deru1000").length;

  return (
    <div className="screen settings">
      <TopBar title="設定" />
      {msg && (
        <div className="card notice" role="status">
          <p>{msg}</p>
          {skipped.length > 0 && (
            <details>
              <summary>飛ばした項目 {skipped.length}件</summary>
              <ul className="small-list">
                {skipped.slice(0, 50).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <section className="card">
        <h2>記録の守り方</h2>
        <p>
          保存の保護：
          {persist === "persisted" ? (
            <b className="ok">オン（ブラウザが勝手に消さない設定）</b>
          ) : persist === "not-persisted" ? (
            <b className="ng">オフ（ホーム画面に追加すると、オンになりやすい）</b>
          ) : persist === "unsupported" ? (
            "この端末では確認できません"
          ) : (
            "確認中…"
          )}
        </p>
        <p>ホーム画面から起動：{isStandalone() ? <b className="ok">はい</b> : <b className="ng">いいえ（Safariのタブで開いています）</b>}</p>
        <p className="sub">
          回答は1問ごとに端末内へ保存されます（単語・文法とも同じ記録）。端末の故障や Safari のデータ削除に備えて、ときどきバックアップを iCloud Drive に保存してください（最後のバックアップ：
          {store.lastBackupAt ? formatDateTime(store.lastBackupAt) : "なし"}）。
        </p>
        <div className="btn-row">
          <button className="btn" onClick={() => exportBackup(store)}>
            バックアップを書き出す
          </button>
          <label className="btn ghost file">
            バックアップから戻す
            <input type="file" onChange={(e) => (restore(e.target.files), (e.target.value = ""))} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>教材データ</h2>
        <p>
          単語 {words.length}語（本編 {main}・Supplement {words.length - main}）／文法 {grammar}問
        </p>
        <p className="sub">
          Drive の <code>kinfre/chapters/</code>（単語）や <code>deru1000/chapters/</code>（文法）の .md ファイルをまとめて選びます。両方を一度に選んでもかまいません（iPhone は「ファイル」→ Google ドライブ）。読み込み直しても学習記録は消えません。
        </p>
        <label className="btn file">
          教材データを読み込む
          <input type="file" multiple onChange={(e) => (importItems(e.target.files), (e.target.value = ""))} />
        </label>
      </section>

      <section className="card">
        <h2>Drive の学習メモへ</h2>
        <p className="sub">ミス一覧.md は学習メモや NotebookLM に貼れる形です。「学習メモ用」は 出る1000_学習メモ の書き方（## 番号・status・wrong・mnemonic・note）そのままです。entries.jsonl は AI_OS の overlay と同じ形です。</p>
        <h3 className="sub-h">単語</h3>
        <div className="btn-row">
          <button className="btn ghost" onClick={exportKinfreMiss}>
            ミス一覧.md
          </button>
          <button className="btn ghost" onClick={() => exportOverlay("kinfre")}>
            entries.jsonl
          </button>
        </div>
        <h3 className="sub-h">文法</h3>
        <div className="btn-row">
          <button className="btn ghost" onClick={exportDeruMiss}>
            文法ミス一覧.md
          </button>
          <button className="btn ghost" onClick={exportDeruMemo}>
            学習メモ用.md
          </button>
          <button className="btn ghost" onClick={() => exportOverlay("deru1000")}>
            文法 entries.jsonl
          </button>
        </div>
      </section>

      <section className="card form">
        <h2>学習の設定（単語）</h2>
        <Choice label="1セットの問題数" value={s.setSize} options={[5, 10, 15, 20]} format={(n) => `${n}問`} onChange={(n) => update({ setSize: n })} />
        <Choice
          label="これより遅い正解は「難しい」扱い"
          value={s.hardMs}
          options={[2000, 3000, 4000, 5000, 7000]}
          format={(n) => `${n / 1000}秒`}
          onChange={(n) => update({ hardMs: n })}
        />
        <Choice
          label="今日の学習で出す新しい語（1日）"
          value={s.newPerDay}
          options={[0, 10, 20, 30, 50, 100]}
          format={(n) => `${n}語`}
          onChange={(n) => update({ newPerDay: n })}
        />
        <label className="check">
          <input type="checkbox" checked={s.includeSupplement} onChange={(e) => update({ includeSupplement: e.target.checked })} />
          今日の学習に Supplement も入れる
        </label>
      </section>

      <section className="card form">
        <h2>学習の設定（文法）</h2>
        <Choice
          label="1セットの問題数"
          value={s.deruSetSize}
          options={[5, 10, 15, 20, 30]}
          format={(n) => `${n}問`}
          onChange={(n) => update({ deruSetSize: n })}
        />
        <Choice
          label="これより遅い正解は「難しい」扱い"
          value={s.deruHardMs}
          options={[20000, 25000, 30000, 40000, 60000]}
          format={(n) => `${n / 1000}秒`}
          onChange={(n) => update({ deruHardMs: n })}
        />
        <Choice
          label="今日の学習で出す新しい問題（1日）"
          value={s.deruNewPerDay}
          options={[0, 10, 20, 30, 50]}
          format={(n) => `${n}問`}
          onChange={(n) => update({ deruNewPerDay: n })}
        />
      </section>

      <section className="card form">
        <h2>学習の設定（共通）</h2>
        <Choice
          label="今日の学習で、ミス・復習の割合"
          value={s.reviewRatio}
          options={[0.5, 0.6, 0.7, 0.8, 0.9]}
          format={(n) => `${Math.round(n * 100)}%`}
          onChange={(n) => update({ reviewRatio: n })}
        />
        <Choice
          label="目標の記憶率（高いほど復習が増える）"
          value={s.retention}
          options={[0.85, 0.9, 0.95]}
          format={(n) => `${Math.round(n * 100)}%`}
          onChange={(n) => update({ retention: n })}
        />
        <label>
          試験日
          <input type="date" value={s.examDate} onChange={(e) => e.target.value && update({ examDate: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoNext} onChange={(e) => update({ autoNext: e.target.checked })} />
          迷わず正解したら自動で次へ
        </label>
      </section>
      <p className="footer-note">TOEIC単語・文法トレーナー v0.2（個人用の非公式ツール）・教材データはこの端末の中だけにあります</p>
    </div>
  );
}

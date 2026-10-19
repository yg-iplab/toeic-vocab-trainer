// 設定（教材の読み込み・バックアップ・学習の設定）
import { useEffect, useState } from "react";
import {
  backupFileName,
  buildBackup,
  markBackedUp,
  missListMarkdown,
  overlayJsonl,
  parseBackup,
  restoreBackup,
  saveTextFile,
} from "../data/backup";
import { db, saveSettings, upsertItems } from "../data/db";
import { parseKinfreFile } from "../data/parseKinfre";
import { ensurePersisted, isStandalone, type PersistState } from "../data/persist";
import { formatDateTime, localDay } from "../lib/date";
import type { Item, Settings as SettingsT } from "../types";
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
    const skip: string[] = [];
    for (const f of Array.from(files)) {
      const r = parseKinfreFile(f.name, await f.text());
      all.push(...r.items);
      skip.push(...r.skipped.map((x) => `${f.name}: ${x}`));
    }
    if (all.length === 0) {
      setMsg("読み込める語がありませんでした。kinfre/chapters の .md ファイルを選んでください。");
      setSkipped(skip);
      return;
    }
    await upsertItems(all);
    await store.reload();
    const main = all.filter((i) => i.part === "main").length;
    setMsg(`${all.length}語を読み込みました（本編 ${main}・Supplement ${all.length - main}）。学習記録はそのままです。`);
    setSkipped(skip);
  };

  const restore = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const b = parseBackup(await f.text());
      const current = await db.logs.count();
      const ok = confirm(
        `いまの記録（回答 ${current}件）を、バックアップ（${formatDateTime(Date.parse(b.exportedAt))}・回答 ${b.logs.length}件）で置き換えます。よろしいですか？`,
      );
      if (!ok) return;
      await restoreBackup(b);
      await store.reload();
      setMsg(`バックアップから戻しました（回答 ${b.logs.length}件）。`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const exportMiss = async () => {
    const now = Date.now();
    const md = missListMarkdown(store.items, store.cards, store.notes, store.logs, now);
    await saveTextFile(`金フレ_ミス一覧_${localDay(now).replace(/-/g, "")}.md`, md, "text/markdown");
  };

  const exportOverlay = async () => {
    await saveTextFile("entries.jsonl", overlayJsonl(store.cards, store.notes), "application/x-ndjson");
  };

  const main = store.items.filter((i) => i.part === "main").length;

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
          回答は1問ごとに端末内へ保存されます。端末の故障や Safari のデータ削除に備えて、ときどきバックアップを iCloud Drive に保存してください（最後のバックアップ：
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
          いま {store.items.length}語（本編 {main}・Supplement {store.items.length - main}）
        </p>
        <p className="sub">
          Drive の <code>kinfre/chapters/</code> の .md ファイルをまとめて選びます（iPhone は「ファイル」→ Google ドライブ）。読み込み直しても学習記録は消えません。
        </p>
        <label className="btn file">
          教材データを読み込む
          <input type="file" multiple onChange={(e) => (importItems(e.target.files), (e.target.value = ""))} />
        </label>
      </section>

      <section className="card">
        <h2>Drive の学習メモへ</h2>
        <p className="sub">ミス一覧.md は「金フレ_学習メモ」や NotebookLM に貼れる形です。entries.jsonl は AI_OS の overlay と同じ形です。</p>
        <div className="btn-row">
          <button className="btn ghost" onClick={exportMiss}>
            ミス一覧.md
          </button>
          <button className="btn ghost" onClick={exportOverlay}>
            entries.jsonl
          </button>
        </div>
      </section>

      <section className="card form">
        <h2>学習の設定</h2>
        <label>
          1セットの問題数
          <select value={s.setSize} onChange={(e) => update({ setSize: Number(e.target.value) })}>
            {[5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n}問
              </option>
            ))}
          </select>
        </label>
        <label>
          これより遅い正解は「難しい」扱い
          <select value={s.hardMs} onChange={(e) => update({ hardMs: Number(e.target.value) })}>
            {[2000, 3000, 4000, 5000, 7000].map((n) => (
              <option key={n} value={n}>
                {n / 1000}秒
              </option>
            ))}
          </select>
        </label>
        <label>
          今日の学習で、ミス・復習の割合
          <select value={s.reviewRatio} onChange={(e) => update({ reviewRatio: Number(e.target.value) })}>
            {[0.5, 0.6, 0.7, 0.8, 0.9].map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)}%
              </option>
            ))}
          </select>
        </label>
        <label>
          今日の学習で出す新しい語（1日）
          <select value={s.newPerDay} onChange={(e) => update({ newPerDay: Number(e.target.value) })}>
            {[0, 10, 20, 30, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}語
              </option>
            ))}
          </select>
        </label>
        <label>
          目標の記憶率（高いほど復習が増える）
          <select value={s.retention} onChange={(e) => update({ retention: Number(e.target.value) })}>
            {[0.85, 0.9, 0.95].map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)}%
              </option>
            ))}
          </select>
        </label>
        <label>
          試験日
          <input type="date" value={s.examDate} onChange={(e) => e.target.value && update({ examDate: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoNext} onChange={(e) => update({ autoNext: e.target.checked })} />
          迷わず正解したら自動で次へ
        </label>
        <label className="check">
          <input type="checkbox" checked={s.includeSupplement} onChange={(e) => update({ includeSupplement: e.target.checked })} />
          今日の学習に Supplement も入れる
        </label>
      </section>
      <p className="footer-note">TOEIC単語トレーナー v0.1（MVP・個人用の非公式ツール）・教材データはこの端末の中だけにあります</p>
    </div>
  );
}

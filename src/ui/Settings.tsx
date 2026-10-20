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
import { audioSummary, deleteAudio, formatBytes, importAudioFiles, type AudioSummary } from "../data/audio";
import { db, saveSettings, upsertItems, upsertTips } from "../data/db";
import { mergeChapters } from "../data/parseDeru";
import { parseMaterialFile } from "../data/parseFile";
import { ensurePersisted, isStandalone, type PersistState } from "../data/persist";
import { formatDateTime, localDay } from "../lib/date";
import { DEFAULT_BACKUP_PLACE, type ChapterInfo, type Item, type Settings as SettingsT, type TipsDoc } from "../types";
import { BackupPlaceHint, TopBar } from "./components";
import type { Store } from "./store";

/** バックアップを書き出す。戻り値は書き出したファイル名（キャンセルなら null） */
export async function exportBackup(store: Store): Promise<string | null> {
  const now = Date.now();
  const name = backupFileName(now);
  const text = JSON.stringify(await buildBackup(now));
  const ok = await saveTextFile(name, text, "application/json");
  if (!ok) return null;
  await markBackedUp(now);
  await store.reload();
  return name;
}

/** 書き出したあとの案内（どこに保存したはずか） */
export function backupDoneMessage(name: string, place: string): string {
  return `バックアップ（${name}）を書き出しました。保存先「${place}」に入っているか、「ファイル」アプリで確かめてください。`;
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
  const [placeDraft, setPlaceDraft] = useState(s.backupPlace);
  const [audioSum, setAudioSum] = useState<AudioSummary | null>(null);
  const [audioBusy, setAudioBusy] = useState<string | null>(null);

  useEffect(() => {
    void ensurePersisted().then(setPersist);
  }, []);

  useEffect(() => setPlaceDraft(s.backupPlace), [s.backupPlace]);

  useEffect(() => {
    void audioSummary().then(setAudioSum);
  }, [store.audioKeys]);

  const update = async (patch: Partial<SettingsT>) => {
    await saveSettings({ ...s, ...patch });
    await store.reload();
  };

  const importItems = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const all: Item[] = [];
    let chapters: ChapterInfo[] = [];
    const tips = new Map<string, TipsDoc>();
    const skip: string[] = [];
    const now = Date.now();
    for (const f of Array.from(files)) {
      const r = parseMaterialFile(f.name, await f.text(), now);
      all.push(...r.items);
      if (r.chapters) chapters = mergeChapters(chapters, r.chapters);
      for (const t of r.tips ?? []) tips.set(t.key, t);
      skip.push(...r.skipped.map((x) => `${f.name}: ${x}`));
      if (r.items.length === 0 && !r.tips?.length && r.skipped.length === 0) skip.push(`${f.name}: 教材のファイルではないので飛ばしました`);
    }
    if (all.length === 0 && tips.size === 0) {
      setMsg("読み込める問題がありませんでした。kinfre/chapters・deru1000/chapters・deru1000/tips の .md ファイルを選んでください。");
      setSkipped(skip);
      return;
    }
    if (all.length) await upsertItems(all, chapters);
    if (tips.size) await upsertTips([...tips.values()]);
    await store.reload();
    const words = all.filter((i) => i.deck === "kinfre");
    const grammar = all.filter((i) => i.deck === "deru1000");
    const parts: string[] = [];
    if (words.length) {
      const main = words.filter((i) => i.deck === "kinfre" && i.part === "main").length;
      parts.push(`${words.length}語を読み込みました（本編 ${main}・Supplement ${words.length - main}）。`);
    }
    if (grammar.length) parts.push(`文法 ${grammar.length}問を読み込みました（章・模試セット ${chapters.length}）。`);
    if (tips.size) {
      const list = [...tips.values()].sort((a, b) => a.order - b.order).map((t) => (t.key === "intro" ? "巻頭" : `第${t.order}章`));
      parts.push(`解き方 ${tips.size}本を読み込みました（${list.join("・")}）。`);
    }
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

  const importAudio = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // 単語は、端末にある本編の語の track だけ入れる（使わない track で容量を使わない）
    const wantTracks = new Set(store.items.flatMap((i) => (i.deck === "kinfre" && i.part === "main" && i.track !== undefined ? [i.track] : [])));
    setAudioBusy("読み込み中…");
    try {
      const r = await importAudioFiles(Array.from(files), {
        wantTracks,
        now: Date.now(),
        onProgress: (done, total) => setAudioBusy(`読み込み中… ${done} / ${total}`),
      });
      await store.reload();
      const parts: string[] = [];
      if (r.added.kinfre) parts.push(`単語の音声 ${r.added.kinfre}本`);
      if (r.added.deru1000) parts.push(`文法の音声 ${r.added.deru1000}問`);
      if (r.bytes) parts.push(`（${formatBytes(r.bytes)}）`);
      if (r.segs) parts.push(`時間の表 ${r.segs}語`);
      const sum = await audioSummary();
      const needIndex = sum.kinfre.files > 0 && sum.segs === 0 ? "単語は、時間の表（kinfre_audio_index.json）も選ぶと鳴らせます。" : "";
      setMsg(parts.length ? `${parts.join("・")}を読み込みました。${needIndex}` : "読み込める音声がありませんでした。");
      setSkipped(r.skipped);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setAudioBusy(null);
    }
  };

  const removeAudio = async (deck: "kinfre" | "deru1000") => {
    if (!confirm(`${deck === "kinfre" ? "単語" : "文法"}の公式音声をこの端末から消します（学習記録は消えません）。よろしいですか？`)) return;
    await deleteAudio(deck);
    await store.reload();
    setMsg(`${deck === "kinfre" ? "単語" : "文法"}の公式音声を消しました。`);
  };

  const backup = async () => {
    const name = await exportBackup(store);
    if (name) {
      setMsg(backupDoneMessage(name, s.backupPlace));
      setSkipped([]);
    }
  };

  const savePlace = () => {
    const place = placeDraft.trim() || DEFAULT_BACKUP_PLACE;
    setPlaceDraft(place);
    if (place !== s.backupPlace) void update({ backupPlace: place });
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
  const tipsCount = store.tips.size;

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
          回答は1問ごとに端末内へ保存されます（単語・文法とも同じ記録）。端末の故障や Safari のデータ削除に備えて、ときどきバックアップを下の保存先に書き出してください（最後のバックアップ：
          {store.lastBackupAt ? formatDateTime(store.lastBackupAt) : "なし"}）。
        </p>
        <BackupPlaceHint place={s.backupPlace} />
        <div className="btn-row">
          <button className="btn" onClick={backup}>
            バックアップを書き出す
          </button>
          <label className="btn ghost file">
            バックアップから戻す
            <input type="file" onChange={(e) => (restore(e.target.files), (e.target.value = ""))} />
          </label>
        </div>
        <p className="sub">戻すときは、保存先のいちばん新しいファイル（名前の日付・時刻が最後のもの）を選びます。</p>
        <div className="form">
          <label>
            バックアップの保存先（書き出すたびに案内する場所。変えたときだけ書き直す）
            <input type="text" value={placeDraft} onChange={(e) => setPlaceDraft(e.target.value)} onBlur={savePlace} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>教材データ</h2>
        <p>
          単語 {words.length}語（本編 {main}・Supplement {words.length - main}）／文法 {grammar}問／解き方 {tipsCount}本
        </p>
        <p className="sub">
          Drive の <code>kinfre/chapters/</code>（単語）、<code>deru1000/chapters/</code>（文法）、<code>deru1000/tips/</code>（文法の解き方 00〜07）の .md ファイルをまとめて選びます。一度に選んでもかまいません（iPhone は「ファイル」→ Google ドライブ）。読み込み直しても学習記録は消えません。
        </p>
        <label className="btn file">
          教材データを読み込む
          <input type="file" multiple onChange={(e) => (importItems(e.target.files), (e.target.value = ""))} />
        </label>
      </section>

      <section className="card">
        <h2>公式音声</h2>
        <p>
          {audioSum
            ? `単語 ${audioSum.kinfre.files}本（${formatBytes(audioSum.kinfre.bytes)}・時間の表 ${audioSum.segs}語）／文法 ${audioSum.deru1000.files}問（${formatBytes(audioSum.deru1000.bytes)}）`
            : "確認中…"}
        </p>
        <p className="sub">
          Drive の <code>試験勉強資料/TOEIC/audio/</code> の ZIP（単語は「英語のみ」）と、時間の表 <code>kinfre_audio_index.json</code> をまとめて選びます。ZIP は解凍しなくてよい。音声はこの端末の中だけに置き、バックアップには入れません。音声がある語・問題は 🔊 が「（公式）」、無ければ端末の読み上げ「（合成）」で鳴ります。
        </p>
        <label className={`btn file ${audioBusy ? "disabled" : ""}`}>
          {audioBusy ?? "音声を読み込む"}
          <input type="file" multiple disabled={!!audioBusy} onChange={(e) => (importAudio(e.target.files), (e.target.value = ""))} />
        </label>
        {audioSum && (audioSum.kinfre.files > 0 || audioSum.deru1000.files > 0) && (
          <div className="btn-row">
            {audioSum.kinfre.files > 0 && (
              <button className="btn ghost" onClick={() => removeAudio("kinfre")}>
                単語の音声を消す
              </button>
            )}
            {audioSum.deru1000.files > 0 && (
              <button className="btn ghost" onClick={() => removeAudio("deru1000")}>
                文法の音声を消す
              </button>
            )}
          </div>
        )}
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
          <input type="checkbox" checked={s.kinfreAlwaysExplain} onChange={(e) => update({ kinfreAlwaysExplain: e.target.checked })} />
          4択の回答後、訳・例文・右欄の補足をいつも見る（迷わず正解でも。自動で次へは進まない）
        </label>
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
        <label className="check">
          <input type="checkbox" checked={s.deruAlwaysExplain} onChange={(e) => update({ deruAlwaysExplain: e.target.checked })} />
          回答後、解説と全訳をいつも開く（迷わず正解でも。自動で次へは進まない）
        </label>
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
          迷わず正解したら自動で次へ（単語・文法の「いつも見る／いつも開く」を切ったとき）
        </label>
        <Choice
          label="発音ボタンの読み上げの速さ"
          value={s.speechRate}
          options={[0.7, 0.8, 0.9, 1]}
          format={(n) => (n === 1 ? "ふつう" : `${Math.round(n * 100)}%`)}
          onChange={(n) => update({ speechRate: n })}
        />
        <p className="sub">🔊 のボタンは、公式音声を読み込んだ語・問題では公式音声（「公式」）、それ以外は端末の読み上げ機能（「合成」）で鳴ります。速さはどちらにも効きます。iPhone で鳴らないときは、マナーモード（消音）を切ってください。</p>
      </section>
      <p className="footer-note">TOEIC単語・文法トレーナー v0.7（個人用の非公式ツール）・教材データはこの端末の中だけにあります</p>
    </div>
  );
}

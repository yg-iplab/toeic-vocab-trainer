// 画面どうしで使い回す部品
import { useEffect, useState, type ReactNode } from "react";
import type { ClipRef, ItemClips } from "../data/audio";
import { db } from "../data/db";
import { noLabel } from "../data/stats";
import { tipsButtonLabel, type TipsRef } from "../data/tips";
import { exampleMissesWord, exampleText, vocabFromExplanation } from "../lib/itemText";
import { clipUrl, playClip, readyUrl } from "../lib/audioPlayer";
import { canSpeak, filledSentence, speak } from "../lib/speech";
import { LETTERS, type CardState, type ChapterInfo, type DeruItem, type Item, type KinfreItem, type Status, type UserNote } from "../types";

export const STATUS_LABEL: Record<Status, string> = {
  new: "未学習",
  learning: "学習中",
  known: "覚えた",
  missed: "ミス",
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          ‹ 戻る
        </button>
      ) : (
        <span />
      )}
      <h1>{title}</h1>
      <span className="topbar-right">{right}</span>
    </header>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function WordHead({ item }: { item: KinfreItem }) {
  return (
    <div className="word-head">
      <div className="word-meta">
        <span className="no">{noLabel(item)}</span>
        {item.pos.map((p) => (
          <span key={p} className="pos">
            {p}
          </span>
        ))}
      </div>
      <div className="word" lang="en">
        {item.word}
      </div>
    </div>
  );
}

const loadAudio = async (key: string) => (await db.audio.get(key))?.blob;

/** 公式音声の URL を、画面を出したときに用意しておく（押した直後に鳴らせるように） */
function useClipUrl(key?: string): string | undefined {
  const [url, setUrl] = useState(() => (key ? readyUrl(key) : undefined));
  useEffect(() => {
    if (!key) {
      setUrl(undefined);
      return;
    }
    let alive = true;
    void clipUrl(key, loadAudio).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}

function stopSynth() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/**
 * 発音を聞くボタン。公式音声が端末にあればそれを（「公式」）、無ければ端末の読み上げ機能（「合成」）で鳴らす
 * どちらも無い端末では出さない
 */
export function SpeakButton({ text, label, rate, clip }: { text: string; label: string; rate?: number; clip?: ClipRef }) {
  const url = useClipUrl(clip?.key);
  if (clip) {
    const play = async () => {
      const u = url ?? (await clipUrl(clip.key, loadAudio));
      if (u) playClip(u, clip.range, rate ?? 1, stopSynth);
      else speak(text, rate);
    };
    return (
      <button type="button" className="speak-btn official" onClick={play}>
        🔊 {label}
        <small>（公式）</small>
      </button>
    );
  }
  if (!canSpeak() || !text.trim()) return null;
  return (
    <button type="button" className="speak-btn" onClick={() => speak(text, rate)}>
      🔊 {label}
      <small>（合成）</small>
    </button>
  );
}

/** バックアップの保存先の案内。アプリは保存先を選べない（共有の画面で選ぶ）ので、書き出すボタンのそばに毎回出す */
export function BackupPlaceHint({ place }: { place: string }) {
  return (
    <div className="backup-place">
      <p>
        保存先：<b>{place}</b>
      </p>
      <p className="sub">
        書き出すと共有の画面が開きます →「"ファイル"に保存」→ この場所を開いて「保存」。Mac でダウンロードされたときは、ファイルをこの場所へ移してください。
      </p>
    </div>
  );
}

/** 教材の訳・例文・補足と、自分のメモ */
export function ItemInfo({
  item,
  note,
  card,
  speechRate,
  clips = {},
}: {
  item: KinfreItem;
  note?: UserNote;
  card?: CardState;
  speechRate?: number;
  clips?: ItemClips;
}) {
  const example = exampleText(item);
  return (
    <div className="item-info">
      <p className="ja">{item.ja}</p>
      <div className="speak-row">
        <SpeakButton text={item.word} label="単語" rate={speechRate} clip={clips.word} />
        {(example || clips.example) && <SpeakButton text={example ?? ""} label="例文" rate={speechRate} clip={clips.example} />}
      </div>
      {(example || item.example_ja) && (
        <div className="example">
          {example && (
            <p lang="en" className="example-en">
              {example}
            </p>
          )}
          {example && exampleMissesWord(item) && (
            <p className="example-warn">
              ⚠ この例文は見出し語が読み取れていません（教材データの読み取り漏れ）{clips.example ? "。🔊 例文（公式）で全文を聞けます" : ""}
            </p>
          )}
          {example && item.example_fixed && <p className="example-warn">🎧 抜けていた語を公式音声の聞き取りで補った例文です</p>}
          {item.example_ja && <p className="example-ja">{item.example_ja}</p>}
        </div>
      )}
      {item.notes_right && (
        <details className="notes" open>
          <summary>右欄の補足（教材）</summary>
          <p>{item.notes_right}</p>
        </details>
      )}
      {item.mnemonic_src && (
        <p className="memo">
          <b>覚え方（DB）</b> {item.mnemonic_src}
        </p>
      )}
      {note?.mnemonic && (
        <p className="memo mine">
          <b>自分の覚え方</b> {note.mnemonic}
        </p>
      )}
      {note?.wrong_note && (
        <p className="memo mine">
          <b>前のミス</b> {note.wrong_note}
        </p>
      )}
      {card && card.miss_count > 0 && <p className="miss-count">これまでのミス：{card.miss_count}回</p>}
    </div>
  );
}

/** 一覧の1行の中身（単語は 語＋訳、文法は 分野＋問題文） */
export function RowText({ item }: { item: Item }) {
  if (item.deck === "deru1000") {
    return (
      <>
        <span className="w">{item.section}</span>
        <span className="j" lang="en">
          {item.stem}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="w" lang="en">
        {item.word}
      </span>
      <span className="j">{item.ja}</span>
    </>
  );
}

/** 問題文。空所（-------）を下線の枠で見せる */
export function Stem({ text }: { text: string }) {
  const parts = text.split(/-{3,}/);
  return (
    <p className="stem" lang="en">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <span className="blank" aria-label="空所">
              {"\u3000".repeat(4)}
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

/** 文法の問題の上の部分（番号・分野・範囲・問題文） */
export function Part5Head({ item, chapter }: { item: DeruItem; chapter?: ChapterInfo }) {
  return (
    <div className="p5-head">
      <div className="word-meta">
        <span className="no">{String(item.no).padStart(4, "0")}</span>
        {item.section && <span className="pos">{item.section}</span>}
        {item.quality && item.quality !== "ok" && <span className="pos warn-tag">要確認</span>}
      </div>
      <p className="p5-range">
        {chapter?.label ?? item.chapter}・{item.block}
      </p>
      <Stem text={item.stem} />
    </div>
  );
}

/** 選択肢を (A) … の形で */
export function choiceLabel(item: DeruItem, i: number): string {
  return `(${LETTERS[i]}) ${item.choices[i] ?? ""}`;
}

/** 語彙。本の語注（注）があればそれを、無ければ解説に出てくる「英語（訳）」を拾って見せる */
export function Part5Vocab({ item }: { item: DeruItem }) {
  if (item.vocab) {
    return (
      <details className="notes" open>
        <summary>語彙</summary>
        <p className="pre">{item.vocab}</p>
      </details>
    );
  }
  const pairs = vocabFromExplanation(item.explanation);
  if (pairs.length === 0) return <p className="sub vocab-none">語彙：この問題には本の語注（注）がありません</p>;
  return (
    <details className="notes" open>
      <summary>語彙（解説に出てくる語句）</summary>
      <p className="sub">この問題には本の語注（注）がありません。解説の中の「英語（訳）」を拾っています。</p>
      <ul className="vocab-list">
        {pairs.map((p) => (
          <li key={p.en}>
            <span lang="en">{p.en}</span>：{p.ja}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 回答後に見せる中身（解説・全訳・語彙・章の解き方）。解説は × とあやふやのとき開いておく */
export function Part5Info({
  item,
  chapter,
  openExplanation,
  note,
  card,
  tips,
  onOpenTips,
  speechRate,
  clips = {},
}: {
  item: DeruItem;
  chapter?: ChapterInfo;
  openExplanation: boolean;
  note?: UserNote;
  card?: CardState;
  tips?: TipsRef; // 解き方の全文（読み込んであれば）
  onOpenTips?: () => void;
  speechRate?: number;
  clips?: ItemClips;
}) {
  const answerText = item.choices[LETTERS.indexOf(item.answer)] ?? "";
  return (
    <div className="item-info p5-info">
      <p className="p5-answer">
        正解 <b lang="en">{choiceLabel(item, LETTERS.indexOf(item.answer))}</b>
      </p>
      <div className="speak-row">
        <SpeakButton text={filledSentence(item.stem, answerText)} label="正解の文を聞く" rate={speechRate} clip={clips.sentence} />
        <SpeakButton text={answerText} label="正解の語句" rate={speechRate} />
      </div>
      {item.explanation && (
        <details className="notes" open={openExplanation}>
          <summary>解説</summary>
          <p className="pre">{item.explanation}</p>
        </details>
      )}
      {item.translation && (
        <details className="notes" open={openExplanation}>
          <summary>全訳</summary>
          <p className="pre">{item.translation}</p>
        </details>
      )}
      <Part5Vocab item={item} />
      {tips && onOpenTips && (
        <button className="btn ghost tips-btn" onClick={onOpenTips}>
          📖 {tipsButtonLabel(tips)}
        </button>
      )}
      {chapter && chapter.tips.length > 0 && (
        <details className="notes">
          <summary>{tips ? "章ファイル冒頭の要点" : "この章の解き方"}</summary>
          <dl className="tips">
            {chapter.tips.map((t) => (
              <div key={t.k}>
                <dt>{t.k}</dt>
                <dd>{t.v}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {note?.mnemonic && (
        <p className="memo mine">
          <b>自分の覚え方</b> {note.mnemonic}
        </p>
      )}
      {note?.wrong_note && (
        <p className="memo mine">
          <b>前のミス</b> {note.wrong_note}
        </p>
      )}
      {card && card.miss_count > 0 && <p className="miss-count">これまでのミス：{card.miss_count}回</p>}
    </div>
  );
}

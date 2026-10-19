// 画面どうしで使い回す部品
import type { ReactNode } from "react";
import { noLabel } from "../data/stats";
import type { CardState, Item, Status, UserNote } from "../types";

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

export function WordHead({ item }: { item: Item }) {
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

/** 教材の訳・例文・補足と、自分のメモ */
export function ItemInfo({ item, note, card }: { item: Item; note?: UserNote; card?: CardState }) {
  const example = item.example_en_blank || item.example_en;
  return (
    <div className="item-info">
      <p className="ja">{item.ja}</p>
      {(example || item.example_ja) && (
        <div className="example">
          {example && (
            <p lang="en" className="example-en">
              {example}
            </p>
          )}
          {item.example_ja && <p className="example-ja">{item.example_ja}</p>}
        </div>
      )}
      {item.notes_right && (
        <details className="notes">
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

// 文法の解き方（tips/*.md）を読む画面。全画面のシートで開き、閉じると元の画面に戻る
import { useEffect, useMemo, useState } from "react";
import { sortedTips, tipsView, type TipsRef } from "../data/tips";
import type { TipsDoc } from "../types";
import { TopBar } from "./components";
import { Markdown } from "./Markdown";
import type { Store } from "./store";

export function TipsSheet({ doc, note, onClose }: { doc: TipsDoc; note?: string; onClose: () => void }) {
  const view = useMemo(() => tipsView(doc), [doc]);

  // 開いている間は後ろの画面を動かさない。Esc（Mac）でも閉じる
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={doc.title}>
      <header className="sheet-top">
        <h2>{doc.title}</h2>
        <button className="icon-btn" onClick={onClose}>
          ✕ 閉じる
        </button>
      </header>
      <div className="sheet-body">
        {note && <p className="sub">{note}</p>}
        {view.preface.length > 0 && (
          <details className="notes">
            <summary>このファイルについて</summary>
            <Markdown blocks={view.preface} />
          </details>
        )}
        <Markdown blocks={view.body} />
        <button className="btn ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

/** 問題に合わせた解き方のシート（模試の問題なら、どの章の解き方かを添える） */
export function TipsSheetFor({ tipsRef, onClose }: { tipsRef: TipsRef; onClose: () => void }) {
  return (
    <TipsSheet
      doc={tipsRef.doc}
      note={tipsRef.viaSection ? `この問題と同じ分野の問題がいちばん多い第${tipsRef.doc.order}章の解き方です。` : undefined}
      onClose={onClose}
    />
  );
}

/** 解き方の一覧（ホームの「解き方を読む」から） */
export function TipsList({ store, onBack }: { store: Store; onBack: () => void }) {
  const docs = sortedTips(store.tips);
  const [open, setOpen] = useState<TipsDoc | null>(null);
  return (
    <div className="screen">
      <TopBar title="解き方" onBack={onBack} />
      {docs.length === 0 ? (
        <p className="empty">解き方はまだ読み込まれていません。設定 →「教材データを読み込む」で deru1000/tips/ の .md を選んでください。</p>
      ) : (
        <ul className="list">
          {docs.map((d) => (
            <li key={d.key}>
              <button className="row" onClick={() => setOpen(d)}>
                <span className="no">{d.key === "intro" ? "巻頭" : `第${d.order}章`}</span>
                <span className="j">{d.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <TipsSheet doc={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

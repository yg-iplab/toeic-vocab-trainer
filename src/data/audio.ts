// 公式音声の取り込み（ZIP・MP3・時間の表 JSON）。音声は端末の DB に入れるだけで、バックアップには入れない
// 単語：track ごとの1本（…en01.mp3 など）＋ Mac で作った時間の表（kinfre_audio_index.json）で「何秒〜何秒がどの語か」
// 文法：1問1本（…_0001.mp3 など）。ファイル名の番号がそのまま問題の番号
import { baseName, listZip, readZipEntry } from "../lib/zip";
import type { AudioRow, AudioSeg, Deck, Item } from "../types";
import { db } from "./db";

export type AudioTarget = { deck: Deck; key: string; track?: number };

const AUDIO_EXT = /\.(mp3|m4a|wav)$/i;

/** ファイル名から、どの音声か見分ける（見分けられなければ null） */
export function classifyAudio(name: string): AudioTarget | null {
  const base = baseName(name);
  if (!AUDIO_EXT.test(base)) return null;
  const en = /(?:^|[_-])en(\d{2})\.\w+$/i.exec(base);
  if (en) return { deck: "kinfre", key: `kinfre-en-${en[1]}`, track: Number(en[1]) };
  const q = /(?:^|[_-])(\d{4})\.\w+$/.exec(base);
  if (q) return { deck: "deru1000", key: `deru1000-${q[1]}` };
  return null;
}

function mimeOf(name: string): string {
  if (/\.m4a$/i.test(name)) return "audio/mp4";
  if (/\.wav$/i.test(name)) return "audio/wav";
  return "audio/mpeg";
}

type IndexItem = { id?: unknown; track?: unknown; file?: unknown; word?: unknown; example?: unknown };

function range(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const [s, e] = v.map(Number);
  return Number.isFinite(s) && Number.isFinite(e) && e > s && s >= 0 ? [s, e] : undefined;
}

/**
 * 時間の表（kinfre_audio_index.json）を読む。秒の数字と番号だけ
 * file は音声ファイルの番号（「…en18.mp3」なら "18"）。本の track とファイルの番号がずれる所があるので、表が決める
 */
export function parseAudioIndex(text: string): AudioSeg[] {
  let data: { kind?: unknown; items?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("時間の表（JSON）として読めません。");
  }
  if (data.kind !== "audio-index" || !Array.isArray(data.items)) throw new Error("このアプリの時間の表ではありません。");
  const segs: AudioSeg[] = [];
  for (const it of data.items as IndexItem[]) {
    const id = typeof it.id === "string" ? it.id : "";
    const track = Number(it.track);
    if (!/^kinfre-/.test(id) || !Number.isInteger(track) || track < 1) continue;
    const word = range(it.word);
    const example = range(it.example);
    if (!word && !example) continue;
    const file = typeof it.file === "string" && /^\d{2}$/.test(it.file) ? it.file : String(track).padStart(2, "0");
    segs.push({ id, key: `kinfre-en-${file}`, word, example });
  }
  return segs;
}

export type AudioImportResult = { added: { kinfre: number; deru1000: number }; bytes: number; segs: number; skipped: string[] };

type Task = { name: string; target: AudioTarget; read: () => Promise<Blob> };

/**
 * 選んだファイル（ZIP・音声・時間の表）を取り込む。1本ずつ読んで DB に入れる（全部をメモリに載せない）
 * 単語の音声は、時間の表（今回選んだもの・前に入れたもの）が使うファイルだけを入れる。
 * 時間の表がまだ無いときは、端末にある語の track（wantTracks）の音声だけを入れる（Supplement などは入れない）
 */
export async function importAudioFiles(
  files: File[],
  opts: { wantTracks?: Set<number>; now: number; onProgress?: (done: number, total: number) => void },
): Promise<AudioImportResult> {
  const result: AudioImportResult = { added: { kinfre: 0, deru1000: 0 }, bytes: 0, segs: 0, skipped: [] };
  const tasks: Task[] = [];
  // 時間の表を先に読む（どの音声ファイルを使うかが決まる）
  for (const f of files.filter((f) => /\.json$/i.test(f.name))) {
    const text = await f.text();
    // フォルダの中を全部選んでも止まらないように、時間の表でない JSON（例文の補完の記録など）は飛ばす
    let kind: unknown;
    try {
      kind = (JSON.parse(text) as { kind?: unknown }).kind;
    } catch {
      kind = undefined;
    }
    if (kind !== "audio-index") {
      result.skipped.push(`${f.name}: 時間の表ではないので使いません`);
      continue;
    }
    const segs = parseAudioIndex(text);
    await db.audioSegs.bulkPut(segs);
    result.segs += segs.length;
  }
  const used = new Set((await db.audioSegs.toArray()).map((s) => s.key));

  const accept = (name: string, target: AudioTarget | null): boolean => {
    if (!target) {
      result.skipped.push(`${name}: このアプリで使う音声ではないので入れません`);
      return false;
    }
    if (target.deck === "kinfre" && used.size && !used.has(target.key)) {
      result.skipped.push(`${name}: 時間の表で使わない音声（Supplement など）なので入れません`);
      return false;
    }
    if (target.deck === "kinfre" && !used.size && opts.wantTracks?.size && !opts.wantTracks.has(target.track ?? -1)) {
      result.skipped.push(`${name}: 端末に無い track（Supplement など）なので入れません`);
      return false;
    }
    return true;
  };

  for (const f of files) {
    if (/\.json$/i.test(f.name)) continue;
    if (/\.zip$/i.test(f.name)) {
      for (const e of await listZip(f)) {
        if (e.name.endsWith("/") || baseName(e.name).startsWith(".")) continue;
        const target = classifyAudio(e.name);
        if (accept(baseName(e.name), target)) tasks.push({ name: baseName(e.name), target: target!, read: () => readZipEntry(f, e, mimeOf(e.name)) });
      }
      continue;
    }
    const target = classifyAudio(f.name);
    if (accept(f.name, target)) tasks.push({ name: f.name, target: target!, read: async () => f });
  }

  let done = 0;
  opts.onProgress?.(done, tasks.length);
  for (const t of tasks) {
    // Safari（WebKit）は Blob を IndexedDB に入れられないことがある（プライベートでは必ず
    // 「Error preparing Blob/File data to be stored in object store」）。バイト列（ArrayBuffer）にして入れる
    const raw = await t.read();
    const data = await raw.arrayBuffer();
    const row: AudioRow = { key: t.target.key, deck: t.target.deck, track: t.target.track, data, type: raw.type || mimeOf(t.name), size: data.byteLength, name: t.name, importedAt: opts.now };
    await db.audio.put(row);
    result.added[t.target.deck]++;
    result.bytes += data.byteLength;
    opts.onProgress?.(++done, tasks.length);
  }
  return result;
}

/** 端末に入れた音声を、鳴らせる Blob にして返す（v0.6 までの Blob の行もそのまま使う） */
export async function loadAudioBlob(key: string): Promise<Blob | undefined> {
  const row = await db.audio.get(key);
  if (!row) return undefined;
  if (row.data) return new Blob([row.data], { type: row.type || "audio/mpeg" });
  return row.blob;
}

/** 教材ごとに音声を消す（単語は時間の表も） */
export async function deleteAudio(deck: Deck) {
  await db.audio.where("deck").equals(deck).delete();
  if (deck === "kinfre") await db.audioSegs.clear();
}

export type AudioSummary = Record<Deck, { files: number; bytes: number }> & { segs: number };

/** 端末に入っている音声の本数と容量 */
export async function audioSummary(): Promise<AudioSummary> {
  const out: AudioSummary = { kinfre: { files: 0, bytes: 0 }, deru1000: { files: 0, bytes: 0 }, segs: await db.audioSegs.count() };
  await db.audio.each((r) => {
    out[r.deck].files++;
    out[r.deck].bytes += r.size;
  });
  return out;
}

/** 鳴らす音声の場所（どの1本の、何秒〜何秒か。range が無ければ1本まるごと） */
export type ClipRef = { key: string; range?: [number, number] };

export type ItemClips = { word?: ClipRef; example?: ClipRef; sentence?: ClipRef };

/** この語・問題に使える公式音声 */
export function clipsFor(item: Item, audioKeys: Set<string>, segs: Map<string, AudioSeg>): ItemClips {
  if (item.deck === "deru1000") return audioKeys.has(item.id) ? { sentence: { key: item.id } } : {};
  const seg = segs.get(item.id);
  if (!seg || !audioKeys.has(seg.key)) return {};
  return {
    word: seg.word && { key: seg.key, range: seg.word },
    example: seg.example && { key: seg.key, range: seg.example },
  };
}

/** バイト数を「12.3MB」の形で */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

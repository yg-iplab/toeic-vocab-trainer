// ZIP を端末の中で開く（外部のライブラリなし）。中央ディレクトリ（目次）を読み、1ファイルずつ取り出す
// ファイル全体をメモリに載せない：File.slice で必要な所だけ読み、圧縮はブラウザの DecompressionStream で戻す

export type ZipEntry = {
  name: string;
  method: number; // 0＝圧縮なし、8＝deflate
  compSize: number;
  size: number;
  offset: number; // ローカルヘッダの位置
};

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** ZIP の目次（ファイル名・大きさ・位置）を読む。ZIP でなければ例外 */
export async function listZip(file: Blob): Promise<ZipEntry[]> {
  // 末尾の「目次の終わり」レコードを探す（後ろにコメントが付くことがあるので最大 64KB さかのぼる）
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await bytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP ファイルとして読めません。");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error("大きすぎる ZIP（ZIP64）には対応していません。");

  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== SIG_CD) throw new Error("ZIP の目次が壊れています。");
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const offset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    entries.push({ name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** ZIP の中の1ファイルを取り出す */
export async function readZipEntry(file: Blob, e: ZipEntry, type = ""): Promise<Blob> {
  const local = await bytes(file, e.offset, e.offset + 30);
  if (local.getUint32(0, true) !== SIG_LOCAL) throw new Error(`ZIP の中の ${e.name} が読めません。`);
  const start = e.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const data = file.slice(start, start + e.compSize);
  if (e.method === 0) return new Blob([data], { type });
  if (e.method !== 8) throw new Error(`ZIP の中の ${e.name} は対応していない圧縮方式です。`);
  const inflated = await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
  if (inflated.size !== e.size) throw new Error(`ZIP の中の ${e.name} を最後まで取り出せませんでした。`);
  return new Blob([inflated], { type });
}

/** ファイル名の最後の部分（フォルダを外す） */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

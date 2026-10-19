// 文法の分野（section）をそろえる
// 章ファイルと模試セットで書き方が違う（末尾の「問題」「の問題」の有無、略した書き方）ので、
// 末尾を外したうえで、頭の部分が一致すれば同じ分野とみなす。「A or B」の形は前後それぞれで比べる

/** 比べるための形（空白と末尾の「問題」を外す） */
export function sectionTag(section: string): string {
  return section.replace(/\s+/g, "").replace(/(の)?問題$/, "");
}

/** sectionTag どうしが同じ分野か */
export function sameSectionTag(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = a.split(/or/i);
  const pb = b.split(/or/i);
  if (pa.length !== pb.length || pa.some((x) => !x) || pb.some((x) => !x)) return false;
  return pa.every((x, k) => x.startsWith(pb[k]) || pb[k].startsWith(x));
}

export function sameSection(a: string, b: string): boolean {
  return sameSectionTag(sectionTag(a), sectionTag(b));
}

// 周回（1周目・2周目…）の作成
import type { Rng } from "../lib/random";
import { roundItemIds, type RoundScope } from "../srs/session";
import type { Item, Round } from "../types";
import { db } from "./db";

export async function activeRound(): Promise<Round | undefined> {
  const all = await db.rounds.toArray();
  return all.filter((r) => r.finishedAt === undefined).sort((a, b) => (b.rid ?? 0) - (a.rid ?? 0))[0];
}

/** 次の「何周目」。ミスだけの周回は数えない */
export async function nextRoundNo(): Promise<number> {
  const all = await db.rounds.toArray();
  return all.filter((r) => r.parentRid === undefined).reduce((m, r) => Math.max(m, r.no), 0) + 1;
}

export async function startRound(
  items: Item[],
  scope: RoundScope,
  scopeLabel: string,
  order: Round["order"],
  rng: Rng,
  now: number,
): Promise<Round> {
  const no = await nextRoundNo();
  const round: Round = {
    no,
    label: `${no}周目：${scopeLabel}`,
    itemIds: roundItemIds(items, scope, order, rng),
    cursor: 0,
    order,
    startedAt: now,
  };
  // 進行中の周回は1つだけにする（前のものは途中で閉じる）
  await db.transaction("rw", db.rounds, async () => {
    const open = (await db.rounds.toArray()).filter((r) => r.finishedAt === undefined);
    for (const r of open) await db.rounds.put({ ...r, finishedAt: now });
    round.rid = await db.rounds.add(round);
  });
  return round;
}

/** 「この周のミスだけもう1周」 */
export async function startMissedRound(parent: Round, missedIds: string[], now: number): Promise<Round> {
  const round: Round = {
    no: parent.no,
    label: `${parent.no}周目のミスだけ（${missedIds.length}語）`,
    itemIds: missedIds.slice(),
    cursor: 0,
    order: "seq",
    startedAt: now,
    parentRid: parent.rid,
  };
  await db.transaction("rw", db.rounds, async () => {
    const open = (await db.rounds.toArray()).filter((r) => r.finishedAt === undefined);
    for (const r of open) await db.rounds.put({ ...r, finishedAt: now });
    round.rid = await db.rounds.add(round);
  });
  return round;
}

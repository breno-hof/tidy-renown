/**
 * Pure rule functions (no Foundry globals) so they can be unit tested.
 * Section references point to SPEC.md.
 */
import { DEFAULT_PROGRESS_MAX, FACTION_PREFIX, NPC_PREFIX } from "../constants.js";
import type { Disposition, FactionDef, RankDef, RelationEntry, Relations } from "./types.js";

export const factionKey = (factionId: string): string => `${FACTION_PREFIX}${factionId}`;
export const npcKey = (npcId: string): string => `${NPC_PREFIX}${npcId}`;
export const isFactionKey = (key: string): boolean => key.startsWith(FACTION_PREFIX);
export const isNpcKey = (key: string): boolean => key.startsWith(NPC_PREFIX);
export const idFromKey = (key: string): string => key.slice(2);

/**
 * Applies the score range rules (2.1 and 2.5):
 * - members of a faction never drop below 0 (DMG 2024);
 * - non-members and individual NPC relations may be negative (module extension);
 * - an optional faction cap limits the top.
 */
export function clampScore(score: number, opts: { member?: boolean; cap?: number | null }): number {
  let value = Number.isFinite(score) ? Math.trunc(score) : 0;
  if (opts.member) value = Math.max(0, value);
  if (opts.cap != null && Number.isFinite(opts.cap)) value = Math.min(opts.cap, value);
  return value;
}

/** Ranks sorted ascending by minimum score. */
export function sortRanks(ranks: readonly RankDef[]): RankDef[] {
  return [...ranks].sort((a, b) => a.minScore - b.minScore);
}

/** Current rank: highest minScore <= score (2.3). */
export function getRank(ranks: readonly RankDef[], score: number): RankDef | null {
  let current: RankDef | null = null;
  for (const rank of sortRanks(ranks)) {
    if (rank.minScore <= score) current = rank;
  }
  return current;
}

/** Next rank above the current score, if any. */
export function getNextRank(ranks: readonly RankDef[], score: number): RankDef | null {
  return sortRanks(ranks).find((rank) => rank.minScore > score) ?? null;
}

/** Ranks already reached (ascending), used to list benefits on the sheet. */
export function reachedRanks(ranks: readonly RankDef[], score: number): RankDef[] {
  return sortRanks(ranks).filter((rank) => rank.minScore <= score);
}

/** Width (0-100) of the progress bar and whether the bar is negative. */
export function progressOf(score: number, progressMax: number): { pct: number; negative: boolean } {
  const max = progressMax > 0 ? progressMax : DEFAULT_PROGRESS_MAX;
  const pct = Math.min(100, Math.round((Math.abs(score) / max) * 100));
  return { pct, negative: score < 0 };
}

/**
 * Score of one character (or the party actor) toward one NPC (2.6, "s"):
 * 1. individual relation with the NPC wins;
 * 2. else the lowest score among the NPC's factions (missing entry = 0);
 * 3. else null (NPC outside the automation).
 */
export function scoreTowardNpc(
  relations: Relations | null | undefined,
  npcId: string,
  npcFactionIds: readonly string[],
): number | null {
  const individual = relations?.[npcKey(npcId)];
  if (individual) return individual.score;
  if (!npcFactionIds.length) return null;
  return Math.min(...npcFactionIds.map((id) => relations?.[factionKey(id)]?.score ?? 0));
}

/** Whether a relations object has any entry relevant to this NPC. */
export function hasEntryForNpc(
  relations: Relations | null | undefined,
  npcId: string,
  npcFactionIds: readonly string[],
): boolean {
  if (!relations) return false;
  if (relations[npcKey(npcId)]) return true;
  return npcFactionIds.some((id) => relations[factionKey(id)] != null);
}

/**
 * Party score toward an NPC (2.6, "S"):
 * 1. the party actor's own entry, when it has one for this target;
 * 2. else the average of each character's score (characters with no applicable
 *    score are ignored; this only happens for NPCs without factions).
 * Returns null when nobody has an applicable score.
 */
export function partyScoreTowardNpc(
  partyRelations: Relations | null | undefined,
  characterRelations: ReadonlyArray<Relations | null | undefined>,
  npcId: string,
  npcFactionIds: readonly string[],
): number | null {
  if (hasEntryForNpc(partyRelations, npcId, npcFactionIds)) {
    return scoreTowardNpc(partyRelations, npcId, npcFactionIds);
  }
  const scores = characterRelations
    .map((rel) => scoreTowardNpc(rel, npcId, npcFactionIds))
    .filter((s): s is number => s != null);
  if (!scores.length) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

/** Disposition from the party score (2.6). Strict comparisons, as in the spec. */
export function dispositionFor(
  score: number,
  thresholds: { hostile: number; friendly: number },
): Disposition {
  if (score < thresholds.hostile) return "hostile";
  if (score > thresholds.friendly) return "friendly";
  return "neutral";
}

/** Normalizes an untrusted faction object (settings data, form input). */
export function normalizeFaction(raw: Partial<FactionDef> & { id: string }): FactionDef {
  const kind = raw.kind === "organization" || raw.kind === "community" ? raw.kind : "faction";
  const progressMax = Number(raw.progressMax);
  const cap = raw.cap == null || (raw.cap as unknown) === "" ? null : Number(raw.cap);
  const ranks = Array.isArray(raw.ranks) ? raw.ranks : Object.values(raw.ranks ?? {});
  return {
    id: raw.id,
    name: String(raw.name ?? "").trim(),
    kind,
    description: raw.description ? String(raw.description) : "",
    img: raw.img ? String(raw.img) : "",
    color: raw.color ? String(raw.color) : "",
    progressMax:
      Number.isFinite(progressMax) && progressMax > 0
        ? Math.trunc(progressMax)
        : DEFAULT_PROGRESS_MAX,
    cap: cap != null && Number.isFinite(cap) ? Math.trunc(cap) : null,
    ranks: sortRanks(
      (ranks as Partial<RankDef>[])
        .filter((r) => r && r.id)
        .map((r) => ({
          id: String(r.id),
          name: String(r.name ?? "").trim(),
          minScore: Number.isFinite(Number(r.minScore)) ? Math.trunc(Number(r.minScore)) : 0,
          description: r.description ? String(r.description) : "",
          icon: r.icon ? String(r.icon) : "",
        })),
    ),
  };
}

/** Applies a membership toggle to an entry (2.5): joining lifts negatives to 0. */
export function withMembership(entry: RelationEntry | undefined, member: boolean): RelationEntry {
  const score = entry?.score ?? 0;
  return { ...entry, score: member ? Math.max(0, score) : score, member };
}

/**
 * Validates a player's +1 request (RF-03). The delta is fixed server-side;
 * the request payload never carries it.
 */
export function canPlayerIncrease(opts: {
  enabled: boolean;
  isOwner: boolean;
  entry: RelationEntry | undefined;
  cap: number | null;
}): { ok: true; newScore: number } | { ok: false; reason: string } {
  if (!opts.enabled) return { ok: false, reason: "disabled" };
  if (!opts.isOwner) return { ok: false, reason: "not-owner" };
  if (!opts.entry) return { ok: false, reason: "no-entry" };
  const newScore = opts.entry.score + 1;
  if (opts.cap != null && newScore > opts.cap) return { ok: false, reason: "cap" };
  return { ok: true, newScore };
}

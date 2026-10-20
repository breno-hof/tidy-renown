/**
 * Reading and writing renown data on actors. The actor flags are the single
 * source of truth (RF-07); every write goes through clampScore.
 */
import { FLAGS, MODULE_ID, SCORE_HOLDER_TYPES } from "../constants.js";
import { getFaction } from "./factions.js";
import { clampScore, factionKey, idFromKey, isFactionKey, withMembership } from "./rules.js";
import type { RelationEntry, RelationKey, Relations } from "./types.js";

export function isScoreHolder(actor: any): boolean {
  return (SCORE_HOLDER_TYPES as readonly string[]).includes(actor?.type);
}

export function isNpc(actor: any): boolean {
  return actor?.type === "npc";
}

export function getRelations(actor: any): Relations {
  const raw = actor?.getFlag?.(MODULE_ID, FLAGS.relations);
  if (!raw || typeof raw !== "object") return {};
  const out: Relations = {};
  for (const [key, entry] of Object.entries(raw as Record<string, RelationEntry>)) {
    if (!entry || typeof entry !== "object") continue;
    out[key] = {
      score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
      member: !!entry.member,
      notes: entry.notes ?? "",
    };
  }
  return out;
}

export function getNpcFactionIds(actor: any): string[] {
  const raw = actor?.getFlag?.(MODULE_ID, FLAGS.memberOf);
  return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
}

function capFor(key: RelationKey): number | null {
  return isFactionKey(key) ? (getFaction(idFromKey(key))?.cap ?? null) : null;
}

function assertGM(): void {
  if (!game.user.isGM) throw new Error(`${MODULE_ID} | Only a GM can change renown.`);
}

async function writeEntry(actor: any, key: RelationKey, entry: RelationEntry): Promise<void> {
  await actor.setFlag(MODULE_ID, `${FLAGS.relations}.${key}`, entry);
}

/** Sets a score, applying the member floor and the faction cap. GM only. */
export async function setScore(actor: any, key: RelationKey, score: number): Promise<number> {
  assertGM();
  const entry = getRelations(actor)[key] ?? { score: 0, member: false, notes: "" };
  const value = clampScore(score, { member: isFactionKey(key) && entry.member, cap: capFor(key) });
  if (value !== entry.score || !(key in getRelations(actor))) {
    await writeEntry(actor, key, { ...entry, score: value });
  }
  return value;
}

export async function adjustScore(actor: any, key: RelationKey, delta: number): Promise<number> {
  const current = getRelations(actor)[key]?.score ?? 0;
  return setScore(actor, key, current + delta);
}

/** Adds or removes membership in a faction. Joining lifts a negative score to 0 (2.5). */
export async function setMember(actor: any, factionId: string, member: boolean): Promise<void> {
  assertGM();
  const key = factionKey(factionId);
  const entry = withMembership(getRelations(actor)[key], member);
  entry.score = clampScore(entry.score, { member, cap: capFor(key) });
  await writeEntry(actor, key, entry);
}

export async function setNotes(actor: any, key: RelationKey, notes: string): Promise<void> {
  assertGM();
  const entry = getRelations(actor)[key] ?? { score: 0, member: false };
  await writeEntry(actor, key, { ...entry, notes });
}

/** Creates an entry (score 0) if it does not exist yet. */
export async function ensureRelation(
  actor: any,
  key: RelationKey,
  init: Partial<RelationEntry> = {},
): Promise<void> {
  assertGM();
  if (key in getRelations(actor)) return;
  const member = isFactionKey(key) ? !!init.member : false;
  await writeEntry(actor, key, {
    score: clampScore(init.score ?? 0, { member, cap: capFor(key) }),
    member,
    notes: init.notes ?? "",
  });
}

export async function removeRelation(actor: any, key: RelationKey): Promise<void> {
  assertGM();
  if (!(key in getRelations(actor))) return;
  await actor.unsetFlag(MODULE_ID, `${FLAGS.relations}.${key}`);
}

export async function setNpcFactions(actor: any, factionIds: string[]): Promise<void> {
  assertGM();
  await actor.setFlag(MODULE_ID, FLAGS.memberOf, [...new Set(factionIds)]);
}

export async function addNpcToFaction(actor: any, factionId: string): Promise<void> {
  await setNpcFactions(actor, [...getNpcFactionIds(actor), factionId]);
}

export async function removeNpcFromFaction(actor: any, factionId: string): Promise<void> {
  await setNpcFactions(
    actor,
    getNpcFactionIds(actor).filter((id) => id !== factionId),
  );
}

/** Links any actor to a faction: score holders become members, NPCs join memberOf. */
export async function linkActorToFaction(actor: any, factionId: string): Promise<boolean> {
  if (isScoreHolder(actor)) {
    await setMember(actor, factionId, true);
    return true;
  }
  if (isNpc(actor)) {
    await addNpcToFaction(actor, factionId);
    return true;
  }
  return false;
}

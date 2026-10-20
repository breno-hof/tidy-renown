/**
 * Runtime membership lists (2.4, RF-07). Nothing is persisted on factions;
 * this index is rebuilt lazily from actor flags and invalidated by actor hooks.
 */
import { NPC_PREFIX } from "../constants.js";
import { getNpcFactionIds, getRelations, isNpc, isScoreHolder } from "./renown.js";
import { idFromKey, isFactionKey } from "./rules.js";
import type { RelationEntry } from "./types.js";

export interface IndexedRelation {
  actor: any;
  key: string;
  entry: RelationEntry;
}

interface MembershipIndex {
  /** factionId -> characters/party actors with any entry for that faction. */
  factionRelations: Map<string, IndexedRelation[]>;
  /** factionId -> NPC actors that are members. */
  factionNpcs: Map<string, any[]>;
  /** npcId -> characters/party actors with an individual relation to that NPC. */
  npcRelations: Map<string, IndexedRelation[]>;
}

let cache: MembershipIndex | null = null;

export function invalidateMembershipIndex(): void {
  cache = null;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function build(): MembershipIndex {
  const index: MembershipIndex = {
    factionRelations: new Map(),
    factionNpcs: new Map(),
    npcRelations: new Map(),
  };
  for (const actor of game.actors) {
    if (isScoreHolder(actor)) {
      for (const [key, entry] of Object.entries(getRelations(actor))) {
        if (isFactionKey(key)) push(index.factionRelations, idFromKey(key), { actor, key, entry });
        else if (key.startsWith(NPC_PREFIX))
          push(index.npcRelations, idFromKey(key), { actor, key, entry });
      }
    } else if (isNpc(actor)) {
      for (const id of getNpcFactionIds(actor)) push(index.factionNpcs, id, actor);
    }
  }
  const byName = (a: { actor?: any; name?: string }, b: { actor?: any; name?: string }) =>
    String(a.actor?.name ?? a.name).localeCompare(String(b.actor?.name ?? b.name));
  for (const list of index.factionRelations.values()) list.sort(byName);
  for (const list of index.npcRelations.values()) list.sort(byName);
  for (const list of index.factionNpcs.values()) list.sort(byName);
  return index;
}

function getIndex(): MembershipIndex {
  cache ??= build();
  return cache;
}

/** Characters/party actors with an entry for the faction (members and non-members). */
export function getFactionRelations(factionId: string): IndexedRelation[] {
  return getIndex().factionRelations.get(factionId) ?? [];
}

/** NPCs that belong to the faction. */
export function getFactionNpcs(factionId: string): any[] {
  return getIndex().factionNpcs.get(factionId) ?? [];
}

/** Members only: score holders flagged as member plus NPC members. */
export function getMembers(factionId: string): any[] {
  return [
    ...getFactionRelations(factionId)
      .filter((r) => r.entry.member)
      .map((r) => r.actor),
    ...getFactionNpcs(factionId),
  ];
}

export function getNpcIndividualRelations(npcId: string): IndexedRelation[] {
  return getIndex().npcRelations.get(npcId) ?? [];
}

import { DEFAULT_PROGRESS_MAX, DMG_THRESHOLDS, FLAGS, MODULE_ID, SETTINGS } from "../constants.js";
import { factionKey, normalizeFaction } from "./rules.js";
import type { FactionDef, RankDef } from "./types.js";

/** All faction definitions, normalized and sorted by name. */
export function getFactions(): FactionDef[] {
  const raw = (game.settings.get(MODULE_ID, SETTINGS.factions) ?? {}) as Record<string, FactionDef>;
  return Object.values(raw)
    .filter((f) => f && f.id)
    .map((f) => normalizeFaction(f))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

export function getFactionMap(): Map<string, FactionDef> {
  return new Map(getFactions().map((f) => [f.id, f]));
}

export function getFaction(id: string): FactionDef | null {
  return getFactionMap().get(id) ?? null;
}

function assertGM(): void {
  if (!game.user.isGM) throw new Error(`${MODULE_ID} | Only a GM can change factions.`);
}

async function writeAll(factions: Record<string, FactionDef>): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.factions, factions);
}

function rawMap(): Record<string, FactionDef> {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.factions) ?? {});
}

export async function createFaction(name?: string): Promise<FactionDef> {
  assertGM();
  const faction: FactionDef = {
    id: foundry.utils.randomID(),
    name: name ?? game.i18n.localize("TIDY_RENOWN.Faction.NewName"),
    kind: "faction",
    description: "",
    img: "",
    color: "",
    progressMax: DEFAULT_PROGRESS_MAX,
    cap: null,
    ranks: [],
  };
  const all = rawMap();
  all[faction.id] = faction;
  await writeAll(all);
  return faction;
}

/** Saves a faction only if something actually changed (avoids re-render churn). */
export async function saveFaction(faction: FactionDef): Promise<boolean> {
  assertGM();
  const all = rawMap();
  const next = normalizeFaction(faction);
  const prev = all[faction.id] ? normalizeFaction(all[faction.id]) : null;
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return false;
  all[faction.id] = next;
  await writeAll(all);
  return true;
}

/** Deletes a faction and removes its entries from every actor (RF-01). */
export async function deleteFaction(id: string): Promise<void> {
  assertGM();
  const all = rawMap();
  delete all[id];
  await writeAll(all);

  const key = factionKey(id);
  for (const actor of game.actors) {
    const relations = actor.getFlag(MODULE_ID, FLAGS.relations);
    if (relations && key in relations) {
      await actor.unsetFlag(MODULE_ID, `${FLAGS.relations}.${key}`);
    }
    const memberOf: string[] | undefined = actor.getFlag(MODULE_ID, FLAGS.memberOf);
    if (Array.isArray(memberOf) && memberOf.includes(id)) {
      await actor.setFlag(
        MODULE_ID,
        FLAGS.memberOf,
        memberOf.filter((f) => f !== id),
      );
    }
  }
}

export function newRank(minScore = 0, name = "", description = ""): RankDef {
  return { id: foundry.utils.randomID(), name, minScore, description, icon: "" };
}

/** The three benefit thresholds of the DMG 2024, pre-filled with the RAW benefit text. */
export function dmgThresholdRanks(): RankDef[] {
  return DMG_THRESHOLDS.map((score) =>
    newRank(score, "", game.i18n.localize(`TIDY_RENOWN.Benefits.DMG${score}`)),
  );
}

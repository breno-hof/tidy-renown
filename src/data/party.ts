/** Helpers around the dnd5e primary party (group actor). */

/** The dnd5e primary party actor, if one is set. */
export function getPrimaryParty(): any | null {
  const direct = game.actors?.party;
  if (direct) return direct;
  try {
    const setting = game.settings.get("dnd5e", "primaryParty");
    return setting?.actor ?? null;
  } catch {
    return null;
  }
}

/** Character actors in a group actor (dnd5e stores members as `{ actor, ... }`). */
export function getGroupCharacters(group: any): any[] {
  const members: unknown[] = Array.from(group?.system?.members ?? []);
  return members
    .map((m: any) => m?.actor ?? m)
    .filter((a: any) => a?.documentName === "Actor" && a.type === "character");
}

/**
 * Characters whose scores feed the party score (2.6): the primary party's
 * members, or every player-owned character when there is no primary party.
 */
export function getPartyContext(): { party: any | null; characters: any[] } {
  const party = getPrimaryParty();
  if (party) return { party, characters: getGroupCharacters(party) };
  const characters = game.actors.filter((a: any) => a.type === "character" && a.hasPlayerOwner);
  return { party: null, characters };
}

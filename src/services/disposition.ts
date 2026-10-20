/**
 * [Module extension] Automatic token disposition (SPEC 2.6).
 * Only the active GM writes; writes happen only when the value changes.
 */
import { FLAGS, MODULE_ID, SETTINGS } from "../constants.js";
import { getFactionMap } from "../data/factions.js";
import { getPartyContext } from "../data/party.js";
import { getNpcFactionIds, getRelations, isNpc } from "../data/renown.js";
import { dispositionFor, partyScoreTowardNpc } from "../data/rules.js";
import type { Disposition } from "../data/types.js";
import { getSetting, getThresholds } from "../settings.js";

const DEBOUNCE_MS = 250;

export function dispositionValue(d: Disposition): number {
  const D = CONST.TOKEN_DISPOSITIONS;
  return d === "hostile" ? D.HOSTILE : d === "friendly" ? D.FRIENDLY : D.NEUTRAL;
}

/** Faction ids of an NPC that still exist in the world setting. */
function validFactionIds(actor: any, known: Map<string, unknown>): string[] {
  return getNpcFactionIds(actor).filter((id) => known.has(id));
}

export interface NpcStanding {
  score: number | null;
  disposition: Disposition | null;
}

/**
 * Party score (S) and resulting disposition for an NPC actor (base or synthetic).
 * `npcId` is the world actor id, which is what individual relations refer to.
 */
export function computeNpcStanding(
  actor: any,
  ctx = getPartyContext(),
  known = getFactionMap(),
): NpcStanding {
  if (!isNpc(actor)) return { score: null, disposition: null };
  const npcId = actor.isToken ? (actor.token?.actorId ?? actor.id) : actor.id;
  const factionIds = validFactionIds(actor, known);
  const score = partyScoreTowardNpc(
    ctx.party ? getRelations(ctx.party) : null,
    ctx.characters.map((c) => getRelations(c)),
    npcId,
    factionIds,
  );
  if (score == null) return { score: null, disposition: null };
  return { score, disposition: dispositionFor(score, getThresholds()) };
}

function isLocked(tokenLike: any): boolean {
  return !!tokenLike?.flags?.[MODULE_ID]?.[FLAGS.lockDisposition];
}

function shouldWrite(tokenLike: any, target: number): boolean {
  if (!tokenLike) return false;
  if (tokenLike.disposition === CONST.TOKEN_DISPOSITIONS.SECRET) return false;
  if (isLocked(tokenLike)) return false;
  return tokenLike.disposition !== target;
}

function canWrite(): boolean {
  return !!game.users.activeGM?.isSelf && !!getSetting<boolean>(SETTINGS.autoDisposition);
}

/** Recomputes every NPC prototype token and every placed NPC token. */
export async function recalculateAllDispositions(force = false): Promise<number> {
  if (!force && !canWrite()) return 0;
  if (force && !game.user.isGM) return 0;

  const ctx = getPartyContext();
  const known = getFactionMap();
  let changes = 0;

  // Prototype tokens of world NPC actors.
  const actorUpdates: Record<string, unknown>[] = [];
  for (const actor of game.actors) {
    if (!isNpc(actor)) continue;
    const { disposition } = computeNpcStanding(actor, ctx, known);
    if (!disposition) continue;
    const target = dispositionValue(disposition);
    if (shouldWrite(actor.prototypeToken, target)) {
      actorUpdates.push({ _id: actor.id, "prototypeToken.disposition": target });
    }
  }
  if (actorUpdates.length) {
    await Actor.implementation.updateDocuments(actorUpdates);
    changes += actorUpdates.length;
  }

  // Placed tokens (linked and unlinked) in every scene.
  for (const scene of game.scenes) {
    const tokenUpdates: Record<string, unknown>[] = [];
    for (const token of scene.tokens) {
      const actor = token.actor;
      if (!isNpc(actor)) continue;
      const { disposition } = computeNpcStanding(actor, ctx, known);
      if (!disposition) continue;
      const target = dispositionValue(disposition);
      if (shouldWrite(token, target)) tokenUpdates.push({ _id: token.id, disposition: target });
    }
    if (tokenUpdates.length) {
      await scene.updateEmbeddedDocuments("Token", tokenUpdates);
      changes += tokenUpdates.length;
    }
  }
  return changes;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<unknown> | null = null;
let rerun = false;

/** Debounced recalculation; safe to call from any hook on any client. */
export function scheduleDispositionRecalc(): void {
  if (typeof game === "undefined" || !game.ready || !canWrite()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (running) {
      rerun = true;
      return;
    }
    running = recalculateAllDispositions()
      .catch((err) => console.error(`${MODULE_ID} | disposition recalculation failed`, err))
      .finally(() => {
        running = null;
        if (rerun) {
          rerun = false;
          scheduleDispositionRecalc();
        }
      });
  }, DEBOUNCE_MS);
}

/** Lock or unlock automatic disposition for an NPC: prototype and placed tokens. */
export async function setNpcDispositionLock(actor: any, locked: boolean): Promise<void> {
  if (!game.user.isGM) return;
  const base = actor.isToken ? actor.token?.baseActor : actor;
  if (base)
    await base.update({ [`prototypeToken.flags.${MODULE_ID}.${FLAGS.lockDisposition}`]: locked });
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .filter((t: any) => t.actorId === (base?.id ?? actor.id))
      .map((t: any) => ({ _id: t.id, [`flags.${MODULE_ID}.${FLAGS.lockDisposition}`]: locked }));
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
  if (!locked) scheduleDispositionRecalc();
}

export function isNpcDispositionLocked(actor: any): boolean {
  if (actor.isToken) return isLocked(actor.token);
  return isLocked(actor.prototypeToken);
}

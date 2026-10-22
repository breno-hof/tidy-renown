/** View models for the Renown tabs (RF-04). Strings are resolved here, templates stay dumb. */
import { SETTINGS } from "../constants.js";
import { getFactionMap, getFactions } from "../data/factions.js";
import { getNpcIndividualRelations } from "../data/membership-index.js";
import { getNpcFactionIds, getRelations, isNpc } from "../data/renown.js";
import {
  getNextRank,
  getRank,
  idFromKey,
  isFactionKey,
  isNpcKey,
  npcKey,
  progressOf,
  reachedRanks,
} from "../data/rules.js";
import type { FactionDef, RankDef } from "../data/types.js";
import { computeNpcStanding, isNpcDispositionLocked } from "../services/disposition.js";
import { getSetting, getThresholds } from "../settings.js";

const t = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

export function rankLabel(rank: RankDef | null): string {
  if (!rank) return "";
  return rank.name || t("TIDY_RENOWN.Rank.Unnamed", { score: rank.minScore });
}

function kindLabel(faction: FactionDef): string {
  return t(`TIDY_RENOWN.Faction.Kind.${faction.kind}`);
}

const QUICK_DELTAS = [1, 2, 3, 4, -1, -2].map((d) => ({
  delta: d,
  label: d > 0 ? `+${d}` : `−${Math.abs(d)}`,
  negative: d < 0,
  small: Math.abs(d) <= 2,
}));

function permissions(actor: any) {
  const isGM = !!game.user.isGM;
  const playersCanIncrease = !!getSetting<boolean>(SETTINGS.playersCanIncrease);
  const gmOnline = !!game.users.activeGM;
  return {
    isGM,
    canIncrease: !isGM && playersCanIncrease && !!actor.isOwner,
    gmOnline,
    increaseTooltip: gmOnline ? t("TIDY_RENOWN.Tab.IncreaseHint") : t("TIDY_RENOWN.Notify.NoGM"),
  };
}

/** Context for characters and the party (group) actor. */
export async function buildScoreHolderContext(actor: any) {
  const factions = getFactionMap();
  const relations = getRelations(actor);
  const perms = permissions(actor);

  const factionCards = (
    await Promise.all(
      Object.entries(relations)
        .filter(([key]) => isFactionKey(key) && factions.has(idFromKey(key)))
        .map(async ([key, entry]) => {
          const faction = factions.get(idFromKey(key))!;
          const rank = getRank(faction.ranks, entry.score);
          const next = getNextRank(faction.ranks, entry.score);
          const progress = progressOf(entry.score, faction.progressMax);
          const benefits = await Promise.all(
            reachedRanks(faction.ranks, entry.score)
              .filter((r) => r.description)
              .map(async (r) => ({
                name: rankLabel(r),
                description: await foundry.applications.ux.TextEditor.enrichHTML(r.description, {
                  secrets: game.user.isGM,
                }),
              })),
          );
          return {
            key,
            id: faction.id,
            name: faction.name,
            img: faction.img,
            color: faction.color,
            kindLabel: kindLabel(faction),
            descriptionHtml: faction.description
              ? await foundry.applications.ux.TextEditor.enrichHTML(faction.description, {
                  secrets: game.user.isGM,
                })
              : "",
            score: entry.score,
            member: !!entry.member,
            notes: entry.notes ?? "",
            cap: faction.cap,
            progressMax: faction.progressMax,
            progressPct: progress.pct,
            negative: progress.negative,
            rankName: rankLabel(rank),
            nextLabel: next
              ? t("TIDY_RENOWN.Tab.NextRank", { rank: rankLabel(next), score: next.minScore })
              : "",
            benefits,
            atCap: faction.cap != null && entry.score >= faction.cap,
          };
        }),
    )
  ).sort((a, b) => a.name.localeCompare(b.name));

  const npcRelations = Object.entries(relations)
    .filter(([key]) => isNpcKey(key))
    .map(([key, entry]) => {
      const npc = game.actors.get(idFromKey(key));
      return {
        key,
        npcId: idFromKey(key),
        name: npc?.name ?? t("TIDY_RENOWN.Tab.MissingNpc"),
        img: npc?.img ?? "icons/svg/mystery-man.svg",
        missing: !npc,
        score: entry.score,
        negative: entry.score < 0,
        notes: entry.notes ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const linked = new Set(factionCards.map((f) => f.id));
  const linkedNpcs = new Set(npcRelations.map((n) => n.npcId));

  return {
    ...perms,
    actorId: actor.id,
    isParty: actor.type === "group",
    quickDeltas: QUICK_DELTAS,
    factions: factionCards,
    npcRelations,
    hasNpcRelations: npcRelations.length > 0,
    empty: factionCards.length === 0 && npcRelations.length === 0,
    availableFactions: perms.isGM
      ? getFactions()
          .filter((f) => !linked.has(f.id))
          .map((f) => ({ id: f.id, name: f.name }))
      : [],
    availableNpcs: perms.isGM
      ? game.actors
          .filter((a: any) => isNpc(a) && !linkedNpcs.has(a.id))
          .map((a: any) => ({ id: a.id, name: a.name }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name))
      : [],
  };
}

const DISPOSITION_LABELS = {
  hostile: "TIDY_RENOWN.Disposition.hostile",
  neutral: "TIDY_RENOWN.Disposition.neutral",
  friendly: "TIDY_RENOWN.Disposition.friendly",
} as const;

/** Context for NPC sheets. */
export function buildNpcContext(actor: any) {
  const isGM = !!game.user.isGM;
  const factions = getFactionMap();
  const npcId = actor.isToken ? (actor.token?.actorId ?? actor.id) : actor.id;
  const memberOf = getNpcFactionIds(actor)
    .filter((id) => factions.has(id))
    .map((id) => {
      const f = factions.get(id)!;
      return { id, name: f.name, img: f.img, color: f.color, kindLabel: kindLabel(f) };
    });

  const relations = getNpcIndividualRelations(npcId).map((r) => ({
    actorId: r.actor.id,
    key: r.key,
    name: r.actor.name,
    img: r.actor.img,
    score: r.entry.score,
    negative: r.entry.score < 0,
  }));

  const standing = computeNpcStanding(actor);
  const thresholds = getThresholds();
  const linkedChars = new Set(relations.map((r) => r.actorId));
  const memberIds = new Set(memberOf.map((m) => m.id));

  return {
    isGM,
    npcId,
    quickDeltas: QUICK_DELTAS.filter((d) => d.small),
    memberOf,
    relations,
    hasRelations: relations.length > 0,
    empty: memberOf.length === 0 && relations.length === 0,
    partyScore: standing.score == null ? null : Math.round(standing.score * 10) / 10,
    hasStanding: standing.score != null,
    dispositionKey: standing.disposition ?? "",
    dispositionLabel: standing.disposition ? t(DISPOSITION_LABELS[standing.disposition]) : "",
    thresholdsLabel: t("TIDY_RENOWN.Npc.Thresholds", thresholds),
    autoDisposition: !!getSetting<boolean>(SETTINGS.autoDisposition),
    locked: isNpcDispositionLocked(actor),
    availableFactions: isGM
      ? getFactions()
          .filter((f) => !memberIds.has(f.id))
          .map((f) => ({ id: f.id, name: f.name }))
      : [],
    availableCharacters: isGM
      ? game.actors
          .filter(
            (a: any) =>
              (a.type === "character" || a.type === "group") &&
              !linkedChars.has(a.id) &&
              !(npcKey(npcId) in getRelations(a)),
          )
          .map((a: any) => ({ id: a.id, name: a.name }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name))
      : [],
  };
}

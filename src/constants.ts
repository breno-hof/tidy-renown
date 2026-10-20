export const MODULE_ID = "tidy-renown";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const TIDY_ID = "tidy5e-sheet";

/** Flag keys stored under `flags.tidy-renown.*`. */
export const FLAGS = {
  /** On `character` / `group` actors: Record<RelationKey, RelationEntry>. */
  relations: "relations",
  /** On `npc` actors: string[] of faction ids. */
  memberOf: "memberOf",
  /** On TokenDocuments and prototype tokens: boolean. */
  lockDisposition: "lockDisposition",
} as const;

export const SETTINGS = {
  factions: "factions",
  playersCanIncrease: "playersCanIncrease",
  autoDisposition: "autoDisposition",
  hostileThreshold: "hostileThreshold",
  friendlyThreshold: "friendlyThreshold",
  showNpcRelationsToPlayers: "showNpcRelationsToPlayers",
} as const;

export const TEMPLATES = {
  manager: `modules/${MODULE_ID}/templates/faction-manager.hbs`,
  actorTab: `modules/${MODULE_ID}/templates/actor-renown-tab.hbs`,
  npcTab: `modules/${MODULE_ID}/templates/npc-renown-tab.hbs`,
} as const;

/** Prefixes for relation keys (ids, not UUIDs: dots in flag keys become nesting). */
export const FACTION_PREFIX = "f_";
export const NPC_PREFIX = "n_";

/** Actor types that hold renown scores. */
export const SCORE_HOLDER_TYPES = ["character", "group"] as const;

/** Benefit thresholds named in the DMG 2024 Renown section. */
export const DMG_THRESHOLDS = [3, 10, 50] as const;

export const DEFAULT_PROGRESS_MAX = 50;

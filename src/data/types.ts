export type FactionKind = "faction" | "organization" | "community";

export interface RankDef {
  id: string;
  name: string;
  minScore: number;
  /** Benefits and any extra prerequisites (free text; never validated). */
  description?: string;
  icon?: string;
}

/** Stored in the world setting `tidy-renown.factions` as Record<id, FactionDef>. */
export interface FactionDef {
  id: string;
  name: string;
  kind: FactionKind;
  description?: string;
  img?: string;
  color?: string;
  /** Scale of the progress bar (visual only). */
  progressMax: number;
  /** Optional cap; null means no cap (RAW). */
  cap: number | null;
  ranks: RankDef[];
}

/** `f_<factionId>` or `n_<npcActorId>`. */
export type RelationKey = string;

export interface RelationEntry {
  score: number;
  /** Only meaningful for faction keys; members can never drop below 0. */
  member?: boolean;
  notes?: string;
}

export type Relations = Record<RelationKey, RelationEntry>;

export type Disposition = "hostile" | "neutral" | "friendly";

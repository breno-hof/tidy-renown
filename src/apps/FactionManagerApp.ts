/**
 * GM faction manager (RF-01, RF-02, SPEC 7.1). ApplicationV2 + Handlebars.
 * The class is created lazily so `foundry.applications.api` is only touched at runtime.
 */
import { MODULE_ID, TEMPLATES } from "../constants.js";
import {
  createFaction,
  deleteFaction,
  dmgThresholdRanks,
  getFaction,
  getFactions,
  newRank,
  saveFaction,
} from "../data/factions.js";
import { getFactionNpcs, getFactionRelations, getMembers } from "../data/membership-index.js";
import {
  adjustScore,
  isNpc,
  isScoreHolder,
  linkActorToFaction,
  removeNpcFromFaction,
  removeRelation,
  setMember,
  setScore,
} from "../data/renown.js";
import { factionKey, getRank, normalizeFaction } from "../data/rules.js";
import type { FactionDef } from "../data/types.js";
import { recalculateAllDispositions } from "../services/disposition.js";
import { rankLabel } from "../tidy/context.js";

const t = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

const KINDS = ["faction", "organization", "community"] as const;
const QUICK = [1, 2, -1, -2].map((d) => ({
  delta: d,
  label: d > 0 ? `+${d}` : `−${-d}`,
  negative: d < 0,
}));

let ManagerClass: any = null;
let instance: any = null;

function typeLabel(actor: any): string {
  return t(`TIDY_RENOWN.ActorType.${actor.type}`);
}

function folderLabel(actor: any): string {
  return actor.folder?.name || t("TIDY_RENOWN.Manager.UnfiledActors");
}

function groupByFolder<T extends { folderId: string; folderName: string; name: string }>(
  actors: T[],
): { name: string; actors: T[] }[] {
  const folders = new Map<string, { name: string; actors: T[] }>();
  for (const actor of actors) {
    const folder = folders.get(actor.folderId) ?? { name: actor.folderName, actors: [] };
    folder.actors.push(actor);
    folders.set(actor.folderId, folder);
  }
  for (const folder of folders.values()) {
    folder.actors.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...folders.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getManagerClass(): any {
  if (ManagerClass) return ManagerClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  class RankEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-rank-editor`,
      classes: [`${MODULE_ID}-manager`, `${MODULE_ID}-rank-editor`],
      tag: "form",
      window: { title: "TIDY_RENOWN.Manager.AddRankTitle", resizable: false },
      position: { width: 480, height: "auto" },
      form: { handler: RankEditorApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
      actions: { cancel: RankEditorApp.#onCancel },
    };

    static PARTS = {
      main: { template: TEMPLATES.rankEditor },
    };

    factionId: string;
    manager: any;

    constructor(factionId: string, manager: any) {
      super({ id: `${MODULE_ID}-rank-editor-${factionId}` });
      this.factionId = factionId;
      this.manager = manager;
    }

    async _prepareContext(options: any): Promise<any> {
      const context = await super._prepareContext(options);
      const faction = getFaction(this.factionId);
      const minScore = faction?.ranks.reduce((max, rank) => Math.max(max, rank.minScore), -1) ?? -1;
      return { ...context, minScore: minScore + 1 };
    }

    static async #onSubmit(
      this: RankEditorApp,
      _event: Event,
      _form: HTMLFormElement,
      formData: any,
    ) {
      const faction = getFaction(this.factionId);
      if (!faction) return;
      const rankData = foundry.utils.expandObject(formData.object).rank ?? {};
      const minScore = Number(rankData.minScore);
      if (!Number.isFinite(minScore)) {
        ui.notifications.warn(t("TIDY_RENOWN.Rank.InvalidScore"));
        return;
      }
      const rank = newRank(
        minScore,
        String(rankData.name ?? ""),
        String(rankData.description ?? ""),
      );
      await saveFaction({ ...faction, ranks: [...faction.ranks, rank] });
      if (this.manager.selectedId === faction.id) this.manager.render();
      await this.close();
    }

    static #onCancel(this: RankEditorApp) {
      void this.close();
    }
  }

  class FactionManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-manager`,
      classes: [`${MODULE_ID}-manager`],
      tag: "form",
      window: { title: "TIDY_RENOWN.Manager.Title", icon: "fa-solid fa-flag", resizable: true },
      position: { width: 760, height: 720 },
      form: { handler: FactionManagerApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
      actions: {
        newFaction: FactionManagerApp.#onNewFaction,
        openFaction: FactionManagerApp.#onOpenFaction,
        back: FactionManagerApp.#onBack,
        deleteFaction: FactionManagerApp.#onDeleteFaction,
        addRank: FactionManagerApp.#onAddRank,
        removeRank: FactionManagerApp.#onRemoveRank,
        dmgThresholds: FactionManagerApp.#onDmgThresholds,
        adjust: FactionManagerApp.#onAdjust,
        toggleMember: FactionManagerApp.#onToggleMember,
        removeRelation: FactionManagerApp.#onRemoveRelation,
        removeNpc: FactionManagerApp.#onRemoveNpc,
        addActor: FactionManagerApp.#onAddActor,
        openActor: FactionManagerApp.#onOpenActor,
        recalc: FactionManagerApp.#onRecalc,
      },
    };

    static PARTS = {
      main: { template: TEMPLATES.manager, scrollable: [".tr-manager-body"] },
    };

    selectedId: string | null = null;

    get title(): string {
      const faction = this.selectedId ? getFaction(this.selectedId) : null;
      const base = t("TIDY_RENOWN.Manager.Title");
      return faction ? `${base}: ${faction.name}` : base;
    }

    async _prepareContext(options: any): Promise<any> {
      const context = await super._prepareContext(options);
      const faction = this.selectedId ? getFaction(this.selectedId) : null;
      if (!faction) {
        this.selectedId = null;
        return { ...context, isList: true, factions: this.#listContext() };
      }
      return { ...context, isList: false, ...this.#detailContext(faction) };
    }

    #listContext() {
      return getFactions().map((f) => ({
        id: f.id,
        name: f.name || t("TIDY_RENOWN.Faction.Unnamed"),
        img: f.img,
        color: f.color,
        kindLabel: t(`TIDY_RENOWN.Faction.Kind.${f.kind}`),
        memberCount: getMembers(f.id).length,
        rankCount: f.ranks.length,
      }));
    }

    #detailContext(faction: FactionDef) {
      const relations = getFactionRelations(faction.id).map((r) => ({
        actorId: r.actor.id,
        name: r.actor.name,
        img: r.actor.img,
        folderId: r.actor.folder?.id ?? "",
        folderName: folderLabel(r.actor),
        typeLabel: typeLabel(r.actor),
        score: r.entry.score,
        negative: r.entry.score < 0,
        member: !!r.entry.member,
        rankName: rankLabel(getRank(faction.ranks, r.entry.score)),
      }));
      const npcs = getFactionNpcs(faction.id).map((a: any) => ({
        actorId: a.id,
        name: a.name,
        img: a.img,
        folderId: a.folder?.id ?? "",
        folderName: folderLabel(a),
      }));
      const linked = new Set([...relations.map((r) => r.actorId), ...npcs.map((n) => n.actorId)]);
      const addable = game.actors
        .filter((a: any) => (isScoreHolder(a) || isNpc(a)) && !linked.has(a.id))
        .map((a: any) => ({
          id: a.id,
          name: a.name,
          folderId: a.folder?.id ?? "",
          folderName: folderLabel(a),
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      return {
        faction,
        kinds: KINDS.map((k) => ({
          value: k,
          label: t(`TIDY_RENOWN.Faction.Kind.${k}`),
          selected: k === faction.kind,
        })),
        ranks: faction.ranks.map((r, i) => ({ ...r, index: i })),
        hasRanks: faction.ranks.length > 0,
        relationFolders: groupByFolder(relations),
        hasRelations: relations.length > 0,
        npcFolders: groupByFolder(npcs),
        hasNpcs: npcs.length > 0,
        addableFolders: groupByFolder(addable),
        quickDeltas: QUICK,
      };
    }

    async _onRender(context: any, options: any): Promise<void> {
      await super._onRender(context, options);
      const zone = this.element.querySelector(".tr-dropzone") as HTMLElement | null;
      if (!zone) return;
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        zone.classList.add("tr-drag-over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("tr-drag-over"));
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("tr-drag-over");
        void this.#onDrop(event);
      });
    }

    async #onDrop(event: DragEvent): Promise<void> {
      if (!this.selectedId) return;
      let data: any;
      try {
        data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? "");
      } catch {
        return;
      }
      if (data?.type !== "Actor" || !data.uuid) return;
      const actor = fromUuidSync(data.uuid);
      if (!actor || !(await linkActorToFaction(actor, this.selectedId))) {
        ui.notifications.warn(t("TIDY_RENOWN.Notify.InvalidActor"));
      }
    }

    /** Current faction state from the form, so actions never drop unsaved edits. */
    #factionFromForm(): FactionDef | null {
      const stored = this.selectedId ? getFaction(this.selectedId) : null;
      if (!stored) return null;
      const FormDataExtended = foundry.applications.ux.FormDataExtended;
      const raw = foundry.utils.expandObject(new FormDataExtended(this.element).object);
      return normalizeFaction({
        ...stored,
        ...(raw.faction ?? {}),
        id: stored.id,
        ranks: raw.ranks ? Object.values(raw.ranks) : stored.ranks,
      });
    }

    static async #onSubmit(
      this: FactionManagerApp,
      _event: Event,
      _form: HTMLFormElement,
      formData: any,
    ) {
      const faction = this.#factionFromForm();
      if (!faction) return;
      await saveFaction(faction);

      const scores = foundry.utils.expandObject(formData.object).scores ?? {};
      const key = factionKey(faction.id);
      for (const [actorId, value] of Object.entries(scores)) {
        const actor = game.actors.get(actorId);
        const current = getFactionRelations(faction.id).find((r) => r.actor.id === actorId);
        if (actor && current && Number(value) !== current.entry.score) {
          await setScore(actor, key, Number(value));
        }
      }
    }

    static async #onNewFaction(this: FactionManagerApp) {
      const faction = await createFaction();
      this.selectedId = faction.id;
      this.render();
    }

    static #onOpenFaction(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      this.selectedId = target.closest<HTMLElement>("[data-faction-id]")?.dataset.factionId ?? null;
      this.render();
    }

    static #onBack(this: FactionManagerApp) {
      this.selectedId = null;
      this.render();
    }

    static async #onDeleteFaction(this: FactionManagerApp) {
      const faction = this.selectedId ? getFaction(this.selectedId) : null;
      if (!faction) return;
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("TIDY_RENOWN.Manager.DeleteTitle") },
        content: `<p>${t("TIDY_RENOWN.Manager.DeleteConfirm", {
          name: foundry.utils.escapeHTML?.(faction.name) ?? faction.name,
        })}</p>`,
      });
      if (!confirmed) return;
      this.selectedId = null;
      await deleteFaction(faction.id);
      this.render();
    }

    static async #onAddRank(this: FactionManagerApp) {
      if (!this.selectedId) return;
      const faction = this.#factionFromForm();
      if (!faction) return;
      await saveFaction(faction);
      new RankEditorApp(this.selectedId, this).render({ force: true });
    }

    static async #onRemoveRank(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const faction = this.#factionFromForm();
      const rankId = target.closest<HTMLElement>("[data-rank-id]")?.dataset.rankId;
      if (!faction || !rankId) return;
      faction.ranks = faction.ranks.filter((r) => r.id !== rankId);
      await saveFaction(faction);
    }

    static async #onDmgThresholds(this: FactionManagerApp) {
      const faction = this.#factionFromForm();
      if (!faction) return;
      const existing = new Set(faction.ranks.map((r) => r.minScore));
      faction.ranks.push(...dmgThresholdRanks().filter((r) => !existing.has(r.minScore)));
      await saveFaction(faction);
    }

    static async #onAdjust(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(
        target.closest<HTMLElement>("[data-actor-id]")?.dataset.actorId,
      );
      if (!actor || !this.selectedId) return;
      await adjustScore(actor, factionKey(this.selectedId), Number(target.dataset.delta));
    }

    static async #onToggleMember(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(
        target.closest<HTMLElement>("[data-actor-id]")?.dataset.actorId,
      );
      if (!actor || !this.selectedId) return;
      await setMember(actor, this.selectedId, target.dataset.member !== "true");
    }

    static async #onRemoveRelation(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(
        target.closest<HTMLElement>("[data-actor-id]")?.dataset.actorId,
      );
      if (!actor || !this.selectedId) return;
      await removeRelation(actor, factionKey(this.selectedId));
    }

    static async #onRemoveNpc(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(
        target.closest<HTMLElement>("[data-actor-id]")?.dataset.actorId,
      );
      if (!actor || !this.selectedId) return;
      await removeNpcFromFaction(actor, this.selectedId);
    }

    static async #onAddActor(this: FactionManagerApp) {
      const select = this.element.querySelector(
        "select[data-tr-add-actor]",
      ) as HTMLSelectElement | null;
      const actor = game.actors.get(select?.value);
      if (!actor || !this.selectedId) return;
      await linkActorToFaction(actor, this.selectedId);
    }

    static #onOpenActor(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      game.actors
        .get(target.closest<HTMLElement>("[data-actor-id]")?.dataset.actorId)
        ?.sheet?.render(true);
    }

    static async #onRecalc() {
      const n = await recalculateAllDispositions(true);
      ui.notifications.info(t("TIDY_RENOWN.Notify.Recalculated", { n }));
    }
  }

  ManagerClass = FactionManagerApp;
  return ManagerClass;
}

/** Opens (or focuses) the singleton manager, optionally on a faction. GM only. */
export function openFactionManager(factionId?: string): void {
  if (!game.user.isGM) {
    ui.notifications.warn(t("TIDY_RENOWN.Notify.GMOnly"));
    return;
  }
  const Cls = getManagerClass();
  instance ??= new Cls();
  if (factionId !== undefined) instance.selectedId = factionId;
  instance.render({ force: true });
}

/** Settings-menu wrapper: Foundry instantiates menu types itself. */
export function getManagerMenuType(): any {
  const Cls = getManagerClass();
  return class FactionManagerMenu extends Cls {
    render() {
      openFactionManager();
      return this;
    }
  };
}

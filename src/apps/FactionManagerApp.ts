/**
 * GM faction manager (RF-01, RF-02, SPEC 7.1). ApplicationV2 + Handlebars.
 * The classes are created lazily so `foundry.applications.api` is only touched at runtime.
 *
 * Layout: a faction list, and per faction three tabs (details, ranks, members).
 * Ranks are created and edited in their own dialog; actors are added through a
 * folder-grouped picker or by drag-and-drop on the members tab.
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
import { groupByFolder } from "../data/folders.js";
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
import { factionKey, getRank, normalizeFaction, sortRanks } from "../data/rules.js";
import type { FactionDef } from "../data/types.js";
import { recalculateAllDispositions } from "../services/disposition.js";
import { rankLabel } from "../tidy/context.js";

const t = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

const KINDS = ["faction", "organization", "community"] as const;

let ManagerClass: any = null;
let instance: any = null;

function typeLabel(actor: any): string {
  return t(`TIDY_RENOWN.ActorType.${actor.type}`);
}

function enrich(html: string | undefined): Promise<string> {
  if (!html) return Promise.resolve("");
  return foundry.applications.ux.TextEditor.enrichHTML(html, { secrets: true });
}

function actorIdFrom(target: HTMLElement): string | undefined {
  return target.closest<HTMLElement>("[data-actor-id]")?.dataset.actorId;
}

/** Brings an already open app with this id to the front instead of opening a duplicate. */
function focusExisting(id: string): boolean {
  const existing = foundry.applications.instances?.get(id);
  if (!existing?.rendered) return false;
  existing.bringToFront?.();
  return true;
}

/** Live text filter over `[data-filter-text]` rows, hiding folders left empty. */
function applyFilter(root: HTMLElement, query: string): void {
  const q = query.trim().toLocaleLowerCase();
  for (const row of root.querySelectorAll<HTMLElement>("[data-filter-text]")) {
    row.hidden = !!q && !row.dataset.filterText!.includes(q);
  }
  for (const folder of root.querySelectorAll<HTMLElement>(".tr-folder")) {
    const visible = folder.querySelector("[data-filter-text]:not([hidden])");
    folder.hidden = !visible;
    if (q && visible) (folder as HTMLDetailsElement).open = true;
  }
}

function getManagerClass(): any {
  if (ManagerClass) return ManagerClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  /** Create or edit one rank. */
  class RankEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: [`${MODULE_ID}-manager`, `${MODULE_ID}-dialog`],
      tag: "form",
      window: { icon: "fa-solid fa-medal", resizable: true },
      position: { width: 520, height: "auto" },
      form: { handler: RankEditorApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
      actions: { cancel: RankEditorApp.#onCancel },
    };

    static PARTS = {
      main: { template: TEMPLATES.rankEditor },
    };

    factionId: string;
    rankId: string | null;
    manager: any;

    constructor(factionId: string, rankId: string | null, manager: any) {
      super({ id: RankEditorApp.idFor(factionId, rankId) });
      this.factionId = factionId;
      this.rankId = rankId;
      this.manager = manager;
    }

    static idFor(factionId: string, rankId: string | null): string {
      return `${MODULE_ID}-rank-${factionId}-${rankId ?? "new"}`;
    }

    get title(): string {
      return t(this.rankId ? "TIDY_RENOWN.Rank.EditTitle" : "TIDY_RENOWN.Rank.NewTitle");
    }

    async _prepareContext(options: any): Promise<any> {
      const context = await super._prepareContext(options);
      const faction = getFaction(this.factionId);
      const existing = faction?.ranks.find((r) => r.id === this.rankId);
      const nextScore =
        (faction?.ranks.reduce((max, rank) => Math.max(max, rank.minScore), -1) ?? -1) + 1;
      return {
        ...context,
        isEdit: !!existing,
        rank: existing ?? { name: "", minScore: nextScore, description: "" },
      };
    }

    static async #onSubmit(
      this: RankEditorApp,
      _event: Event,
      _form: HTMLFormElement,
      formData: any,
    ) {
      const faction = getFaction(this.factionId);
      if (!faction) return;
      const data = foundry.utils.expandObject(formData.object).rank ?? {};
      const minScore = Number(data.minScore);
      if (data.minScore === "" || !Number.isFinite(minScore)) {
        ui.notifications.warn(t("TIDY_RENOWN.Rank.InvalidScore"));
        return;
      }
      const name = String(data.name ?? "").trim();
      const description = String(data.description ?? "");
      const ranks = this.rankId
        ? faction.ranks.map((r) =>
            r.id === this.rankId ? { ...r, name, minScore, description } : r,
          )
        : [...faction.ranks, newRank(minScore, name, description)];
      await saveFaction({ ...faction, ranks });
      await this.close();
    }

    static #onCancel(this: RankEditorApp) {
      void this.close();
    }
  }

  /** Folder-grouped, searchable checklist of actors that can join a faction. */
  class ActorPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: [`${MODULE_ID}-manager`, `${MODULE_ID}-dialog`],
      tag: "form",
      window: { title: "TIDY_RENOWN.Picker.Title", icon: "fa-solid fa-user-plus", resizable: true },
      position: { width: 420, height: 560 },
      form: { handler: ActorPickerApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
      actions: { cancel: ActorPickerApp.#onCancel },
    };

    static PARTS = {
      main: { template: TEMPLATES.actorPicker, scrollable: [".tr-picker-list"] },
    };

    factionId: string;

    constructor(factionId: string) {
      super({ id: `${MODULE_ID}-picker-${factionId}` });
      this.factionId = factionId;
    }

    async _prepareContext(options: any): Promise<any> {
      const context = await super._prepareContext(options);
      const linked = new Set([
        ...getFactionRelations(this.factionId).map((r) => r.actor.id),
        ...getFactionNpcs(this.factionId).map((a: any) => a.id),
      ]);
      const actors = game.actors
        .filter((a: any) => (isScoreHolder(a) || isNpc(a)) && !linked.has(a.id))
        .map((a: any) => ({
          id: a.id,
          name: a.name,
          img: a.img,
          typeLabel: typeLabel(a),
          filterText: a.name.toLocaleLowerCase(),
          actor: a,
        }));
      const folders = groupByFolder(
        actors,
        (row: any) => row.actor,
        t("TIDY_RENOWN.Manager.UnfiledActors"),
      );
      return { ...context, folders, empty: actors.length === 0 };
    }

    async _onRender(context: any, options: any): Promise<void> {
      await super._onRender(context, options);
      const root = this.element as HTMLElement;
      const search = root.querySelector<HTMLInputElement>("[data-tr-filter]");
      search?.addEventListener("input", () => applyFilter(root, search.value));
      search?.focus();

      // Folder checkbox toggles its visible actors; actor checkboxes keep it in sync.
      root.addEventListener("change", (event) => {
        const el = event.target as HTMLInputElement;
        const folder = el.closest<HTMLElement>(".tr-folder");
        if (!folder) return;
        const boxes = [
          ...folder.querySelectorAll<HTMLInputElement>("input[name='actorIds']"),
        ].filter((box) => !box.closest<HTMLElement>("[data-filter-text]")!.hidden);
        const all = folder.querySelector<HTMLInputElement>("[data-tr-folder-all]")!;
        if (el === all) boxes.forEach((box) => (box.checked = all.checked));
        const checked = boxes.filter((box) => box.checked).length;
        all.checked = checked > 0 && checked === boxes.length;
        all.indeterminate = checked > 0 && checked < boxes.length;
        this.#updateCount();
      });
      // Clicking the folder checkbox must not collapse the folder.
      for (const all of root.querySelectorAll("[data-tr-folder-all]")) {
        all.addEventListener("click", (event) => event.stopPropagation());
      }
      this.#updateCount();
    }

    #updateCount(): void {
      const root = this.element as HTMLElement;
      const n = root.querySelectorAll("input[name='actorIds']:checked").length;
      const submit = root.querySelector<HTMLButtonElement>("button[type='submit']");
      if (!submit) return;
      submit.disabled = n === 0;
      submit.querySelector("span")!.textContent = t("TIDY_RENOWN.Picker.Add", { n });
    }

    static async #onSubmit(this: ActorPickerApp, _event: Event, form: HTMLFormElement) {
      const ids = [
        ...form.querySelectorAll<HTMLInputElement>("input[name='actorIds']:checked"),
      ].map((box) => box.value);
      for (const id of ids) {
        const actor = game.actors.get(id);
        if (actor) await linkActorToFaction(actor, this.factionId);
      }
      await this.close();
    }

    static #onCancel(this: ActorPickerApp) {
      void this.close();
    }
  }

  class FactionManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-manager`,
      classes: [`${MODULE_ID}-manager`],
      tag: "form",
      window: { title: "TIDY_RENOWN.Manager.Title", icon: "fa-solid fa-flag", resizable: true },
      position: { width: 720, height: 680 },
      form: { handler: FactionManagerApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
      actions: {
        newFaction: FactionManagerApp.#onNewFaction,
        openFaction: FactionManagerApp.#onOpenFaction,
        back: FactionManagerApp.#onBack,
        deleteFaction: FactionManagerApp.#onDeleteFaction,
        addRank: FactionManagerApp.#onAddRank,
        editRank: FactionManagerApp.#onEditRank,
        removeRank: FactionManagerApp.#onRemoveRank,
        dmgThresholds: FactionManagerApp.#onDmgThresholds,
        adjust: FactionManagerApp.#onAdjust,
        toggleMember: FactionManagerApp.#onToggleMember,
        removeRelation: FactionManagerApp.#onRemoveRelation,
        removeNpc: FactionManagerApp.#onRemoveNpc,
        addActors: FactionManagerApp.#onAddActors,
        openActor: FactionManagerApp.#onOpenActor,
        recalc: FactionManagerApp.#onRecalc,
      },
    };

    static PARTS = {
      main: { template: TEMPLATES.manager, scrollable: [".tr-tab-body"] },
    };

    static TABS = {
      primary: {
        tabs: [
          { id: "details", icon: "fa-solid fa-circle-info", label: "TIDY_RENOWN.Manager.Details" },
          { id: "ranks", icon: "fa-solid fa-medal", label: "TIDY_RENOWN.Manager.Ranks" },
          { id: "members", icon: "fa-solid fa-users", label: "TIDY_RENOWN.Manager.Members" },
        ],
        initial: "details",
      },
    };

    selectedId: string | null = null;
    /** Collapsed folder ids on the members tab, kept across re-renders. */
    collapsed = new Set<string>();
    memberFilter = "";

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
      const detail = await this.#detailContext(faction);
      const tabs = this._prepareTabs("primary");
      tabs.ranks.count = detail.ranks.length;
      tabs.members.count = detail.memberCount;
      return { ...context, isList: false, tabs, ...detail };
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

    async #detailContext(faction: FactionDef) {
      const scoreRows = getFactionRelations(faction.id).map((r) => {
        const rank = rankLabel(getRank(faction.ranks, r.entry.score));
        return {
          actor: r.actor,
          actorId: r.actor.id,
          name: r.actor.name,
          img: r.actor.img,
          subtitle: [typeLabel(r.actor), rank].filter(Boolean).join(" · "),
          filterText: r.actor.name.toLocaleLowerCase(),
          hasScore: true,
          score: r.entry.score,
          negative: r.entry.score < 0,
          member: !!r.entry.member,
        };
      });
      const npcRows = getFactionNpcs(faction.id).map((a: any) => ({
        actor: a,
        actorId: a.id,
        name: a.name,
        img: a.img,
        subtitle: t("TIDY_RENOWN.Manager.NpcMember"),
        filterText: a.name.toLocaleLowerCase(),
        hasScore: false,
      }));
      const memberFolders = groupByFolder(
        [...scoreRows, ...npcRows],
        (row) => row.actor,
        t("TIDY_RENOWN.Manager.UnfiledActors"),
      ).map((folder) => ({ ...folder, open: !this.collapsed.has(folder.id) }));

      const ranks = await Promise.all(
        sortRanks(faction.ranks).map(async (r) => ({
          id: r.id,
          minScore: r.minScore,
          name: rankLabel(r),
          descriptionHtml: await enrich(r.description),
        })),
      );
      const existingScores = new Set(faction.ranks.map((r) => r.minScore));

      return {
        faction,
        displayName: faction.name || t("TIDY_RENOWN.Faction.Unnamed"),
        kindLabel: t(`TIDY_RENOWN.Faction.Kind.${faction.kind}`),
        descriptionHtml: await enrich(faction.description),
        kinds: KINDS.map((k) => ({
          value: k,
          label: t(`TIDY_RENOWN.Faction.Kind.${k}`),
          selected: k === faction.kind,
        })),
        ranks,
        canUseDmg: !dmgThresholdRanks().every((r) => existingScores.has(r.minScore)),
        memberFolders,
        memberCount: scoreRows.length + npcRows.length,
        memberFilter: this.memberFilter,
      };
    }

    async _onRender(context: any, options: any): Promise<void> {
      await super._onRender(context, options);
      const root = this.element as HTMLElement;

      const zone = root.querySelector<HTMLElement>(".tr-dropzone");
      if (zone) {
        zone.addEventListener("dragover", (event) => {
          event.preventDefault();
          zone.classList.add("tr-drag-over");
        });
        zone.addEventListener("dragleave", (event) => {
          if (!zone.contains(event.relatedTarget as Node)) zone.classList.remove("tr-drag-over");
        });
        zone.addEventListener("drop", (event) => {
          event.preventDefault();
          zone.classList.remove("tr-drag-over");
          void this.#onDrop(event);
        });
      }

      for (const folder of root.querySelectorAll<HTMLDetailsElement>(
        ".tr-folder[data-folder-id]",
      )) {
        folder.addEventListener("toggle", () => {
          const id = folder.dataset.folderId!;
          if (folder.open) this.collapsed.delete(id);
          else this.collapsed.add(id);
        });
      }

      const filter = root.querySelector<HTMLInputElement>("[data-tr-filter]");
      if (filter) {
        filter.addEventListener("input", () => {
          this.memberFilter = filter.value;
          applyFilter(root.querySelector(".tr-member-list") ?? root, filter.value);
        });
        if (this.memberFilter)
          applyFilter(root.querySelector(".tr-member-list") ?? root, this.memberFilter);
      }
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
      return normalizeFaction({ ...stored, ...(raw.faction ?? {}), id: stored.id });
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
      this.#select(faction.id);
    }

    static #onOpenFaction(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      this.#select(target.closest<HTMLElement>("[data-faction-id]")?.dataset.factionId ?? null);
    }

    static #onBack(this: FactionManagerApp) {
      this.#select(null);
    }

    #select(factionId: string | null): void {
      if (factionId !== this.selectedId) {
        this.collapsed.clear();
        this.memberFilter = "";
        this.tabGroups.primary = "details";
      }
      this.selectedId = factionId;
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

    #openRankEditor(rankId: string | null): void {
      if (!this.selectedId) return;
      if (focusExisting(RankEditorApp.idFor(this.selectedId, rankId))) return;
      new RankEditorApp(this.selectedId, rankId, this).render({ force: true });
    }

    static #onAddRank(this: FactionManagerApp) {
      this.#openRankEditor(null);
    }

    static #onEditRank(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const rankId = target.closest<HTMLElement>("[data-rank-id]")?.dataset.rankId;
      if (rankId) this.#openRankEditor(rankId);
    }

    static async #onRemoveRank(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const faction = this.selectedId ? getFaction(this.selectedId) : null;
      const rankId = target.closest<HTMLElement>("[data-rank-id]")?.dataset.rankId;
      const rank = faction?.ranks.find((r) => r.id === rankId);
      if (!faction || !rank) return;
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("TIDY_RENOWN.Rank.Remove") },
        content: `<p>${t("TIDY_RENOWN.Rank.RemoveConfirm", {
          name: foundry.utils.escapeHTML?.(rankLabel(rank)) ?? rankLabel(rank),
        })}</p>`,
      });
      if (!confirmed) return;
      await saveFaction({ ...faction, ranks: faction.ranks.filter((r) => r.id !== rankId) });
    }

    static async #onDmgThresholds(this: FactionManagerApp) {
      const faction = this.selectedId ? getFaction(this.selectedId) : null;
      if (!faction) return;
      const existing = new Set(faction.ranks.map((r) => r.minScore));
      faction.ranks.push(...dmgThresholdRanks().filter((r) => !existing.has(r.minScore)));
      await saveFaction(faction);
    }

    static async #onAdjust(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(actorIdFrom(target));
      if (!actor || !this.selectedId) return;
      await adjustScore(actor, factionKey(this.selectedId), Number(target.dataset.delta));
    }

    static async #onToggleMember(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(actorIdFrom(target));
      if (!actor || !this.selectedId) return;
      await setMember(actor, this.selectedId, target.dataset.member !== "true");
    }

    static async #onRemoveRelation(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(actorIdFrom(target));
      if (!actor || !this.selectedId) return;
      await removeRelation(actor, factionKey(this.selectedId));
    }

    static async #onRemoveNpc(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(actorIdFrom(target));
      if (!actor || !this.selectedId) return;
      await removeNpcFromFaction(actor, this.selectedId);
    }

    static #onAddActors(this: FactionManagerApp) {
      if (!this.selectedId) return;
      if (focusExisting(`${MODULE_ID}-picker-${this.selectedId}`)) return;
      new ActorPickerApp(this.selectedId).render({ force: true });
    }

    static #onOpenActor(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      game.actors.get(actorIdFrom(target))?.sheet?.render(true);
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
  if (factionId !== undefined && factionId !== instance.selectedId) {
    instance.selectedId = factionId;
    instance.tabGroups.primary = "details";
  }
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

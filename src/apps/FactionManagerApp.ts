/**
 * GM faction manager (RF-01, RF-02, SPEC 7.1). ApplicationV2 + Handlebars.
 * The classes are created lazily so `foundry.applications.api` is only touched at runtime.
 *
 * Layout: a sidebar with the factions and, for the selected one, three tabs
 * (details, ranks, members). Ranks are created and edited in their own dialog;
 * actors are added through a folder-grouped picker or by drag-and-drop on the
 * members tab, where several can be selected and adjusted at once.
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
  getRelations,
  isNpc,
  isScoreHolder,
  linkActorToFaction,
  removeNpcFromFaction,
  removeRelation,
  setMember,
  setScore,
} from "../data/renown.js";
import {
  duplicateRankScores,
  factionKey,
  getRank,
  normalizeFaction,
  sortRanks,
} from "../data/rules.js";
import type { FactionDef } from "../data/types.js";
import { recalculateAllDispositions } from "../services/disposition.js";
import { rankLabel } from "../tidy/context.js";
import { openNotesEditor } from "./NotesEditorApp.js";

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

/**
 * Wires "select the whole folder" checkboxes to the `[data-tr-pick]` boxes of each
 * `.tr-folder` inside `container`; rows hidden by the filter are left alone.
 * Bind to an element that is replaced on render, never to the app's form.
 */
function bindFolderChecks(container: HTMLElement, onChange: () => void): void {
  const sync = (folder: HTMLElement, from?: HTMLInputElement) => {
    const all = folder.querySelector<HTMLInputElement>("[data-tr-folder-all]");
    if (!all) return;
    const boxes = [...folder.querySelectorAll<HTMLInputElement>("[data-tr-pick]")].filter(
      (box) => !box.closest<HTMLElement>("[data-filter-text]")?.hidden,
    );
    if (from === all) boxes.forEach((box) => (box.checked = all.checked));
    const checked = boxes.filter((box) => box.checked).length;
    all.checked = checked > 0 && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  };
  container.addEventListener("change", (event) => {
    const el = event.target as HTMLInputElement;
    if (!el.matches("[data-tr-pick], [data-tr-folder-all]")) return;
    const folder = el.closest<HTMLElement>(".tr-folder");
    if (folder) sync(folder, el);
    onChange();
  });
  // Clicking the folder checkbox must not collapse the folder.
  for (const all of container.querySelectorAll("[data-tr-folder-all]")) {
    all.addEventListener("click", (event) => event.stopPropagation());
  }
  container.querySelectorAll<HTMLElement>(".tr-folder").forEach((folder) => sync(folder));
}

function checkedPicks(container: ParentNode): string[] {
  return [...container.querySelectorAll<HTMLInputElement>("[data-tr-pick]:checked")].map(
    (box) => box.value,
  );
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
      if (faction.ranks.some((r) => r.id !== this.rankId && r.minScore === Math.trunc(minScore))) {
        ui.notifications.warn(
          t("TIDY_RENOWN.Rank.DuplicateScore", { score: Math.trunc(minScore) }),
        );
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
      const root = this.element.querySelector(".tr-dialog") as HTMLElement;
      const search = root.querySelector<HTMLInputElement>("[data-tr-filter]");
      search?.addEventListener("input", () => applyFilter(root, search.value));
      search?.focus();
      bindFolderChecks(root, () => this.#updateCount());
      this.#updateCount();
    }

    #updateCount(): void {
      const root = this.element as HTMLElement;
      const n = checkedPicks(root).length;
      const submit = root.querySelector<HTMLButtonElement>("button[type='submit']");
      if (!submit) return;
      submit.disabled = n === 0;
      submit.querySelector("span")!.textContent = t("TIDY_RENOWN.Picker.Add", { n });
    }

    static async #onSubmit(this: ActorPickerApp, _event: Event, form: HTMLFormElement) {
      for (const id of checkedPicks(form)) {
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
      position: { width: 900, height: 680 },
      form: { handler: FactionManagerApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
      actions: {
        newFaction: FactionManagerApp.#onNewFaction,
        openFaction: FactionManagerApp.#onOpenFaction,
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
        editNotes: FactionManagerApp.#onEditNotes,
        bulkAdjust: FactionManagerApp.#onBulkAdjust,
        bulkMember: FactionManagerApp.#onBulkMember,
        bulkClear: FactionManagerApp.#onBulkClear,
        openActor: FactionManagerApp.#onOpenActor,
        recalc: FactionManagerApp.#onRecalc,
      },
    };

    static PARTS = {
      main: { template: TEMPLATES.manager, scrollable: [".tr-tab-body", ".tr-faction-list"] },
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
    /** Actor ids checked on the members tab for bulk actions. */
    selected = new Set<string>();
    bulkDelta = 1;

    get title(): string {
      const faction = this.selectedId ? getFaction(this.selectedId) : null;
      const base = t("TIDY_RENOWN.Manager.Title");
      return faction ? `${base}: ${faction.name}` : base;
    }

    async _prepareContext(options: any): Promise<any> {
      const context = await super._prepareContext(options);
      const factions = this.#listContext();
      let faction = this.selectedId ? getFaction(this.selectedId) : null;
      if (!faction && factions.length) {
        this.resetView();
        faction = getFaction(factions[0].id);
      }
      this.selectedId = faction?.id ?? null;
      for (const f of factions) f.active = f.id === this.selectedId;
      if (!faction) return { ...context, factions, hasFaction: false };

      const detail = await this.#detailContext(faction);
      const tabs = this._prepareTabs("primary");
      tabs.ranks.count = detail.ranks.length;
      tabs.members.count = detail.memberCount;
      return { ...context, factions, hasFaction: true, tabs, ...detail };
    }

    #listContext() {
      return getFactions().map((f) => ({
        active: false,
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
      const relations = getFactionRelations(faction.id);
      const linkedIds = new Set(relations.map((r) => r.actor.id));
      for (const id of this.selected) if (!linkedIds.has(id)) this.selected.delete(id);

      const scoreRows = relations.map((r) => {
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
          hasNotes: !!r.entry.notes,
          selected: this.selected.has(r.actor.id),
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
      ).map((folder) => ({
        ...folder,
        open: !this.collapsed.has(folder.id),
        hasScoreRows: folder.actors.some((row) => row.hasScore),
      }));

      const duplicates = duplicateRankScores(faction.ranks);
      const ranks = await Promise.all(
        sortRanks(faction.ranks).map(async (r) => ({
          id: r.id,
          minScore: r.minScore,
          duplicate: duplicates.has(r.minScore),
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
        hasDuplicateRanks: duplicates.size > 0,
        canUseDmg: !dmgThresholdRanks().every((r) => existingScores.has(r.minScore)),
        memberFolders,
        memberCount: scoreRows.length + npcRows.length,
        memberFilter: this.memberFilter,
        selectedCount: this.selected.size,
        bulkDelta: this.bulkDelta,
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

      const list = root.querySelector<HTMLElement>(".tr-member-list");
      const filter = root.querySelector<HTMLInputElement>("[data-tr-filter]");
      if (list && filter) {
        filter.addEventListener("input", () => {
          this.memberFilter = filter.value;
          applyFilter(list, filter.value);
        });
        if (this.memberFilter) applyFilter(list, this.memberFilter);
      }
      if (list) {
        bindFolderChecks(list, () => {
          this.selected = new Set(checkedPicks(list));
          this.#updateBulkBar();
        });
      }
      root
        .querySelector<HTMLInputElement>("[data-tr-bulk-delta]")
        ?.addEventListener("change", (e) => {
          this.bulkDelta = this.#readBulkDelta(e.target as HTMLInputElement);
        });
    }

    #updateBulkBar(): void {
      const bar = this.element.querySelector(".tr-bulk-bar") as HTMLElement | null;
      if (!bar) return;
      bar.hidden = this.selected.size === 0;
      bar.querySelector("[data-tr-bulk-count]")!.textContent = t("TIDY_RENOWN.Bulk.Selected", {
        n: this.selected.size,
      });
    }

    #readBulkDelta(input: HTMLInputElement | null): number {
      const value = Math.trunc(Math.abs(Number(input?.value)));
      return Number.isFinite(value) && value > 0 ? value : 1;
    }

    /** Runs `fn` for every selected actor that still has an entry for this faction. */
    async #forSelected(fn: (actor: any, key: string) => Promise<unknown>): Promise<void> {
      if (!this.selectedId) return;
      const key = factionKey(this.selectedId);
      for (const id of this.selected) {
        const actor = game.actors.get(id);
        if (actor && key in getRelations(actor)) await fn(actor, key);
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

    #select(factionId: string | null): void {
      if (factionId !== this.selectedId) this.resetView();
      this.selectedId = factionId;
      this.render();
    }

    /** Per-faction view state goes back to its defaults when another faction is shown. */
    resetView(): void {
      this.collapsed.clear();
      this.memberFilter = "";
      this.selected.clear();
      this.tabGroups.primary = "details";
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
      // Fall back to the neighbour in the sidebar (the next one, else the previous).
      const ids = getFactions().map((f) => f.id);
      const index = ids.indexOf(faction.id);
      const neighbour = ids[index + 1] ?? ids[index - 1] ?? null;
      await deleteFaction(faction.id);
      this.#select(neighbour);
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

    static #onEditNotes(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const actor = game.actors.get(actorIdFrom(target));
      if (actor && this.selectedId) openNotesEditor(actor, factionKey(this.selectedId));
    }

    static async #onBulkAdjust(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const input = this.element.querySelector("[data-tr-bulk-delta]") as HTMLInputElement | null;
      this.bulkDelta = this.#readBulkDelta(input);
      const delta = this.bulkDelta * Math.sign(Number(target.dataset.sign) || 1);
      await this.#forSelected((actor, key) => adjustScore(actor, key, delta));
    }

    static async #onBulkMember(this: FactionManagerApp, _event: Event, target: HTMLElement) {
      const member = target.dataset.member === "true";
      await this.#forSelected((actor) => setMember(actor, this.selectedId!, member));
    }

    static #onBulkClear(this: FactionManagerApp) {
      this.selected.clear();
      this.render();
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
    instance.resetView();
    instance.selectedId = factionId;
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

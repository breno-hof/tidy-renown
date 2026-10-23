/**
 * Event handling for the Renown tabs. Uses `data-tr-*` attributes (not
 * `data-action`) so ApplicationV2 does not try to route the clicks.
 */
import { openFactionManager } from "../apps/FactionManagerApp.js";
import {
  addNpcToFaction,
  adjustScore,
  ensureRelation,
  removeNpcFromFaction,
  removeRelation,
  setMember,
  setNotes,
  setScore,
} from "../data/renown.js";
import { factionKey, npcKey } from "../data/rules.js";
import { recalculateAllDispositions, setNpcDispositionLock } from "../services/disposition.js";
import { requestIncrease } from "../services/socket.js";

const BOUND = "trBound";

/** Open "details" sections per actor, so re-renders after a score change keep them open. */
const openDetails = new Set<string>();

function sheetActor(app: any): any {
  return app?.actor ?? app?.document ?? null;
}

/** Row-level actor (data-actor-id inside our tab) or the sheet's own actor. */
function targetActor(el: HTMLElement, root: HTMLElement, fallback: any): any {
  const row = el.closest<HTMLElement>("[data-actor-id]");
  const id = row && root.contains(row) ? row.dataset.actorId : undefined;
  return id ? game.actors.get(id) : fallback;
}

async function guarded(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    ui.notifications.error(game.i18n.localize("TIDY_RENOWN.Notify.Error"));
  }
}

function selectedValue(root: HTMLElement, name: string): string {
  return root.querySelector<HTMLSelectElement>(`select[data-tr-select="${name}"]`)?.value ?? "";
}

export function bindRenownControls(root: HTMLElement | null | undefined, app: any): void {
  if (!root) return;
  const actorId = sheetActor(app)?.id ?? "";
  for (const details of root.querySelectorAll<HTMLDetailsElement>("details[data-tr-details]")) {
    if (openDetails.has(`${actorId}:${details.dataset.trDetails}`)) details.open = true;
  }
  if (root.dataset[BOUND]) return;
  root.dataset[BOUND] = "1";

  // `toggle` does not bubble, so listen in the capture phase.
  root.addEventListener(
    "toggle",
    (event) => {
      const details = event.target as HTMLElement;
      if (!(details instanceof HTMLDetailsElement) || !details.dataset.trDetails) return;
      const id = `${sheetActor(app)?.id ?? ""}:${details.dataset.trDetails}`;
      if (details.open) openDetails.add(id);
      else openDetails.delete(id);
    },
    true,
  );

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-tr-action]");
    if (!button || !root.contains(button) || (button as HTMLButtonElement).disabled) return;
    event.preventDefault();
    event.stopPropagation();
    void onAction(button, root, sheetActor(app));
  });

  root.addEventListener("change", (event) => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!el.matches("[data-tr-score], [data-tr-notes], [data-tr-select]")) return;
    // Keep our controls out of the sheet's own form submission.
    event.stopPropagation();
    if (!game.user.isGM || el.matches("[data-tr-select]")) return;
    const actor = targetActor(el, root, sheetActor(app));
    const key = el.dataset.key;
    if (!actor || !key) return;
    if (el.matches("[data-tr-score]")) {
      void guarded(() => setScore(actor, key, Number(el.value)));
    } else if (el.matches("[data-tr-notes]")) {
      void guarded(() => setNotes(actor, key, el.value));
    }
  });
}

async function onAction(el: HTMLElement, root: HTMLElement, sheet: any): Promise<void> {
  const action = el.dataset.trAction;
  const actor = targetActor(el, root, sheet);
  const key = el.dataset.key ?? "";
  const factionId = el.dataset.factionId ?? "";

  // Player-facing action first; everything else is GM-only.
  if (action === "increase") {
    if (game.user.isGM) await guarded(() => adjustScore(actor, key, 1));
    else requestIncrease(actor, key);
    return;
  }
  if (action === "open-actor") {
    game.actors.get(el.dataset.openId ?? "")?.sheet?.render(true);
    return;
  }
  if (!game.user.isGM) return;

  switch (action) {
    case "manage":
      openFactionManager(factionId || undefined);
      return;
    case "adjust":
      return guarded(() => adjustScore(actor, key, Number(el.dataset.delta)));
    case "toggle-member":
      return guarded(() => setMember(actor, factionId, el.dataset.member !== "true"));
    case "remove":
      return guarded(() => removeRelation(actor, key));
    case "add-faction": {
      const id = selectedValue(root, "faction");
      if (id) return guarded(() => ensureRelation(sheet, factionKey(id), { member: true }));
      return;
    }
    case "add-npc": {
      const id = selectedValue(root, "npc");
      if (id) return guarded(() => ensureRelation(sheet, npcKey(id)));
      return;
    }
    case "npc-add-faction": {
      const id = selectedValue(root, "npc-faction");
      if (id) return guarded(() => addNpcToFaction(sheet, id));
      return;
    }
    case "npc-remove-faction":
      return guarded(() => removeNpcFromFaction(sheet, factionId));
    case "npc-add-relation": {
      const charId = selectedValue(root, "character");
      const npcId = el.dataset.npcId ?? "";
      const character = game.actors.get(charId);
      if (character && npcId) return guarded(() => ensureRelation(character, npcKey(npcId)));
      return;
    }
    case "toggle-lock":
      return guarded(() => setNpcDispositionLock(sheet, el.dataset.locked !== "true"));
    case "recalc":
      return guarded(async () => {
        const n = await recalculateAllDispositions(true);
        ui.notifications.info(game.i18n.format("TIDY_RENOWN.Notify.Recalculated", { n }));
      });
  }
}

/**
 * GM dialog to edit the notes of one relation entry with Foundry's rich text editor.
 * The class is created lazily so `foundry.applications.api` is only touched at runtime.
 */
import { MODULE_ID, TEMPLATES } from "../constants.js";
import { getFaction } from "../data/factions.js";
import { getRelations, setNotes } from "../data/renown.js";
import { idFromKey, isFactionKey } from "../data/rules.js";

const t = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

let NotesClass: any = null;

/** Notes written before the rich editor were plain text; keep their line breaks. */
export function notesToHtml(notes: string): string {
  if (!notes || /<[a-z][\s\S]*>/i.test(notes)) return notes;
  const escape = foundry.utils.escapeHTML ?? ((s: string) => s);
  return notes
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function getNotesClass(): any {
  if (NotesClass) return NotesClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  class NotesEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      classes: [`${MODULE_ID}-manager`, `${MODULE_ID}-dialog`],
      tag: "form",
      window: { icon: "fa-solid fa-note-sticky", resizable: true },
      position: { width: 520, height: "auto" },
      form: { handler: NotesEditorApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
      actions: { cancel: NotesEditorApp.#onCancel },
    };

    static PARTS = {
      main: { template: TEMPLATES.notesEditor },
    };

    actorId: string;
    key: string;

    constructor(actorId: string, key: string) {
      super({ id: NotesEditorApp.idFor(actorId, key) });
      this.actorId = actorId;
      this.key = key;
    }

    static idFor(actorId: string, key: string): string {
      return `${MODULE_ID}-notes-${actorId}-${key}`;
    }

    get title(): string {
      const actor = game.actors.get(this.actorId);
      const target = isFactionKey(this.key)
        ? getFaction(idFromKey(this.key))?.name
        : game.actors.get(idFromKey(this.key))?.name;
      return t("TIDY_RENOWN.Notes.Title", { actor: actor?.name ?? "", target: target ?? "" });
    }

    async _prepareContext(options: any): Promise<any> {
      const context = await super._prepareContext(options);
      const actor = game.actors.get(this.actorId);
      const notes = actor ? (getRelations(actor)[this.key]?.notes ?? "") : "";
      return { ...context, notes: notesToHtml(notes) };
    }

    static async #onSubmit(
      this: NotesEditorApp,
      _event: Event,
      _form: HTMLFormElement,
      formData: any,
    ) {
      const actor = game.actors.get(this.actorId);
      if (!actor) return;
      await setNotes(actor, this.key, String(formData.object.notes ?? ""));
      await this.close();
    }

    static #onCancel(this: NotesEditorApp) {
      void this.close();
    }
  }

  NotesClass = NotesEditorApp;
  return NotesClass;
}

/** Opens (or focuses) the notes editor for one relation entry. GM only. */
export function openNotesEditor(actor: any, key: string): void {
  if (!game.user.isGM || !actor || !key) return;
  const Cls = getNotesClass();
  const existing = foundry.applications.instances?.get(Cls.idFor(actor.id, key));
  if (existing?.rendered) {
    existing.bringToFront?.();
    return;
  }
  new Cls(actor.id, key).render({ force: true });
}

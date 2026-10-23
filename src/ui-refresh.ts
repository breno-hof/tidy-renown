import { MODULE_ID } from "./constants.js";

/**
 * Re-renders open actor sheets and the faction manager after data that is not
 * stored on the actor itself changes (faction definitions, settings).
 * Actor flag updates already re-render their own sheet.
 */
export function rerenderRenownViews(): void {
  const instances: Map<string, any> | undefined = foundry.applications?.instances;
  if (!instances) return;
  for (const app of instances.values()) {
    const isActorSheet = app.document?.documentName === "Actor";
    // Only the manager itself: its dialogs (rank editor, actor picker) hold unsaved input.
    const isManager = app.id === `${MODULE_ID}-manager`;
    if ((isActorSheet || isManager) && app.rendered) app.render();
  }
}

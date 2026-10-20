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
    const isManager = app.options?.classes?.includes(`${MODULE_ID}-manager`);
    if ((isActorSheet || isManager) && app.rendered) app.render();
  }
}

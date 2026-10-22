/**
 * Tidy 5e Sheets integration through the official API only (SPEC 5.2).
 * Tabs: character, party (group) and NPC.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import { getSetting } from "../settings.js";
import { buildNpcContext, buildScoreHolderContext } from "./context.js";
import { bindRenownControls } from "./controls.js";

function actorFrom(context: any): any {
  return context?.actor ?? context?.document ?? null;
}

export function registerTidyTabs(api: any): void {
  const scoreHolderTab = (tabId: string) =>
    new api.models.HandlebarsTab({
      title: "TIDY_RENOWN.TabTitle",
      iconClass: "fa-solid fa-flag",
      tabId,
      path: `/${TEMPLATES.actorTab}`,
      tabContentsClasses: [`${MODULE_ID}-tab`],
      getData: async (context: any) => {
        const actor = actorFrom(context);
        return { ...context, tidyRenown: actor ? await buildScoreHolderContext(actor) : null };
      },
      onRender: (params: any) => bindRenownControls(params.tabContentsElement, params.app),
    });

  api.registerCharacterTab(scoreHolderTab(`${MODULE_ID}-character`));
  api.registerGroupTab(scoreHolderTab(`${MODULE_ID}-group`));

  api.registerNpcTab(
    new api.models.HandlebarsTab({
      title: "TIDY_RENOWN.TabTitle",
      iconClass: "fa-solid fa-flag",
      tabId: `${MODULE_ID}-npc`,
      path: `/${TEMPLATES.npcTab}`,
      tabContentsClasses: [`${MODULE_ID}-tab`],
      enabled: () => game.user.isGM || !!getSetting<boolean>(SETTINGS.showNpcRelationsToPlayers),
      getData: async (context: any) => {
        const actor = actorFrom(context);
        return { ...context, tidyRenown: actor ? buildNpcContext(actor) : null };
      },
      onRender: (params: any) => bindRenownControls(params.tabContentsElement, params.app),
    }),
  );
}

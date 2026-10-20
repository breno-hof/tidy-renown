import { getManagerMenuType, openFactionManager } from "./apps/FactionManagerApp.js";
import { MODULE_ID, TEMPLATES, TIDY_ID } from "./constants.js";
import { getFactions } from "./data/factions.js";
import { getMembers, invalidateMembershipIndex } from "./data/membership-index.js";
import { getRelations } from "./data/renown.js";
import {
  computeNpcStanding,
  recalculateAllDispositions,
  scheduleDispositionRecalc,
} from "./services/disposition.js";
import { registerSocket } from "./services/socket.js";
import { registerSettings } from "./settings.js";
import { registerTidyTabs } from "./tidy/register-tabs.js";
import { rerenderRenownViews } from "./ui-refresh.js";

function tidyActive(): boolean {
  return !!game.modules.get(TIDY_ID)?.active;
}

Hooks.once("init", () => {
  registerSettings();

  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "TIDY_RENOWN.Manager.Title",
    label: "TIDY_RENOWN.Manager.Open",
    hint: "TIDY_RENOWN.Manager.Hint",
    icon: "fa-solid fa-flag",
    type: getManagerMenuType(),
    restricted: true,
  });

  void foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});

// Fired by Tidy 5e Sheets when its API is ready; never fires if Tidy is inactive.
Hooks.once("tidy5e-sheet.ready", (api: any) => {
  try {
    registerTidyTabs(api);
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register Tidy tabs`, err);
  }
});

Hooks.once("ready", () => {
  if (!tidyActive()) {
    ui.notifications.error(game.i18n.localize("TIDY_RENOWN.Notify.TidyMissing"), {
      permanent: true,
    });
    console.error(`${MODULE_ID} | Tidy 5e Sheets is not active; the module is disabled.`);
    return;
  }

  registerSocket();
  registerDataHooks();
  registerDirectoryButton();

  const module = game.modules.get(MODULE_ID);
  module.api = {
    openManager: openFactionManager,
    getFactions,
    getMembers,
    getRelations,
    computeNpcStanding,
    recalculateDispositions: () => recalculateAllDispositions(true),
  };

  ui.actors?.render();
  scheduleDispositionRecalc();
});

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleViewsRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    rerenderRenownViews();
  }, 100);
}

function registerDataHooks(): void {
  const onActorChange = () => {
    invalidateMembershipIndex();
    scheduleViewsRefresh();
    scheduleDispositionRecalc();
  };

  Hooks.on("createActor", onActorChange);
  Hooks.on("deleteActor", onActorChange);
  Hooks.on("updateActor", (_actor: any, changes: any) => {
    const touchesRenown = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`);
    const touchesParty = foundry.utils.hasProperty(changes, "system.members");
    const touchesOwnership = "ownership" in (changes ?? {});
    if (touchesRenown || touchesParty || touchesOwnership) onActorChange();
  });

  Hooks.on("createToken", () => scheduleDispositionRecalc());
  Hooks.on("updateToken", (_token: any, changes: any) => {
    // Unlinked tokens keep their own memberOf in the actor delta.
    if (foundry.utils.hasProperty(changes, `delta.flags.${MODULE_ID}`)) {
      scheduleViewsRefresh();
      scheduleDispositionRecalc();
    }
  });
  Hooks.on("updateSetting", (setting: any) => {
    if (setting?.key === "dnd5e.primaryParty") onActorChange();
  });
}

function registerDirectoryButton(): void {
  Hooks.on("renderActorDirectory", (_app: any, html: HTMLElement) => {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : (html as any)?.[0];
    const actions = root?.querySelector(".header-actions");
    if (!actions || actions.querySelector(`.${MODULE_ID}-open`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${MODULE_ID}-open`;
    button.innerHTML = `<i class="fa-solid fa-flag" inert></i> ${game.i18n.localize("TIDY_RENOWN.Manager.Button")}`;
    button.addEventListener("click", () => openFactionManager());
    actions.append(button);
  });
}

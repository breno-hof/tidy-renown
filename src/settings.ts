import { MODULE_ID, SETTINGS } from "./constants.js";
import { invalidateMembershipIndex } from "./data/membership-index.js";
import { scheduleDispositionRecalc } from "./services/disposition.js";
import { rerenderRenownViews } from "./ui-refresh.js";

export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.factions, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      invalidateMembershipIndex();
      rerenderRenownViews();
      scheduleDispositionRecalc();
    },
  });

  game.settings.register(MODULE_ID, SETTINGS.playersCanIncrease, {
    name: "TIDY_RENOWN.Settings.PlayersCanIncrease.Name",
    hint: "TIDY_RENOWN.Settings.PlayersCanIncrease.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => rerenderRenownViews(),
  });

  game.settings.register(MODULE_ID, SETTINGS.autoDisposition, {
    name: "TIDY_RENOWN.Settings.AutoDisposition.Name",
    hint: "TIDY_RENOWN.Settings.AutoDisposition.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => scheduleDispositionRecalc(),
  });

  game.settings.register(MODULE_ID, SETTINGS.hostileThreshold, {
    name: "TIDY_RENOWN.Settings.HostileThreshold.Name",
    hint: "TIDY_RENOWN.Settings.HostileThreshold.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: -10,
    onChange: () => {
      rerenderRenownViews();
      scheduleDispositionRecalc();
    },
  });

  game.settings.register(MODULE_ID, SETTINGS.friendlyThreshold, {
    name: "TIDY_RENOWN.Settings.FriendlyThreshold.Name",
    hint: "TIDY_RENOWN.Settings.FriendlyThreshold.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 10,
    onChange: () => {
      rerenderRenownViews();
      scheduleDispositionRecalc();
    },
  });

  game.settings.register(MODULE_ID, SETTINGS.showNpcRelationsToPlayers, {
    name: "TIDY_RENOWN.Settings.ShowNpcRelations.Name",
    hint: "TIDY_RENOWN.Settings.ShowNpcRelations.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => rerenderRenownViews(),
  });
}

export function getSetting<T = unknown>(key: (typeof SETTINGS)[keyof typeof SETTINGS]): T {
  return game.settings.get(MODULE_ID, key) as T;
}

export function getThresholds(): { hostile: number; friendly: number } {
  return {
    hostile: Number(getSetting(SETTINGS.hostileThreshold)),
    friendly: Number(getSetting(SETTINGS.friendlyThreshold)),
  };
}

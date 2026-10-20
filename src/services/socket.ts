/**
 * Player +1 requests (RF-03). Players never write renown data themselves:
 * they ask the active GM, who revalidates everything before writing.
 */
import { MODULE_ID, SETTINGS, SOCKET_NAME } from "../constants.js";
import { getFaction } from "../data/factions.js";
import { getRelations, isScoreHolder, setScore } from "../data/renown.js";
import { canPlayerIncrease, idFromKey, isFactionKey, isNpcKey } from "../data/rules.js";
import { getSetting } from "../settings.js";

interface IncreaseRequest {
  type: "increase";
  actorUuid: string;
  key: string;
  userId: string;
}

function isIncreaseRequest(data: any): data is IncreaseRequest {
  return (
    data?.type === "increase" &&
    typeof data.actorUuid === "string" &&
    typeof data.key === "string" &&
    typeof data.userId === "string"
  );
}

export function registerSocket(): void {
  game.socket.on(SOCKET_NAME, (data: unknown, senderId?: string) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!isIncreaseRequest(data)) return;
    // Trust the transport's sender id when available, not the payload.
    const userId = typeof senderId === "string" ? senderId : data.userId;
    void handleIncrease(data, userId);
  });
}

/** GM side: validates and applies a +1. Returns an error reason or null. */
export async function handleIncrease(
  data: IncreaseRequest,
  userId: string,
): Promise<string | null> {
  const user = game.users.get(userId);
  const actor = fromUuidSync(data.actorUuid);
  if (!user || !actor || !isScoreHolder(actor)) return "invalid";
  if (!isFactionKey(data.key) && !isNpcKey(data.key)) return "invalid";

  const result = canPlayerIncrease({
    enabled: !!getSetting<boolean>(SETTINGS.playersCanIncrease),
    isOwner: actor.testUserPermission(user, "OWNER"),
    entry: getRelations(actor)[data.key],
    cap: isFactionKey(data.key) ? (getFaction(idFromKey(data.key))?.cap ?? null) : null,
  });
  if (!result.ok) {
    console.warn(`${MODULE_ID} | rejected +1 from ${user.name}: ${result.reason}`);
    return result.reason;
  }
  await setScore(actor, data.key, result.newScore);
  return null;
}

/** Player side: asks the active GM for a +1. */
export function requestIncrease(actor: any, key: string): void {
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("TIDY_RENOWN.Notify.NoGM"));
    return;
  }
  const payload: IncreaseRequest = {
    type: "increase",
    actorUuid: actor.uuid,
    key,
    userId: game.user.id,
  };
  game.socket.emit(SOCKET_NAME, payload);
}

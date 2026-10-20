import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { MODULE_ID, SETTINGS } from "../src/constants.js";
import { createFaction, deleteFaction, getFaction, saveFaction } from "../src/data/factions.js";
import {
  getFactionRelations,
  getMembers,
  invalidateMembershipIndex,
} from "../src/data/membership-index.js";
import {
  addNpcToFaction,
  adjustScore,
  ensureRelation,
  getNpcFactionIds,
  getRelations,
  setMember,
  setScore,
} from "../src/data/renown.js";
import { factionKey, npcKey } from "../src/data/rules.js";
import {
  computeNpcStanding,
  recalculateAllDispositions,
  setNpcDispositionLock,
} from "../src/services/disposition.js";
import { handleIncrease, registerSocket, requestIncrease } from "../src/services/socket.js";
import { registerSettings } from "../src/settings.js";
import {
  DISPOSITIONS,
  FakeActor,
  FakeScene,
  FakeToken,
  installFoundryMock,
  type MockWorld,
} from "./helpers/foundry-mock.js";

let world: MockWorld;
const g = globalThis as any;

function setup() {
  world = installFoundryMock();
  registerSettings();
  invalidateMembershipIndex();
  g.Hooks.on("updateActor", () => invalidateMembershipIndex());
}

function addActor(id: string, type: string, owners: string[] = []) {
  const actor = new FakeActor({ id, type, owners });
  world.actors.push(actor);
  invalidateMembershipIndex();
  return actor;
}

describe("renown writes (RF-02, SPEC 2.5)", () => {
  beforeEach(setup);

  it("keeps members at 0 or above and lets non-members go negative", async () => {
    const guild = await createFaction("Guild");
    const hero = addActor("hero", "character", ["p1"]);

    await setMember(hero, guild.id, true);
    assert.equal(await adjustScore(hero, factionKey(guild.id), -5), 0);

    await setMember(hero, guild.id, false);
    assert.equal(await adjustScore(hero, factionKey(guild.id), -5), -5);

    await setMember(hero, guild.id, true);
    assert.equal(getRelations(hero)[factionKey(guild.id)].score, 0, "joining lifts to 0");
  });

  it("respects the optional cap", async () => {
    const guild = await createFaction("Guild");
    await saveFaction({ ...getFaction(guild.id)!, cap: 20 });
    const hero = addActor("hero", "character");
    await setMember(hero, guild.id, true);
    assert.equal(await setScore(hero, factionKey(guild.id), 99), 20);
  });

  it("allows negative individual relations with NPCs", async () => {
    const hero = addActor("hero", "character");
    addActor("bandit", "npc");
    await ensureRelation(hero, npcKey("bandit"));
    assert.equal(await adjustScore(hero, npcKey("bandit"), -14), -14);
  });

  it("refuses writes from players", async () => {
    const guild = await createFaction("Guild");
    const hero = addActor("hero", "character", ["p1"]);
    world.setUser("p1", false);
    await assert.rejects(() => setScore(hero, factionKey(guild.id), 5));
    await assert.rejects(() => createFaction("Nope"));
  });
});

describe("runtime membership (RF-07)", () => {
  beforeEach(setup);

  it("derives members only from actor flags", async () => {
    const guild = await createFaction("Guild");
    const hero = addActor("hero", "character");
    const rival = addActor("rival", "character");
    const clerk = addActor("clerk", "npc");

    await setMember(hero, guild.id, true);
    await ensureRelation(rival, factionKey(guild.id)); // relation, not member
    await addNpcToFaction(clerk, guild.id);

    assert.deepEqual(
      getMembers(guild.id).map((a: any) => a.id),
      ["hero", "clerk"],
    );
    assert.equal(getFactionRelations(guild.id).length, 2);
    const stored = world.settings.get(`${MODULE_ID}.${SETTINGS.factions}`) as any;
    assert.equal(stored[guild.id].members, undefined, "no member list persisted on the faction");
  });

  it("removes every actor entry when a faction is deleted", async () => {
    const guild = await createFaction("Guild");
    const hero = addActor("hero", "character");
    const clerk = addActor("clerk", "npc");
    await setMember(hero, guild.id, true);
    await addNpcToFaction(clerk, guild.id);

    await deleteFaction(guild.id);

    assert.equal(getFaction(guild.id), null);
    assert.equal(factionKey(guild.id) in getRelations(hero), false);
    assert.deepEqual(getNpcFactionIds(clerk), []);
  });
});

describe("automatic disposition (SPEC 2.6)", () => {
  beforeEach(setup);

  async function cultScenario(scores: number[]) {
    const cult = await createFaction("Cult");
    const chars = scores.map((_s, i) => addActor(`pc${i}`, "character", ["p1"]));
    for (const [i, c] of chars.entries()) {
      await ensureRelation(c, factionKey(cult.id));
      await setScore(c, factionKey(cult.id), scores[i]);
    }
    const acolyte = addActor("acolyte", "npc");
    await addNpcToFaction(acolyte, cult.id);
    const scene = new FakeScene("s1");
    scene.tokens.push(
      new FakeToken("t-open", acolyte, DISPOSITIONS.NEUTRAL),
      new FakeToken("t-secret", acolyte, DISPOSITIONS.SECRET),
      new FakeToken("t-locked", acolyte, DISPOSITIONS.NEUTRAL),
    );
    scene.tokens.get("t-locked")!.flags[MODULE_ID] = { lockDisposition: true };
    world.scenes.push(scene);
    return { cult, chars, acolyte, scene };
  }

  it("turns NPC members hostile below -10 (party average)", async () => {
    const { acolyte, scene } = await cultScenario([-20, -4]); // average -12
    assert.equal(computeNpcStanding(acolyte).score, -12);

    await recalculateAllDispositions(true);

    assert.equal(acolyte.prototypeToken.disposition, DISPOSITIONS.HOSTILE);
    assert.equal(scene.tokens.get("t-open")!.disposition, DISPOSITIONS.HOSTILE);
    assert.equal(scene.tokens.get("t-secret")!.disposition, DISPOSITIONS.SECRET);
    assert.equal(scene.tokens.get("t-locked")!.disposition, DISPOSITIONS.NEUTRAL);
  });

  it("turns NPC members friendly above 10 and neutral in between", async () => {
    const { acolyte, chars, cult, scene } = await cultScenario([12, 14]);
    await recalculateAllDispositions(true);
    assert.equal(scene.tokens.get("t-open")!.disposition, DISPOSITIONS.FRIENDLY);

    await setScore(chars[0], factionKey(cult.id), 0);
    await setScore(chars[1], factionKey(cult.id), 10);
    await recalculateAllDispositions(true);
    assert.equal(acolyte.prototypeToken.disposition, DISPOSITIONS.NEUTRAL);
  });

  it("uses the primary party's own score when it has one", async () => {
    const { acolyte, cult } = await cultScenario([-20, -20]);
    const party = addActor("party", "group");
    party.system.members = world.actors
      .filter((a) => a.type === "character")
      .map((actor) => ({ actor }));
    g.game.actors.party = party;
    await ensureRelation(party, factionKey(cult.id));
    await setScore(party, factionKey(cult.id), 11);

    assert.equal(computeNpcStanding(acolyte).disposition, "friendly");
  });

  it("lets an individual relation override the faction score", async () => {
    const { acolyte, chars } = await cultScenario([-20, -20]);
    for (const c of chars) {
      await ensureRelation(c, npcKey(acolyte.id));
      await setScore(c, npcKey(acolyte.id), 15);
    }
    assert.equal(computeNpcStanding(acolyte).disposition, "friendly");
  });

  it("skips NPCs with no groups and no individual relations", async () => {
    addActor("pc", "character", ["p1"]);
    const hermit = addActor("hermit", "npc");
    assert.deepEqual(computeNpcStanding(hermit), { score: null, disposition: null });
    assert.equal(await recalculateAllDispositions(true), 0);
  });

  it("only writes when something changes and respects the lock", async () => {
    const { acolyte } = await cultScenario([-20, -20]);
    assert.ok((await recalculateAllDispositions(true)) > 0);
    assert.equal(await recalculateAllDispositions(true), 0);

    await setNpcDispositionLock(acolyte, true);
    acolyte.prototypeToken.disposition = DISPOSITIONS.NEUTRAL;
    assert.equal(await recalculateAllDispositions(true), 0);
  });

  it("does nothing on non-GM clients", async () => {
    const { acolyte } = await cultScenario([-20, -20]);
    world.setUser("p1", false);
    assert.equal(await recalculateAllDispositions(), 0);
    assert.equal(acolyte.prototypeToken.disposition, DISPOSITIONS.NEUTRAL);
  });
});

describe("player +1 requests (RF-03)", () => {
  beforeEach(setup);

  async function scenario() {
    const guild = await createFaction("Guild");
    const hero = addActor("hero", "character", ["p1"]);
    const other = addActor("other", "character", []);
    await setMember(hero, guild.id, true);
    await setMember(other, guild.id, true);
    return { key: factionKey(guild.id), hero, other };
  }

  it("is rejected while the setting is off (default)", async () => {
    const { key, hero } = await scenario();
    const reason = await handleIncrease(
      { type: "increase", actorUuid: hero.uuid, key, userId: "p1" },
      "p1",
    );
    assert.equal(reason, "disabled");
    assert.equal(getRelations(hero)[key].score, 0);
  });

  it("adds exactly 1 for the owner when enabled", async () => {
    const { key, hero } = await scenario();
    await g.game.settings.set(MODULE_ID, SETTINGS.playersCanIncrease, true);
    assert.equal(
      await handleIncrease({ type: "increase", actorUuid: hero.uuid, key, userId: "p1" }, "p1"),
      null,
    );
    assert.equal(getRelations(hero)[key].score, 1);
  });

  it("rejects non-owners and missing entries", async () => {
    const { key, other, hero } = await scenario();
    await g.game.settings.set(MODULE_ID, SETTINGS.playersCanIncrease, true);
    assert.equal(
      await handleIncrease({ type: "increase", actorUuid: other.uuid, key, userId: "p1" }, "p1"),
      "not-owner",
    );
    assert.equal(
      await handleIncrease(
        { type: "increase", actorUuid: hero.uuid, key: "f_unknown", userId: "p1" },
        "p1",
      ),
      "no-entry",
    );
  });

  it("trusts the socket sender id over the payload", async () => {
    const { key, hero } = await scenario();
    await g.game.settings.set(MODULE_ID, SETTINGS.playersCanIncrease, true);
    registerSocket();
    const handler = g.game.socket.handlers.get(`module.${MODULE_ID}`);
    // A stranger claims to be p1 in the payload; the transport says "intruder".
    g.game.users.push({ id: "intruder", name: "X", isGM: false });
    handler({ type: "increase", actorUuid: hero.uuid, key, userId: "p1" }, "intruder");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(getRelations(hero)[key].score, 0);
  });

  it("player clients send a request without any delta", async () => {
    const { key, hero } = await scenario();
    world.setUser("p1", false);
    requestIncrease(hero, key);
    assert.deepEqual(world.emitted, [
      { type: "increase", actorUuid: hero.uuid, key, userId: "p1" },
    ]);
  });
});

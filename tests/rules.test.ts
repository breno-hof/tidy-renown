import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPlayerIncrease,
  clampScore,
  dispositionFor,
  getNextRank,
  getRank,
  normalizeFaction,
  partyScoreTowardNpc,
  progressOf,
  reachedRanks,
  scoreTowardNpc,
  withMembership,
} from "../src/data/rules.js";
import type { RankDef, Relations } from "../src/data/types.js";

const ranks: RankDef[] = [
  { id: "c", name: "Champion", minScore: 50 },
  { id: "a", name: "", minScore: 3 },
  { id: "b", name: "Veteran", minScore: 10 },
];

describe("clampScore (SPEC 2.1 / 2.5)", () => {
  it("never lets a member drop below 0", () => {
    assert.equal(clampScore(-4, { member: true }), 0);
  });
  it("lets non-members and NPC relations go negative", () => {
    assert.equal(clampScore(-12, { member: false }), -12);
    assert.equal(clampScore(-12, {}), -12);
  });
  it("applies the optional cap, and no cap by default", () => {
    assert.equal(clampScore(60, { member: true, cap: 50 }), 50);
    assert.equal(clampScore(999, { member: true, cap: null }), 999);
  });
  it("truncates fractions and sanitizes NaN", () => {
    assert.equal(clampScore(2.9, {}), 2);
    assert.equal(clampScore(Number.NaN, {}), 0);
  });
});

describe("ranks (SPEC 2.3)", () => {
  it("returns the highest rank whose minimum is reached", () => {
    assert.equal(getRank(ranks, 2), null);
    assert.equal(getRank(ranks, 3)?.id, "a");
    assert.equal(getRank(ranks, 49)?.id, "b");
    assert.equal(getRank(ranks, 50)?.id, "c");
  });
  it("finds the next rank", () => {
    assert.equal(getNextRank(ranks, 3)?.id, "b");
    assert.equal(getNextRank(ranks, 50), null);
  });
  it("lists reached ranks in ascending order", () => {
    assert.deepEqual(
      reachedRanks(ranks, 12).map((r) => r.id),
      ["a", "b"],
    );
  });
});

describe("progressOf", () => {
  it("scales against progressMax and flags negatives", () => {
    assert.deepEqual(progressOf(25, 50), { pct: 50, negative: false });
    assert.deepEqual(progressOf(-10, 50), { pct: 20, negative: true });
    assert.deepEqual(progressOf(80, 50), { pct: 100, negative: false });
  });
});

describe("scoreTowardNpc (SPEC 2.6, s)", () => {
  const rel: Relations = {
    f_guild: { score: 12, member: true },
    f_cult: { score: -15 },
    n_bob: { score: 4 },
  };
  it("prefers the individual relation", () => {
    assert.equal(scoreTowardNpc(rel, "bob", ["guild"]), 4);
  });
  it("uses the lowest score among the NPC's factions", () => {
    assert.equal(scoreTowardNpc(rel, "eve", ["guild", "cult"]), -15);
  });
  it("counts a missing faction entry as 0", () => {
    assert.equal(scoreTowardNpc(rel, "eve", ["guild", "unknown"]), 0);
  });
  it("returns null for NPCs outside the automation", () => {
    assert.equal(scoreTowardNpc(rel, "eve", []), null);
  });
});

describe("partyScoreTowardNpc (SPEC 2.6, S)", () => {
  const a: Relations = { f_cult: { score: -20 } };
  const b: Relations = { f_cult: { score: -4 } };
  it("averages the characters' scores", () => {
    assert.equal(partyScoreTowardNpc(null, [a, b], "eve", ["cult"]), -12);
  });
  it("uses the party actor's own entry when present", () => {
    const party: Relations = { f_cult: { score: 15 } };
    assert.equal(partyScoreTowardNpc(party, [a, b], "eve", ["cult"]), 15);
  });
  it("ignores a party entry that is unrelated to the target", () => {
    const party: Relations = { f_other: { score: 30 } };
    assert.equal(partyScoreTowardNpc(party, [a, b], "eve", ["cult"]), -12);
  });
  it("returns null when nobody has a score", () => {
    assert.equal(partyScoreTowardNpc(null, [], "eve", ["cult"]), null);
    assert.equal(partyScoreTowardNpc(null, [a], "eve", []), null);
  });
  it("only averages characters with an individual relation for faction-less NPCs", () => {
    const withRel: Relations = { n_eve: { score: -30 } };
    assert.equal(partyScoreTowardNpc(null, [withRel, a], "eve", []), -30);
  });
});

describe("dispositionFor (SPEC 2.6)", () => {
  const t = { hostile: -10, friendly: 10 };
  it("uses strict thresholds", () => {
    assert.equal(dispositionFor(-11, t), "hostile");
    assert.equal(dispositionFor(-10, t), "neutral");
    assert.equal(dispositionFor(10, t), "neutral");
    assert.equal(dispositionFor(10.5, t), "friendly");
  });
});

describe("withMembership (SPEC 2.5)", () => {
  it("lifts negative scores to 0 when joining", () => {
    assert.deepEqual(withMembership({ score: -7 }, true), { score: 0, member: true });
  });
  it("keeps the score when leaving", () => {
    assert.deepEqual(withMembership({ score: 5, member: true }, false), {
      score: 5,
      member: false,
    });
  });
});

describe("canPlayerIncrease (RF-03)", () => {
  const entry = { score: 4 };
  it("is denied while the setting is off (default)", () => {
    assert.deepEqual(canPlayerIncrease({ enabled: false, isOwner: true, entry, cap: null }), {
      ok: false,
      reason: "disabled",
    });
  });
  it("requires ownership and an existing entry", () => {
    assert.equal(canPlayerIncrease({ enabled: true, isOwner: false, entry, cap: null }).ok, false);
    assert.equal(
      canPlayerIncrease({ enabled: true, isOwner: true, entry: undefined, cap: null }).ok,
      false,
    );
  });
  it("respects the cap and always adds exactly 1", () => {
    assert.equal(canPlayerIncrease({ enabled: true, isOwner: true, entry, cap: 4 }).ok, false);
    assert.deepEqual(canPlayerIncrease({ enabled: true, isOwner: true, entry, cap: 5 }), {
      ok: true,
      newScore: 5,
    });
  });
});

describe("normalizeFaction", () => {
  it("fills defaults and sanitizes form input", () => {
    const f = normalizeFaction({
      id: "x",
      name: "  Guild ",
      kind: "bogus" as never,
      progressMax: 0,
      cap: "" as never,
      ranks: { 0: { id: "r2", name: "B", minScore: "10" }, 1: { id: "r1", minScore: 3 } } as never,
    });
    assert.equal(f.name, "Guild");
    assert.equal(f.kind, "faction");
    assert.equal(f.progressMax, 50);
    assert.equal(f.cap, null);
    assert.deepEqual(
      f.ranks.map((r) => [r.id, r.minScore]),
      [
        ["r1", 3],
        ["r2", 10],
      ],
    );
  });
});

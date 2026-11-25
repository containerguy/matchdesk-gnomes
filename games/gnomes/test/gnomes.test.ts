import { describe, expect, it } from "vitest";
import {
  alive,
  applyGnomesMove,
  checkGnomesMove,
  checkMoveTarget,
  chooseBotMove,
  createState,
  drawableTypes,
  gnomes,
  MAPS,
  mapById,
  parseGnomesMove,
  pathCost,
  publicState,
  resolveShot,
  SPECS,
  SQUAD,
  UNIT_RADIUS,
  unitById,
  distToShape,
  type GnomesState,
  type Unit
} from "../src";

/** Zustand mit frei gesetzten Zwergen auf einer Karte. */
function arena(units: Array<Partial<Unit> & Pick<Unit, "id" | "seat" | "type" | "x" | "y">>, extra: Partial<GnomesState> = {}): GnomesState {
  const base = createState(1, 0, { map: "allotment" });
  return {
    ...base,
    units: units.map((u) => ({ hp: SPECS[u.type].hp, maxHp: SPECS[u.type].hp, facing: 0, ...u })),
    drawn: units[0]!.type,
    ...extra
  };
}

describe("Aufbau", () => {
  it("stellt auf jeder Karte zwei gleich große Trupps auf freien Plätzen auf", () => {
    for (const map of MAPS) {
      const state = createState(7, 0, { map: map.id });
      expect(alive(state, 0)).toHaveLength(SQUAD.length);
      expect(alive(state, 1)).toHaveLength(SQUAD.length);
      for (const u of state.units) {
        for (const f of map.features) {
          if (f.kind === "bed" || f.kind === "path") continue;
          expect(distToShape(u, f), `${map.id} ${u.id} steht in ${f.kind}`).toBeGreaterThanOrEqual(UNIT_RADIUS);
        }
        for (const o of state.units) if (o !== u) expect(Math.hypot(o.x - u.x, o.y - u.y)).toBeGreaterThanOrEqual(2 * UNIT_RADIUS);
      }
    }
  });

  it("ist bei gleichem Seed gleich und lost einen vorhandenen Typ aus", () => {
    expect(createState(42, 1)).toEqual(createState(42, 1));
    const state = createState(42, 1);
    expect(state.turn).toBe(1);
    expect(alive(state, 1).some((u) => u.type === state.drawn)).toBe(true);
  });

  it("verkürzte Aufstellung für Tests: zwei Zwerge mit 1 Lebenspunkt auf jeder Karte frei", () => {
    for (const map of MAPS) {
      const state = createState(3, 0, { squad: "quick", map: map.id });
      expect(alive(state, 0).map((u) => [u.type, u.hp])).toEqual([
        ["sling", 1],
        ["mower", 1]
      ]);
      for (const u of state.units) {
        for (const f of map.features) {
          if (f.kind !== "bed" && f.kind !== "path") expect(distToShape(u, f)).toBeGreaterThanOrEqual(UNIT_RADIUS);
        }
      }
    }
    expect(gnomes.createInitialState({ seed: 3, startingSeat: 0, quick: true }).units).toHaveLength(4);
  });

  it("gibt Clients keinen Zufallszustand", () => {
    expect(publicState(createState(5, 0))).not.toHaveProperty("rng");
  });
});

describe("Bewegung", () => {
  it("erlaubt Wege bis zur Bewegungsweite, nicht darüber", () => {
    const s = arena([{ id: "r1", seat: 0, type: "mower", x: 300, y: 300 }]);
    const u = s.units[0]!;
    expect(checkMoveTarget(s, u, { x: 300, y: 300 + 250 }).ok).toBe(false); // durchs Beet: teurer
    expect(checkMoveTarget(s, u, { x: 300 + 250, y: 320 }).ok).toBe(false); // Hecke im Weg
    expect(checkMoveTarget(s, u, { x: 100, y: 330 }).ok).toBe(true);
    expect(checkMoveTarget(s, u, { x: 300 - 270, y: 300 }).ok).toBe(false);
  });

  it("Kieswege sind billiger, Beete teurer", () => {
    const s = arena([{ id: "r1", seat: 0, type: "mower", x: 100, y: 622 }]);
    expect(pathCost(s, { x: 100, y: 622 }, { x: 300, y: 622 })).toBeCloseTo(120, 0);
    expect(pathCost(s, { x: 310, y: 452 }, { x: 410, y: 452 })).toBeCloseTo(150, 0);
  });

  it("blockiert Teich, Rand und andere Zwerge", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "mower", x: 640, y: 500 },
      { id: "b1", seat: 1, type: "mower", x: 640, y: 380 }
    ]);
    const u = s.units[0]!;
    expect(checkMoveTarget(s, u, { x: 800, y: 500 })).toMatchObject({ ok: false });
    expect(checkMoveTarget(s, u, { x: 640, y: 390 })).toMatchObject({ ok: false, reason: "Da steht schon ein Zwerg." });
    const edge = arena([{ id: "r1", seat: 0, type: "mower", x: 40, y: 900 }]);
    expect(checkMoveTarget(edge, edge.units[0]!, { x: 5, y: 900 })).toMatchObject({ ok: false });
  });

  it("die Vogelscheuche bleibt stehen", () => {
    const s = arena([{ id: "r1", seat: 0, type: "scarecrow", x: 100, y: 500 }]);
    expect(checkMoveTarget(s, s.units[0]!, { x: 120, y: 500 }).ok).toBe(false);
    expect(checkMoveTarget(s, s.units[0]!, { x: 100, y: 500 }).ok).toBe(true);
  });
});

describe("Schüsse", () => {
  it("Spritzkegel trifft vorn, nah mehr als fern, nicht hinter der Hecke", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "mower", x: 200, y: 300 },
      { id: "b1", seat: 1, type: "mower", x: 260, y: 300 },
      { id: "b2", seat: 1, type: "mower", x: 440, y: 330 },
      { id: "b3", seat: 1, type: "mower", x: 200, y: 140 }
    ]);
    const shot = resolveShot(s, s.units, s.units[0]!, { x: 400, y: 310 });
    const dmg = Object.fromEntries(shot.hits.map((h) => [h.unit.id, h.damage]));
    expect(Object.keys(dmg).sort()).toEqual(["b1", "b2"]);
    expect(dmg.b1!).toBeGreaterThan(dmg.b2!);

    const behind = arena([
      { id: "r1", seat: 0, type: "mower", x: 480, y: 280 },
      { id: "b1", seat: 1, type: "mower", x: 600, y: 280 }
    ]);
    expect(resolveShot(behind, behind.units, behind.units[0]!, { x: 600, y: 280 }).hits).toEqual([]);
  });

  it("Wasserbombe fliegt über die Hecke, trifft im Kreis und auch eigene Zwerge", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "sling", x: 460, y: 280 },
      { id: "b1", seat: 1, type: "mower", x: 640, y: 280 },
      { id: "r2", seat: 0, type: "mower", x: 640, y: 330 },
      { id: "b2", seat: 1, type: "mower", x: 640, y: 600 }
    ]);
    const shot = resolveShot(s, s.units, s.units[0]!, { x: 640, y: 280 });
    const ids = shot.hits.map((h) => h.unit.id).sort();
    expect(ids).toEqual(["b1", "r2"]);
    expect(shot.hits.find((h) => h.unit.id === "b1")!.damage).toBe(SPECS.sling.maxDamage);
  });

  it("Wasserbombe fliegt höchstens ihre Reichweite", () => {
    const s = arena([{ id: "r1", seat: 0, type: "sling", x: 100, y: 500 }]);
    const shot = resolveShot(s, s.units, s.units[0]!, { x: 1500, y: 500 });
    expect(shot.impact.x).toBeCloseTo(100 + SPECS.sling.range, 0);
  });

  it("Gießkannen-Kanone stoppt am ersten Zwerg oder an der Hecke", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "barrow", x: 100, y: 450 },
      { id: "b1", seat: 1, type: "mower", x: 220, y: 450 },
      { id: "b2", seat: 1, type: "mower", x: 500, y: 450 }
    ]);
    const shot = resolveShot(s, s.units, s.units[0]!, { x: 600, y: 450 });
    expect(shot.impact.x).toBeCloseTo(200, 0);
    expect(shot.hits.map((h) => h.unit.id)).toEqual(["b1"]);

    const hedge = arena([{ id: "r1", seat: 0, type: "barrow", x: 440, y: 260 }]);
    expect(resolveShot(hedge, hedge.units, hedge.units[0]!, { x: 700, y: 260 }).impact.x).toBeLessThanOrEqual(521);
  });

  it("Krähenschwarm trifft jeden Punkt der Karte", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "scarecrow", x: 80, y: 500 },
      { id: "b1", seat: 1, type: "barrow", x: 1500, y: 900 }
    ]);
    const shot = resolveShot(s, s.units, s.units[0]!, { x: 1500, y: 900 });
    expect(shot.hits.map((h) => [h.unit.id, h.damage])).toEqual([["b1", SPECS.scarecrow.maxDamage]]);
  });
});

describe("Zug", () => {
  it("prüft Platz, Typ, Bewegung und Ziel", () => {
    const s = createState(11, 0, { map: "allotment" });
    const other = alive(s, 0).find((u) => u.type !== s.drawn)!;
    const mine = alive(s, 0).find((u) => u.type === s.drawn)!;
    const enemy = alive(s, 1)[0]!;
    expect(checkGnomesMove(s, 1, { unit: enemy.id, to: enemy, aim: mine })).toMatchObject({ ok: false });
    expect(checkGnomesMove(s, 0, { unit: other.id, to: other, aim: enemy })).toMatchObject({ ok: false });
    expect(checkGnomesMove(s, 0, { unit: mine.id, to: { x: mine.x, y: mine.y }, aim: enemy })).toEqual({ ok: true });
    expect(checkGnomesMove(s, 0, { unit: enemy.id, to: enemy, aim: mine })).toMatchObject({ ok: false, reason: "Das ist nicht dein Zwerg." });
  });

  it("wendet Bewegung und Treffer an, nasse Zwerge scheiden aus, Gegner ist dran", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "barrow", x: 100, y: 450 },
      { id: "b1", seat: 1, type: "mower", x: 220, y: 450, hp: 10 },
      { id: "b2", seat: 1, type: "sling", x: 1400, y: 450 }
    ]);
    const { state, events } = applyGnomesMove(s, 0, { unit: "r1", to: { x: 130, y: 450 }, aim: { x: 500, y: 450 } });
    expect(unitById(state, "r1")).toMatchObject({ x: 130, y: 450 });
    expect(unitById(state, "b1")!.hp).toBe(0);
    expect(events.map((e) => e.type)).toEqual(["moved", "shot", "out", "drawn"]);
    expect(state.turn).toBe(1);
    expect(state.drawn).toBe("sling");
    expect(state.winner).toBeNull();
  });

  it("wer alle Gegner nass macht, gewinnt", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "barrow", x: 100, y: 450 },
      { id: "b1", seat: 1, type: "mower", x: 220, y: 450, hp: 5 }
    ]);
    const { state, events } = applyGnomesMove(s, 0, { unit: "r1", to: { x: 100, y: 450 }, aim: { x: 220, y: 450 } });
    expect(state.winner).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "won", seat: 0 });
    expect(gnomes.result(state)).toMatchObject({ kind: "won", winner: 0 });
  });

  it("Vogelscheuche pausiert zwei eigene Züge nach dem Krähenschwarm", () => {
    let s = arena([
      { id: "r1", seat: 0, type: "scarecrow", x: 80, y: 500 },
      { id: "r2", seat: 0, type: "mower", x: 200, y: 200 },
      { id: "b1", seat: 1, type: "mower", x: 1500, y: 200 }
    ]);
    s = applyGnomesMove(s, 0, { unit: "r1", to: { x: 80, y: 500 }, aim: { x: 1000, y: 800 } }).state;
    expect(s.crowCooldown[0]).toBe(2);
    s = applyGnomesMove(s, 1, { unit: "b1", to: { x: 1500, y: 200 }, aim: { x: 1300, y: 200 } }).state;
    expect(s.crowCooldown[0]).toBe(1);
    expect(drawableTypes(s, 0)).toEqual(["mower"]);
    expect(s.drawn).toBe("mower");
  });

  it("verpasste Züge: nach dreimal in Folge verloren", () => {
    let s = createState(9, 0);
    for (let i = 0; i < 5; i++) s = applyGnomesMove(s, s.turn, { pass: true }).state;
    expect(s.winner).toBe(1);
    expect(s.winReason).toContain("verpasst");
  });

  it("nach dem Zuglimit gewinnt, wer mehr Leben übrig hat", () => {
    const s = arena(
      [
        { id: "r1", seat: 0, type: "mower", x: 100, y: 100 },
        { id: "b1", seat: 1, type: "mower", x: 1500, y: 900, hp: 20 }
      ],
      { moves: 79 }
    );
    const { state } = applyGnomesMove(s, 0, { unit: "r1", to: { x: 100, y: 100 }, aim: { x: 200, y: 100 } });
    expect(state.winner).toBe(0);
  });

  it("Spieler können keinen Zug aussetzen, nur der Server", () => {
    expect(gnomes.parseMove({ pass: true })).toBeNull();
    expect(gnomes.timeoutMove!(createState(1, 0))).toEqual({ pass: true });
    expect(parseGnomesMove({ unit: "r1", to: { x: 1, y: 2 }, aim: { x: 3, y: "x" } })).toBeNull();
    expect(parseGnomesMove({ unit: "r1", to: { x: 1, y: 2 }, aim: { x: 3, y: 4 } })).toEqual({ unit: "r1", to: { x: 1, y: 2 }, aim: { x: 3, y: 4 } });
  });
});

describe("Computergegner", () => {
  it("macht auf jeder Stufe gültige Züge und beendet eine Partie", () => {
    let s = createState(21, 0, { map: "roses" });
    let rnd = 1;
    const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200 && s.winner === null; i++) {
      const level = s.turn === 0 ? "hard" : "easy";
      const move = chooseBotMove(publicState(s), level, random);
      expect(checkGnomesMove(s, s.turn, move)).toEqual({ ok: true });
      s = applyGnomesMove(s, s.turn, move).state;
    }
    expect(s.winner).not.toBeNull();
  });

  it("nimmt einen sicheren Treffer statt eigener Verluste", () => {
    const s = arena([
      { id: "r1", seat: 0, type: "sling", x: 300, y: 800 },
      { id: "r2", seat: 0, type: "mower", x: 640, y: 880 },
      { id: "b1", seat: 1, type: "mower", x: 560, y: 700 },
      { id: "b2", seat: 1, type: "mower", x: 620, y: 860 }
    ]);
    const move = chooseBotMove(publicState(s), "hard", () => 0.5);
    const units = s.units.map((u) => (u.id === move.unit ? { ...u, ...move.to } : u));
    const hits = resolveShot(s, units, units.find((u) => u.id === "r1")!, move.aim).hits;
    expect(hits.some((h) => h.unit.id === "b1")).toBe(true);
    expect(hits.some((h) => h.unit.seat === 0)).toBe(false);
  });
});

describe("Karten", () => {
  it("sind punktsymmetrisch", () => {
    for (const map of MAPS) {
      const m = mapById(map.id);
      expect(m.features.length % 2).toBe(1);
    }
  });
});

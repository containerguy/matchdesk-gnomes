import { otherSeat, type Seat } from "@gartenfehde/core";
import { angleOf, dist, type Vec } from "./geometry";
import { HEIGHT, WIDTH } from "./maps";
import { alive, checkMoveTarget, clearShot, resolveShot, SPECS, type ActMove, type PublicGnomesState, type Unit } from "./rules";

/**
 * Computergegner. Er probiert für jeden passenden Zwerg mehrere Standorte und Schüsse in der
 * Simulation durch und bewertet: Schaden am Gegner, minus Schaden an eigenen Zwergen, plus Deckung.
 * Er sieht nur, was auch ein Mensch sieht.
 */

export type BotLevel = "easy" | "medium" | "hard";
export const BOT_LEVELS: BotLevel[] = ["easy", "medium", "hard"];

type LevelSpec = { rings: number; directions: number; aimNoise: number; cover: boolean; threat: boolean };

const LEVELS: Record<BotLevel, LevelSpec> = {
  easy: { rings: 1, directions: 6, aimNoise: 70, cover: false, threat: false },
  medium: { rings: 2, directions: 10, aimNoise: 22, cover: true, threat: false },
  hard: { rings: 3, directions: 16, aimNoise: 4, cover: true, threat: true }
};

/** Mögliche Standorte: stehen bleiben oder Ringe in mehreren Richtungen. */
function destinations(state: PublicGnomesState, unit: Unit, spec: LevelSpec): Vec[] {
  const out: Vec[] = [{ x: unit.x, y: unit.y }];
  const reach = SPECS[unit.type].move;
  if (reach === 0) return out;
  for (let ring = 1; ring <= spec.rings; ring++) {
    const radius = (reach * ring) / spec.rings - 2;
    for (let i = 0; i < spec.directions; i++) {
      const a = (i / spec.directions) * Math.PI * 2 + ring * 0.37;
      const to = { x: Math.round(unit.x + Math.cos(a) * radius), y: Math.round(unit.y + Math.sin(a) * radius) };
      if (checkMoveTarget(state, unit, to).ok) out.push(to);
    }
  }
  return out;
}

/** Zielpunkte: jeder Gegner, dazu Mitten zwischen nahen Gegnern (für Flächenschüsse). */
function aims(enemies: Unit[], splash: boolean): Vec[] {
  const out: Vec[] = enemies.map((e) => ({ x: e.x, y: e.y }));
  if (splash) {
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const a = enemies[i]!;
        const b = enemies[j]!;
        if (dist(a, b) < 140) out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    }
  }
  return out;
}

function gaussian(random: () => number) {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Wie viele Gegner könnten diesen Platz im nächsten Zug direkt anspritzen? */
function exposure(state: PublicGnomesState, at: Vec, seat: Seat) {
  let n = 0;
  for (const e of alive(state, otherSeat(seat))) {
    const s = SPECS[e.type];
    const reach = s.weapon === "crows" ? 0 : s.move + Math.min(s.range, 520);
    if (dist(e, at) < reach && clearShot(state, e, at)) n++;
  }
  return n;
}

export function scoreMove(state: PublicGnomesState, seat: Seat, unit: Unit, to: Vec, aim: Vec, level: LevelSpec) {
  const units = state.units.map((u) => (u.id === unit.id ? { ...u, x: to.x, y: to.y } : u));
  const shooter = units.find((u) => u.id === unit.id)!;
  const shot = resolveShot(state, units, shooter, aim);
  let value = 0;
  for (const h of shot.hits) {
    const dealt = Math.min(h.unit.hp, h.damage);
    const kill = dealt >= h.unit.hp ? 35 : 0;
    if (h.unit.seat === seat) value -= 1.4 * dealt + kill * 1.2;
    else value += dealt + kill;
  }
  if (SPECS[unit.type].move > 0) {
    if (level.cover) value -= (level.threat ? 4 : 2) * exposure(state, to, seat);
    // Ohne Treffer lieber näher heran, damit es im nächsten Zug reicht
    const enemies = alive(state, otherSeat(seat));
    const nearest = Math.min(...enemies.map((e) => dist(e, to)));
    const ideal = SPECS[unit.type].weapon === "spray" ? 200 : SPECS[unit.type].weapon === "balloon" ? 420 : 500;
    if (Number.isFinite(nearest)) value -= 0.04 * Math.max(0, nearest - ideal);
  }
  return value;
}

export function chooseBotMove(state: PublicGnomesState, level: BotLevel, random: () => number = Math.random): ActMove {
  const spec = LEVELS[level];
  const seat = state.turn;
  const mine = alive(state, seat).filter((u) => u.type === state.drawn);
  const enemies = alive(state, otherSeat(seat));
  let best: { move: ActMove; value: number } | null = null;

  for (const unit of mine) {
    const splash = SPECS[unit.type].splash > 0;
    for (const to of destinations(state, unit, spec)) {
      for (const aim of aims(enemies, splash)) {
        const value = scoreMove(state, seat, unit, to, aim, spec) + random() * 0.5;
        if (!best || value > best.value) best = { move: { unit: unit.id, to, aim }, value };
      }
    }
  }

  if (!best) {
    // Kein Gegner in Sicht (kommt praktisch nicht vor): Richtung Mitte spritzen
    const unit = mine[0] ?? alive(state, seat)[0]!;
    return { unit: unit.id, to: { x: unit.x, y: unit.y }, aim: { x: 800, y: 500 } };
  }

  // Zittern beim Zielen, je nach Stufe
  const move = best.move;
  const from = move.to;
  const a = angleOf(from, move.aim) + (gaussian(random) * spec.aimNoise) / Math.max(120, dist(from, move.aim));
  const d = Math.max(30, dist(from, move.aim) + gaussian(random) * spec.aimNoise * 0.6);
  const aim = { x: Math.round(from.x + Math.cos(a) * d), y: Math.round(from.y + Math.sin(a) * d) };
  return { unit: move.unit, to: move.to, aim: { x: Math.min(WIDTH, Math.max(0, aim.x)), y: Math.min(HEIGHT, Math.max(0, aim.y)) } };
}

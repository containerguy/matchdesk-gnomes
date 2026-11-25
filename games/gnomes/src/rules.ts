import { otherSeat, type GameDefinition, type GameResult, type MoveCheck, type Seat } from "@gartenfehde/core";
import { angleDiff, angleOf, clampToRange, dist, distToShape, rayCircle, round1, samples, type Vec } from "./geometry";
import { HEIGHT, MAPS, WIDTH, mapById, mirrorPoint, type Feature, type MapDef } from "./maps";

/**
 * Gartenfehde: zwei Trupps Gartenzwerge machen sich im Schrebergarten mit Wasser nass.
 *
 * Pro Zug lost der Server einen Einheitentyp aus. Der Spieler wählt einen eigenen Zwerg dieses Typs,
 * bewegt ihn (oder lässt ihn stehen) und gibt genau einen Schuss ab. Wer alle Zwerge des Gegners
 * nass gemacht hat, gewinnt. Alles hier ist rein und deterministisch (Zufall über einen Seed im
 * Zustand), damit Server, Client und Computergegner dieselbe Logik nutzen.
 */

export type UnitType = "mower" | "sling" | "barrow" | "scarecrow";
export const UNIT_TYPES: UnitType[] = ["mower", "sling", "barrow", "scarecrow"];

export type Weapon = "spray" | "balloon" | "cannon" | "crows";

export type UnitSpec = {
  type: UnitType;
  name: string;
  weaponName: string;
  weapon: Weapon;
  hp: number;
  /** Bewegungsweite in Spielfeld-Einheiten auf normalem Rasen. */
  move: number;
  /** Reichweite des Schusses (Spritze: Kegellänge, Ballon: Wurfweite, Kanone: Flugweite, Krähen: unbegrenzt). */
  range: number;
  /** Spritzkreis am Einschlag (Spritze: keiner, sie trifft im Kegel). */
  splash: number;
  /** Schaden in der Mitte bzw. aus nächster Nähe und am Rand bzw. auf größte Entfernung. */
  maxDamage: number;
  minDamage: number;
};

export const UNIT_RADIUS = 20;
/** Halber Öffnungswinkel des Spritzkegels. */
export const SPRAY_HALF_ANGLE = (22 * Math.PI) / 180;
/** So viele eigene Züge muss die Vogelscheuche nach ihrem Krähenschwarm aussetzen. */
export const CROW_COOLDOWN = 2;
/** Nach so vielen verpassten Zügen in Folge hat man aufgegeben. */
export const MAX_MISSED = 3;

export const SPECS: Record<UnitType, UnitSpec> = {
  mower: { type: "mower", name: "Rasenmäher-Zwerg", weaponName: "Spritzkegel", weapon: "spray", hp: 60, move: 260, range: 260, splash: 0, maxDamage: 30, minDamage: 12 },
  sling: { type: "sling", name: "Schleuder-Zwerg", weaponName: "Wasserbombe", weapon: "balloon", hp: 50, move: 180, range: 520, splash: 60, maxDamage: 35, minDamage: 10 },
  barrow: { type: "barrow", name: "Schubkarren-Zwerg", weaponName: "Gießkannen-Kanone", weapon: "cannon", hp: 120, move: 110, range: 700, splash: 45, maxDamage: 45, minDamage: 15 },
  scarecrow: { type: "scarecrow", name: "Vogelscheuche", weaponName: "Krähenschwarm", weapon: "crows", hp: 40, move: 0, range: Infinity, splash: 90, maxDamage: 30, minDamage: 10 }
};

/** Aufstellung eines Trupps (Reihenfolge passt zu den Startplätzen der Karten). */
export const SQUAD: UnitType[] = ["scarecrow", "barrow", "barrow", "mower", "mower", "mower", "sling", "sling", "sling"];
/** Kurze Aufstellung für Tests: ein Schleuder- und ein Rasenmäher-Zwerg mit je 1 Lebenspunkt, nah an der Mitte. */
export const QUICK_SQUAD: UnitType[] = ["sling", "mower"];
const QUICK_STARTS: Vec[] = [
  { x: 640, y: 420 },
  { x: 640, y: 580 }
];

export type Unit = {
  id: string;
  seat: Seat;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Blickrichtung (Bogenmaß) zum Zeichnen. */
  facing: number;
};

export type GnomesOptions = {
  /** Nach so vielen Zügen insgesamt (beide Spieler) entscheidet die Wertung. */
  moveLimit: number;
  /** "quick": kleine Aufstellung mit 1 Lebenspunkt je Zwerg (für Tests). */
  squad: "full" | "quick";
  /** Feste Karte; ohne Angabe entscheidet der Seed. */
  map?: string;
};

export const DEFAULT_OPTIONS: GnomesOptions = { moveLimit: 80, squad: "full" };

export type GnomesState = {
  map: string;
  units: Unit[];
  turn: Seat;
  /** Für diesen Zug ausgeloster Einheitentyp. */
  drawn: UnitType;
  /** Eigene Züge, die die Vogelscheuche noch aussetzt, je Platz. */
  crowCooldown: [number, number];
  /** Verpasste Züge in Folge, je Platz. */
  missed: [number, number];
  rng: number;
  moves: number;
  options: GnomesOptions;
  winner: Seat | null;
  winReason: string | null;
};

/** Ein Zug: Zwerg, Ziel der Bewegung (eigener Platz = stehen bleiben) und Zielpunkt des Schusses. */
export type ActMove = { unit: string; to: Vec; aim: Vec };
/** Zeit abgelaufen: der Zug verfällt (setzt der Server, nicht der Spieler). */
export type PassMove = { pass: true };
export type GnomesMove = ActMove | PassMove;

export type Hit = { unit: string; damage: number; hp: number };

export type GnomesEvent =
  | { type: "moved"; seat: Seat; unit: string; from: Vec; to: Vec }
  | { type: "shot"; seat: Seat; unit: string; weapon: Weapon; from: Vec; aim: Vec; impact: Vec; hits: Hit[] }
  | { type: "out"; unit: string }
  | { type: "passed"; seat: Seat; missed: number }
  | { type: "drawn"; seat: Seat; unitType: UnitType }
  | { type: "won"; seat: Seat; reason: string };

// --- Zufall ---------------------------------------------------------------

/** mulberry32: kleiner, reproduzierbarer Zufall; Zustand ist eine 32-Bit-Zahl. */
function nextRandom(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) >>> 0;
  const state = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, state];
}

// --- Aufbau -----------------------------------------------------------------

export function alive(state: { units: Unit[] }, seat?: Seat) {
  return state.units.filter((u) => u.hp > 0 && (seat === undefined || u.seat === seat));
}

export function unitById(state: { units: Unit[] }, id: string) {
  return state.units.find((u) => u.id === id);
}

/** Welche Typen dürfen für diesen Platz ausgelost werden? */
export function drawableTypes(state: Pick<GnomesState, "units" | "crowCooldown">, seat: Seat): UnitType[] {
  const types = UNIT_TYPES.filter((t) => alive(state, seat).some((u) => u.type === t));
  const ready = types.filter((t) => t !== "scarecrow" || state.crowCooldown[seat] === 0);
  // Steht nur noch die Vogelscheuche, darf sie trotz Pause ran
  return ready.length > 0 ? ready : types;
}

function draw(state: Pick<GnomesState, "units" | "crowCooldown">, seat: Seat, rng: number): [UnitType, number] {
  const types = drawableTypes(state, seat);
  const [r, next] = nextRandom(rng);
  return [types[Math.floor(r * types.length)] ?? "mower", next];
}

export function createState(seed: number, startingSeat: Seat, options: Partial<GnomesOptions> = {}): GnomesState {
  const opts: GnomesOptions = { ...DEFAULT_OPTIONS, ...options };
  let rng = seed >>> 0;
  let pick: number;
  [pick, rng] = nextRandom(rng);
  const map: MapDef = opts.map ? mapById(opts.map) : MAPS[Math.floor(pick * MAPS.length)]!;
  const quick = opts.squad === "quick";
  const squad = quick ? QUICK_SQUAD : SQUAD;
  const units: Unit[] = [];
  for (const seat of [0, 1] as Seat[]) {
    squad.forEach((type, i) => {
      const base = quick ? QUICK_STARTS[i]! : map.starts[i]!;
      const p = seat === 0 ? base : mirrorPoint(base);
      const hp = quick ? 1 : SPECS[type].hp;
      units.push({ id: `${seat === 0 ? "r" : "b"}${i + 1}`, seat, type, x: p.x, y: p.y, hp, maxHp: hp, facing: seat === 0 ? 0 : Math.PI });
    });
  }
  const base = { units, crowCooldown: [0, 0] as [number, number] };
  const [drawn, rngAfter] = draw(base, startingSeat, rng);
  return {
    map: map.id,
    units,
    turn: startingSeat,
    drawn,
    crowCooldown: [0, 0],
    missed: [0, 0],
    rng: rngAfter,
    moves: 0,
    options: opts,
    winner: null,
    winReason: null
  };
}

// --- Bewegung ---------------------------------------------------------------

const BLOCKS_MOVE = new Set(["hedge", "rock", "shed", "pond"]);
const BLOCKS_SHOT = new Set(["hedge", "rock", "shed"]);

function features(state: { map: string }): Feature[] {
  return mapById(state.map).features;
}

/** Kosten des Weges a→b: Länge mal Bodenfaktor (Kiesweg 0,6, Beet 1,5). */
export function pathCost(state: { map: string }, a: Vec, b: Vec): number {
  const pts = samples(a, b, 5);
  const terrain = features(state).filter((f) => f.kind === "bed" || f.kind === "path");
  let cost = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    let factor = 1;
    for (const f of terrain) if (distToShape(mid, f) <= 0) factor = f.kind === "path" ? 0.6 : 1.5;
    cost += dist(p, q) * factor;
  }
  return cost;
}

export type MoveTargetCheck = { ok: true; cost: number } | { ok: false; reason: string };

/** Darf `unit` geradlinig nach `to` laufen? */
export function checkMoveTarget(state: Pick<GnomesState, "map" | "units">, unit: Unit, to: Vec): MoveTargetCheck {
  if (to.x === unit.x && to.y === unit.y) return { ok: true, cost: 0 };
  const spec = SPECS[unit.type];
  if (spec.move === 0) return { ok: false, reason: "Die Vogelscheuche kann nicht laufen." };
  if (to.x < UNIT_RADIUS || to.y < UNIT_RADIUS || to.x > WIDTH - UNIT_RADIUS || to.y > HEIGHT - UNIT_RADIUS) {
    return { ok: false, reason: "Das Ziel liegt außerhalb des Gartens." };
  }
  const from = { x: unit.x, y: unit.y };
  for (const f of features(state)) {
    if (!BLOCKS_MOVE.has(f.kind)) continue;
    if (samples(from, to, 4).some((p) => distToShape(p, f) < UNIT_RADIUS - 0.5)) {
      return { ok: false, reason: "Da ist etwas im Weg." };
    }
  }
  for (const other of alive(state)) {
    if (other.id === unit.id) continue;
    if (dist(other, to) < UNIT_RADIUS * 2) return { ok: false, reason: "Da steht schon ein Zwerg." };
  }
  const cost = pathCost(state, from, to);
  if (cost > spec.move + 0.5) return { ok: false, reason: "So weit kommt der Zwerg nicht." };
  return { ok: true, cost };
}

// --- Schüsse ----------------------------------------------------------------

function falloff(spec: UnitSpec, t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  return Math.round(spec.maxDamage - (spec.maxDamage - spec.minDamage) * clamped);
}

/** Ist die Sichtlinie a→b frei von Hecken, Felsen und Gartenhaus? */
export function clearShot(state: { map: string }, a: Vec, b: Vec) {
  return !features(state).some((f) => BLOCKS_SHOT.has(f.kind) && samples(a, b, 4).some((p) => distToShape(p, f) <= 0));
}

export type ShotResult = { impact: Vec; hits: Array<{ unit: Unit; damage: number }> };

/**
 * Rechnet einen Schuss aus, ohne den Zustand zu ändern. `units` ist der Stand nach der Bewegung.
 * Eigene Zwerge können mitgetroffen werden.
 */
export function resolveShot(state: { map: string }, units: Unit[], shooter: Unit, aim: Vec): ShotResult {
  const spec = SPECS[shooter.type];
  const from = { x: shooter.x, y: shooter.y };
  const targets = units.filter((u) => u.hp > 0 && u.id !== shooter.id);

  if (spec.weapon === "spray") {
    const dir = angleOf(from, aim);
    const end = { x: from.x + Math.cos(dir) * spec.range, y: from.y + Math.sin(dir) * spec.range };
    const hits: ShotResult["hits"] = [];
    for (const u of targets) {
      const d = dist(from, u);
      if (d > spec.range + UNIT_RADIUS || d === 0) continue;
      const spread = Math.asin(Math.min(1, UNIT_RADIUS / d));
      if (angleDiff(angleOf(from, u), dir) > SPRAY_HALF_ANGLE + spread) continue;
      if (!clearShot(state, from, u)) continue;
      hits.push({ unit: u, damage: falloff(spec, d / spec.range) });
    }
    return { impact: end, hits };
  }

  let impact: Vec;
  if (spec.weapon === "cannon") {
    const dir = angleOf(from, aim);
    const far = { x: from.x + Math.cos(dir) * spec.range, y: from.y + Math.sin(dir) * spec.range };
    let travel = spec.range;
    for (const u of targets) {
      const t = rayCircle(from, far, u, UNIT_RADIUS);
      if (t !== null && t < travel) travel = t;
    }
    const steps = samples(from, far, 4);
    for (let i = 0; i < steps.length; i++) {
      const p = steps[i]!;
      const along = (i / (steps.length - 1)) * spec.range;
      if (along >= travel) break;
      const outside = p.x < 0 || p.y < 0 || p.x > WIDTH || p.y > HEIGHT;
      if (outside || features(state).some((f) => BLOCKS_SHOT.has(f.kind) && distToShape(p, f) <= 0)) {
        travel = along;
        break;
      }
    }
    impact = { x: from.x + Math.cos(dir) * travel, y: from.y + Math.sin(dir) * travel };
  } else if (spec.weapon === "balloon") {
    impact = clampToRange(from, aim, spec.range);
  } else {
    impact = { x: Math.min(WIDTH, Math.max(0, aim.x)), y: Math.min(HEIGHT, Math.max(0, aim.y)) };
  }
  impact = { x: round1(impact.x), y: round1(impact.y) };

  const hits: ShotResult["hits"] = [];
  for (const u of [...targets, shooter]) {
    const d = Math.max(0, dist(impact, u) - UNIT_RADIUS);
    if (d > spec.splash) continue;
    hits.push({ unit: u, damage: falloff(spec, d / spec.splash) });
  }
  return { impact, hits };
}

// --- Zug --------------------------------------------------------------------

export function isPass(move: GnomesMove): move is PassMove {
  return "pass" in move;
}

export function checkGnomesMove(state: GnomesState, seat: Seat, move: GnomesMove): MoveCheck {
  if (state.winner !== null) return { ok: false, reason: "Die Partie ist vorbei." };
  if (seat !== state.turn) return { ok: false, reason: "Du bist nicht am Zug." };
  if (isPass(move)) return { ok: true };
  const unit = unitById(state, move.unit);
  if (!unit || unit.seat !== seat) return { ok: false, reason: "Das ist nicht dein Zwerg." };
  if (unit.hp <= 0) return { ok: false, reason: "Dieser Zwerg sitzt schon im Liegestuhl." };
  if (unit.type !== state.drawn) return { ok: false, reason: `Diesmal ist ein ${SPECS[state.drawn].name} dran.` };
  const target = checkMoveTarget(state, unit, move.to);
  if (!target.ok) return target;
  if (dist(move.to, move.aim) < 1) return { ok: false, reason: "Bitte ein Ziel wählen." };
  return { ok: true };
}

function finish(state: GnomesState, seat: Seat, units: Unit[], events: GnomesEvent[], missed: [number, number], crowCooldown: [number, number]) {
  const moves = state.moves + 1;
  let winner: Seat | null = null;
  let winReason: string | null = null;
  const left = (s: Seat) => units.filter((u) => u.seat === s && u.hp > 0);
  const opp = otherSeat(seat);
  if (left(0).length === 0 && left(1).length === 0) {
    winner = opp;
    winReason = "der letzte Schuss hat auch den eigenen Trupp erwischt";
  } else if (left(opp).length === 0) {
    winner = seat;
    winReason = "alle Zwerge des Gegners sind nass";
  } else if (left(seat).length === 0) {
    winner = opp;
    winReason = "alle eigenen Zwerge sind nass";
  } else if (missed[seat] >= MAX_MISSED) {
    winner = opp;
    winReason = `${MAX_MISSED} Züge in Folge verpasst`;
  } else if (moves >= state.options.moveLimit) {
    const hp = (s: Seat) => left(s).reduce((sum, u) => sum + u.hp, 0);
    if (hp(0) !== hp(1)) winner = hp(0) > hp(1) ? 0 : 1;
    else if (left(0).length !== left(1).length) winner = left(0).length > left(1).length ? 0 : 1;
    // Völliger Gleichstand: der Nachziehende gewinnt (gleicht den Vorteil des ersten Zugs aus)
    else winner = otherSeat(startingSeatOf(state));
    winReason = "Zuglimit erreicht, mehr Wasser übrig";
  }

  const next = otherSeat(seat);
  let rng = state.rng;
  let drawn = state.drawn;
  const cooldown: [number, number] = [crowCooldown[0], crowCooldown[1]];
  if (winner === null) {
    // Beim eigenen nächsten Zug zählt die Pause der Vogelscheuche herunter
    if (cooldown[next] > 0) cooldown[next]--;
    [drawn, rng] = draw({ units, crowCooldown: cooldown }, next, rng);
    events.push({ type: "drawn", seat: next, unitType: drawn });
  } else {
    events.push({ type: "won", seat: winner, reason: winReason! });
  }
  return {
    state: { ...state, units, turn: winner === null ? next : state.turn, drawn, crowCooldown: cooldown, missed, rng, moves, winner, winReason },
    events
  };
}

/** Wer hat die Partie begonnen? (gerade Zugzahl = der Spieler am Zug hat begonnen) */
function startingSeatOf(state: GnomesState): Seat {
  return state.moves % 2 === 0 ? state.turn : otherSeat(state.turn);
}

export function applyGnomesMove(state: GnomesState, seat: Seat, move: GnomesMove): { state: GnomesState; events: GnomesEvent[] } {
  const events: GnomesEvent[] = [];
  const missed: [number, number] = [state.missed[0], state.missed[1]];
  if (isPass(move)) {
    missed[seat]++;
    events.push({ type: "passed", seat, missed: missed[seat] });
    return finish(state, seat, state.units, events, missed, state.crowCooldown);
  }
  missed[seat] = 0;
  const unit = unitById(state, move.unit)!;
  const to = { x: round1(move.to.x), y: round1(move.to.y) };
  const aim = { x: round1(move.aim.x), y: round1(move.aim.y) };
  let units = state.units.map((u) => ({ ...u }));
  const shooter = units.find((u) => u.id === unit.id)!;
  if (to.x !== unit.x || to.y !== unit.y) {
    events.push({ type: "moved", seat, unit: unit.id, from: { x: unit.x, y: unit.y }, to });
    shooter.facing = round1(angleOf(unit, to));
    shooter.x = to.x;
    shooter.y = to.y;
  }
  shooter.facing = round1(angleOf(shooter, aim));
  const shot = resolveShot(state, units, shooter, aim);
  const hits: Hit[] = [];
  const out: string[] = [];
  for (const h of shot.hits) {
    const u = units.find((x) => x.id === h.unit.id)!;
    const before = u.hp;
    u.hp = Math.max(0, u.hp - h.damage);
    hits.push({ unit: u.id, damage: before - u.hp, hp: u.hp });
    if (before > 0 && u.hp === 0) out.push(u.id);
  }
  events.push({ type: "shot", seat, unit: unit.id, weapon: SPECS[unit.type].weapon, from: { x: shooter.x, y: shooter.y }, aim, impact: shot.impact, hits });
  for (const id of out) events.push({ type: "out", unit: id });
  units = units.map((u) => u);
  const crowCooldown: [number, number] = [state.crowCooldown[0], state.crowCooldown[1]];
  if (unit.type === "scarecrow") crowCooldown[seat] = CROW_COOLDOWN;
  return finish(state, seat, units, events, missed, crowCooldown);
}

// --- Netzwerk ---------------------------------------------------------------

function vec(raw: unknown): Vec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { x, y } = raw as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > 10_000 || Math.abs(y) > 10_000) return null;
  return { x, y };
}

export function parseGnomesMove(raw: unknown): GnomesMove | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.pass === true) return { pass: true };
  if (typeof r.unit !== "string" || r.unit.length > 8) return null;
  const to = vec(r.to);
  const aim = vec(r.aim);
  if (!to || !aim) return null;
  return { unit: r.unit, to, aim };
}

/** Für Clients: ohne Zufallszustand, damit niemand die nächste Auslosung vorhersehen kann. */
export type PublicGnomesState = Omit<GnomesState, "rng">;

export function publicState(state: GnomesState): PublicGnomesState {
  const { rng: _rng, ...rest } = state;
  return rest;
}

/** Bedenkzeit pro Zug in Online-Partien. */
export const TURN_MS = 30_000;

export const gnomes: GameDefinition<GnomesState, GnomesMove, GnomesEvent> = {
  id: "gnomes",
  name: "Gartenfehde",
  players: 2,
  createInitialState: ({ seed, startingSeat, quick }) => createState(seed, startingSeat, quick ? { squad: "quick" } : {}),
  currentSeat: (state) => state.turn,
  parseMove: (raw) => {
    const move = parseGnomesMove(raw);
    // Aussetzen setzt nur der Server bei abgelaufener Zeit
    return move && isPass(move) ? null : move;
  },
  checkMove: checkGnomesMove,
  applyMove: applyGnomesMove,
  result(state): GameResult {
    return state.winner === null ? { kind: "running" } : { kind: "won", winner: state.winner, reason: state.winReason ?? "" };
  },
  publicView: (state) => publicState(state),
  turnTimeMs: TURN_MS,
  timeoutMove: () => ({ pass: true })
};

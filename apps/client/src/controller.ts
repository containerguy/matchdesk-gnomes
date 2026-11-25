import {
  alive,
  checkMoveTarget,
  SPECS,
  unitById,
  type ActMove,
  type GnomesEvent,
  type PublicGnomesState,
  type Unit,
  type Vec,
  type Weapon
} from "@gartenfehde/gnomes";
import type { Seat } from "@gartenfehde/core";

export type Phase = "choosing" | "animating" | "over";
/** Schritte eines eigenen Zugs: Zwerg wählen, Ziel zum Laufen, Ziel zum Spritzen. */
export type Step = "select" | "move" | "aim";

export type Plan = { step: Step; unit: string | null; to: Vec | null; aim: Vec | null };

/** Laufende Animation eines Zugs. Zeiten in ms ab `t0` (performance.now()). */
export type Anim = {
  key: number;
  t0: number;
  before: PublicGnomesState;
  after: PublicGnomesState;
  mover: { unit: string; from: Vec; to: Vec } | null;
  moveMs: number;
  shot: { unit: string; weapon: Weapon; from: Vec; aim: Vec; impact: Vec; hits: Array<{ unit: string; damage: number }> } | null;
  flightMs: number;
  /** Ab hier gelten die neuen Lebenspunkte. */
  impactAt: number;
  total: number;
};

export type Snapshot = {
  state: PublicGnomesState;
  phase: Phase;
  /** Darf dieser Bildschirm gerade ziehen? (online nur, wenn man selbst am Zug ist) */
  canAct: boolean;
  plan: Plan;
  /** Vorbereiteter Zug des Gegners (online) bzw. des Computers, zum Mitsehen. */
  remote: ActMove | null;
  anim: Anim | null;
  /** Hinweis zum letzten ungültigen Klick. */
  warning: string | null;
  /** Ablauf der Bedenkzeit (performance.now()-Zeit), null = keine Uhr. */
  deadline: number | null;
  log: string[];
  names: [string, string];
};

type Listener = () => void;

export const FLIGHT_MS: Record<Weapon, number> = { spray: 450, balloon: 750, cannon: 380, crows: 950 };
export const SPLASH_MS = 650;

export function unitLabel(u: Unit) {
  return SPECS[u.type].name;
}

export const emptyPlan = (): Plan => ({ step: "select", unit: null, to: null, aim: null });

/**
 * Gemeinsame Steuerung für lokale und Online-Partien: Zug vorbereiten, absenden und abspielen.
 */
export abstract class TableController {
  protected snapshot: Snapshot;
  private listeners = new Set<Listener>();
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private animKey = 0;

  constructor(state: PublicGnomesState, names: [string, string], log: string[]) {
    this.snapshot = {
      state,
      phase: state.winner === null ? "choosing" : "over",
      canAct: false,
      plan: emptyPlan(),
      remote: null,
      anim: null,
      warning: null,
      deadline: null,
      log,
      names
    };
  }

  protected abstract mayAct(state: PublicGnomesState): boolean;
  protected abstract submit(move: ActMove): void;
  /** Wird bei jeder Änderung des eigenen Plans aufgerufen, z. B. um ihn dem Gegner zu zeigen. */
  protected onPlan(_move: ActMove | null) {}

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snapshot;

  protected set(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  protected log(lines: string[]) {
    if (lines.length) this.set({ log: [...this.snapshot.log, ...lines].slice(-40) });
  }

  isAnimating() {
    return this.snapshot.phase === "animating";
  }

  /** Zwerge, die in diesem Zug gewählt werden dürfen. */
  eligible(): Unit[] {
    const { state, canAct } = this.snapshot;
    if (!canAct) return [];
    return alive(state, state.turn).filter((u) => u.type === state.drawn);
  }

  // ——— Zug vorbereiten ———

  private setPlan(plan: Plan, warning: string | null = null) {
    this.set({ plan, warning });
    const { unit, to, aim } = plan;
    this.onPlan(unit && to && aim ? { unit, to, aim } : null);
  }

  selectUnit(id: string) {
    if (!this.snapshot.canAct || this.snapshot.phase !== "choosing") return;
    const unit = this.eligible().find((u) => u.id === id);
    if (!unit) {
      const other = unitById(this.snapshot.state, id);
      if (other && other.seat === this.snapshot.state.turn && other.hp > 0) {
        this.set({ warning: `Diesmal ist ein ${SPECS[this.snapshot.state.drawn].name} dran.` });
      }
      return;
    }
    const stays = SPECS[unit.type].move === 0;
    this.setPlan({ step: stays ? "aim" : "move", unit: unit.id, to: { x: unit.x, y: unit.y }, aim: null });
  }

  /** Klick oder Tipp auf den Garten (Spielfeld-Koordinaten). */
  tapGround(p: Vec) {
    const { plan, canAct, phase, state } = this.snapshot;
    if (!canAct || phase !== "choosing") return;
    // Eigenen passenden Zwerg angetippt: auswählen (oder beim gewählten: stehen bleiben)
    const hit = this.eligible().find((u) => Math.hypot(u.x - p.x, u.y - p.y) <= 26);
    if (plan.step === "select") {
      if (hit) this.selectUnit(hit.id);
      else {
        const any = alive(state, state.turn).find((u) => Math.hypot(u.x - p.x, u.y - p.y) <= 26);
        if (any) this.selectUnit(any.id);
      }
      return;
    }
    const unit = plan.unit ? unitById(state, plan.unit) : undefined;
    if (!unit) return;
    if (plan.step === "move") {
      if (hit && hit.id !== unit.id) return this.selectUnit(hit.id);
      if (hit && hit.id === unit.id) return this.setPlan({ ...plan, step: "aim", to: { x: unit.x, y: unit.y } });
      this.setMoveTarget(p, true);
      return;
    }
    this.setAim(p);
  }

  /** Laufziel setzen; mit `advance` geht es danach gleich zum Zielen. */
  setMoveTarget(p: Vec, advance: boolean) {
    const { plan, state } = this.snapshot;
    const unit = plan.unit ? unitById(state, plan.unit) : undefined;
    if (!unit || plan.step !== "move") return;
    const to = { x: Math.round(p.x), y: Math.round(p.y) };
    const check = checkMoveTarget(state, unit, to);
    if (!check.ok) return this.set({ warning: check.reason });
    this.setPlan({ ...plan, to, step: advance ? "aim" : "move" });
  }

  setAim(p: Vec) {
    const { plan } = this.snapshot;
    if (plan.step !== "aim" || !plan.unit) return;
    this.setPlan({ ...plan, aim: { x: Math.round(p.x), y: Math.round(p.y) } });
  }

  /** Tastatur: Laufziel bzw. Zielpunkt verschieben. */
  nudge(dx: number, dy: number) {
    const { plan, state } = this.snapshot;
    const unit = plan.unit ? unitById(state, plan.unit) : undefined;
    if (!unit) return;
    if (plan.step === "move") {
      const base = plan.to ?? unit;
      const to = { x: Math.round(base.x + dx), y: Math.round(base.y + dy) };
      if (checkMoveTarget(state, unit, to).ok) this.setPlan({ ...plan, to });
      else this.set({ warning: "Weiter geht es nicht." });
    } else if (plan.step === "aim") {
      const from = plan.to ?? unit;
      const base = plan.aim ?? { x: from.x + (unit.seat === 0 ? 150 : -150), y: from.y };
      this.setAim({ x: base.x + dx, y: base.y + dy });
    }
  }

  /** Nächsten passenden Zwerg wählen (Tab-Taste). */
  cycleUnit() {
    const list = this.eligible();
    if (list.length === 0) return;
    const i = list.findIndex((u) => u.id === this.snapshot.plan.unit);
    this.selectUnit(list[(i + 1) % list.length]!.id);
  }

  /** Vom Laufen zum Zielen (Bewegung wie geplant). */
  confirmMove() {
    const { plan } = this.snapshot;
    if (plan.step === "move" && plan.unit) this.setPlan({ ...plan, step: "aim" });
  }

  back() {
    const { plan, state } = this.snapshot;
    const unit = plan.unit ? unitById(state, plan.unit) : undefined;
    if (plan.step === "aim" && unit && SPECS[unit.type].move > 0) return this.setPlan({ ...plan, step: "move", aim: null });
    if (plan.step !== "select" && this.eligible().length > 1) return this.setPlan(emptyPlan());
  }

  fire() {
    const { plan, canAct, phase } = this.snapshot;
    if (!canAct || phase !== "choosing" || plan.step !== "aim" || !plan.unit || !plan.to || !plan.aim) return;
    const move: ActMove = { unit: plan.unit, to: plan.to, aim: plan.aim };
    this.set({ canAct: false, warning: null });
    this.submit(move);
  }

  /** Vorbereiteten Zug des Gegners anzeigen. */
  protected showRemote(move: ActMove | null) {
    if (this.snapshot.phase === "choosing" && !this.snapshot.canAct) this.set({ remote: move });
  }

  /** Zustand übernehmen (ohne Animation). */
  protected adopt(state: PublicGnomesState, extraLog: string[] = []) {
    this.clearTimers();
    const canAct = state.winner === null && this.mayAct(state);
    let plan = emptyPlan();
    if (canAct) {
      const options = alive(state, state.turn).filter((u) => u.type === state.drawn);
      if (options.length === 1) {
        const u = options[0]!;
        plan = { step: SPECS[u.type].move === 0 ? "aim" : "move", unit: u.id, to: { x: u.x, y: u.y }, aim: null };
      }
    }
    this.set({ state, phase: state.winner === null ? "choosing" : "over", canAct, plan, remote: null, anim: null, warning: null });
    this.log(extraLog);
  }

  /** Einen Zug abspielen: laufen, schießen, platschen, dann den neuen Zustand übernehmen. */
  protected play(before: PublicGnomesState, seat: Seat, events: GnomesEvent[], after: PublicGnomesState, done?: () => void) {
    this.clearTimers();
    const names = this.snapshot.names;
    const moved = events.find((e) => e.type === "moved");
    const shot = events.find((e) => e.type === "shot");
    const mover = moved?.type === "moved" ? { unit: moved.unit, from: moved.from, to: moved.to } : null;
    const moveMs = mover ? Math.min(900, 250 + Math.hypot(mover.to.x - mover.from.x, mover.to.y - mover.from.y) * 2.2) : 0;
    const flightMs = shot?.type === "shot" ? FLIGHT_MS[shot.weapon] : 0;
    const impactAt = moveMs + (shot ? 150 : 0) + flightMs;
    const total = shot ? impactAt + SPLASH_MS : Math.max(moveMs, 400);
    const anim: Anim = {
      key: ++this.animKey,
      t0: performance.now(),
      before,
      after,
      mover,
      moveMs,
      shot: shot?.type === "shot" ? { unit: shot.unit, weapon: shot.weapon, from: shot.from, aim: shot.aim, impact: shot.impact, hits: shot.hits } : null,
      flightMs,
      impactAt,
      total
    };
    this.set({ phase: "animating", canAct: false, plan: emptyPlan(), remote: null, anim, warning: null, state: { ...before, turn: seat } });

    const lines: string[] = [];
    for (const e of events) {
      if (e.type === "passed") lines.push(`${names[e.seat]}: Zeit abgelaufen (${e.missed}. Mal in Folge)`);
      if (e.type === "shot") {
        const shooter = unitById(before, e.unit);
        const enemyHits = e.hits.filter((h) => unitById(before, h.unit)?.seat !== e.seat);
        const ownHits = e.hits.filter((h) => unitById(before, h.unit)?.seat === e.seat);
        const dealt = enemyHits.reduce((s, h) => s + h.damage, 0);
        let line = `${names[e.seat]}: ${shooter ? SPECS[shooter.type].weaponName : "Schuss"}`;
        line += dealt > 0 ? `, ${dealt} Wasser beim Gegner` : ", daneben";
        if (ownHits.length) line += `, ${ownHits.reduce((s, h) => s + h.damage, 0)} beim eigenen Trupp`;
        lines.push(line);
      }
      if (e.type === "out") {
        const u = unitById(before, e.unit);
        if (u) lines.push(`${u.seat === seat ? "Eigener" : "Gegnerischer"} ${SPECS[u.type].name} von ${names[u.seat]} sitzt im Liegestuhl.`);
      }
      if (e.type === "won") lines.push(`${names[e.seat]} gewinnt (${e.reason}).`);
    }
    this.schedule(total, () => {
      this.adopt(after, lines);
      done?.();
    });
  }

  private schedule(ms: number, task: () => void) {
    this.timers.push(setTimeout(task, ms));
  }

  protected clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  dispose() {
    this.clearTimers();
  }
}

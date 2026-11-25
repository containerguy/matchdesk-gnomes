import { alive, checkMoveTarget, HEIGHT, resolveShot, SPECS, unitById, WIDTH, type PublicGnomesState, type Unit, type Vec } from "@gartenfehde/gnomes";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import type { Anim, Snapshot, TableController } from "./controller";
import { drawAim, drawDamage, drawPath, drawProjectile, drawRange, drawSplash, drawUnit, gardenImage, TEAM } from "./draw";

type Camera = { zoom: number; cx: number; cy: number };
type View = { scale: number; ox: number; oy: number };

const MAX_ZOOM = 4;

function clampCamera(cam: Camera, w: number, h: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, cam.zoom));
  const fit = Math.min(w / WIDTH, h / HEIGHT);
  const scale = fit * zoom;
  const halfW = w / 2 / scale;
  const halfH = h / 2 / scale;
  const cx = halfW * 2 >= WIDTH ? WIDTH / 2 : Math.min(WIDTH - halfW, Math.max(halfW, cam.cx));
  const cy = halfH * 2 >= HEIGHT ? HEIGHT / 2 : Math.min(HEIGHT - halfH, Math.max(halfH, cam.cy));
  return { zoom, cx, cy };
}

function viewOf(cam: Camera, w: number, h: number): View {
  const scale = Math.min(w / WIDTH, h / HEIGHT) * cam.zoom;
  return { scale, ox: w / 2 - cam.cx * scale, oy: h / 2 - cam.cy * scale };
}

/** Zwerge, wie sie im Moment `now` der Animation zu sehen sind. */
function shownUnits(snap: Snapshot, now: number): Unit[] {
  const anim = snap.anim;
  if (!anim) return snap.state.units;
  const t = now - anim.t0;
  const source = t >= anim.impactAt ? anim.after.units : anim.before.units;
  return source.map((u) => {
    if (anim.mover && u.id === anim.mover.unit) {
      const p = Math.min(1, t / Math.max(1, anim.moveMs));
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const facing = p < 1 ? Math.atan2(anim.mover.to.y - anim.mover.from.y, anim.mover.to.x - anim.mover.from.x) : u.facing;
      return { ...u, x: anim.mover.from.x + (anim.mover.to.x - anim.mover.from.x) * e, y: anim.mover.from.y + (anim.mover.to.y - anim.mover.from.y) * e, facing };
    }
    return u;
  });
}

function drawAnim(ctx: CanvasRenderingContext2D, anim: Anim, units: Unit[], now: number) {
  const shot = anim.shot;
  if (!shot) return;
  const t = now - anim.t0;
  const start = anim.moveMs + 150;
  if (t >= start && t < anim.impactAt) drawProjectile(ctx, shot.weapon, shot.from, shot.impact, shot.aim, (t - start) / anim.flightMs);
  if (t >= anim.impactAt) {
    const s = Math.min(1, (t - anim.impactAt) / 650);
    const shooter = unitById(anim.before, shot.unit);
    if (shot.weapon !== "spray" && shooter) drawSplash(ctx, shot.impact, SPECS[shooter.type].splash, s);
    for (const h of shot.hits) {
      const u = units.find((x) => x.id === h.unit);
      if (u && h.damage > 0) drawDamage(ctx, u, h.damage, s);
    }
  }
}

function render(ctx: CanvasRenderingContext2D, snap: Snapshot, view: View, dpr: number, now: number, hover: Vec | null) {
  const { state, plan, canAct } = snap;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#4E7A3A";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
  ctx.drawImage(gardenImage(state.map), 0, 0);

  const units = shownUnits(snap, now);
  const eligible = new Set(canAct && snap.phase === "choosing" ? alive(state, state.turn).filter((u) => u.type === state.drawn).map((u) => u.id) : []);
  const selected = plan.unit ? units.find((u) => u.id === plan.unit) : undefined;

  // Planung: Laufbereich, Weg, Zielvorschau
  if (selected && canAct) {
    const spec = SPECS[selected.type];
    const to = plan.to ?? selected;
    if (plan.step === "move") {
      drawRange(ctx, selected, spec.move);
      const target = hover ?? (plan.to && (plan.to.x !== selected.x || plan.to.y !== selected.y) ? plan.to : null);
      if (target) {
        const ok = checkMoveTarget(state, selected, target).ok;
        drawPath(ctx, selected, target);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ok ? "#FFFFFF" : "#FF3B30";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(target.x, target.y, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (plan.step === "aim" && plan.aim) {
      const moved = { ...selected, x: to.x, y: to.y };
      const others = state.units.map((u) => (u.id === moved.id ? moved : u));
      const shot = resolveShot(state, others, moved, plan.aim);
      drawAim(ctx, spec.weapon, to, plan.aim, shot.impact, spec.splash, "#FFF6B0");
    }
    if (plan.step === "aim" && (to.x !== selected.x || to.y !== selected.y)) drawPath(ctx, selected, to);
  }
  // Vorschau des Gegners
  if (snap.remote && !snap.anim) {
    const u = unitById(state, snap.remote.unit);
    if (u) {
      if (snap.remote.to.x !== u.x || snap.remote.to.y !== u.y) drawPath(ctx, u, snap.remote.to);
      const moved = { ...u, x: snap.remote.to.x, y: snap.remote.to.y };
      const shot = resolveShot(state, state.units.map((x) => (x.id === u.id ? moved : x)), moved, snap.remote.aim);
      drawAim(ctx, SPECS[u.type].weapon, snap.remote.to, snap.remote.aim, shot.impact, SPECS[u.type].splash, TEAM[u.seat].coat);
    }
  }

  // Erst die Liegestühle, dann die Zwerge
  for (const u of units.filter((x) => x.hp <= 0)) drawUnit(ctx, u, { time: now });
  for (const u of units.filter((x) => x.hp > 0)) {
    drawUnit(ctx, u, { time: now, highlight: eligible.has(u.id) && !selected, selected: selected?.id === u.id });
  }
  // Geist am geplanten Standort
  if (selected && plan.step === "aim" && plan.to && (plan.to.x !== selected.x || plan.to.y !== selected.y)) {
    drawUnit(ctx, { ...selected, x: plan.to.x, y: plan.to.y }, { time: now, ghost: true });
  }
  if (snap.remote && !snap.anim) {
    const u = unitById(state, snap.remote.unit);
    if (u && (snap.remote.to.x !== u.x || snap.remote.to.y !== u.y)) drawUnit(ctx, { ...u, x: snap.remote.to.x, y: snap.remote.to.y }, { time: now, ghost: true });
  }
  if (snap.anim) drawAnim(ctx, snap.anim, units, now);
}

/** Text zum aktuellen Schritt des eigenen Zugs. */
export function stepText(snap: Snapshot, eligibleCount: number) {
  const { plan, state } = snap;
  const spec = SPECS[state.drawn];
  if (plan.step === "select") return eligibleCount > 1 ? `Wähle einen deiner ${spec.name}e (leuchten).` : "";
  if (plan.step === "move") return "Tippe auf den Rasen, wohin der Zwerg laufen soll, oder auf ihn selbst zum Stehenbleiben.";
  if (!plan.aim) return `Ziel für ${spec.weaponName} wählen: auf den Rasen tippen oder ziehen.`;
  return "Ziel passt? Dann „Spritzen!“.";
}

export function Board({ game, compact }: { game: TableController; compact?: boolean }) {
  const snap = useSyncExternalStore(game.subscribe, game.getSnapshot);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const cam = useRef<Camera>({ zoom: 1, cx: WIDTH / 2, cy: HEIGHT / 2 });
  const snapRef = useRef(snap);
  const hover = useRef<Vec | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; startX: number; startY: number; moved: boolean; button: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  /** Mit der Maus folgt das Ziel dem Zeiger, bis ein Klick es festlegt. */
  const aimLocked = useRef(false);
  snapRef.current = snap;
  useEffect(() => {
    aimLocked.current = false;
  }, [snap.plan.step, snap.plan.unit, snap.state.moves]);

  // Größe beobachten
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Zeichenschleife
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const c = canvas.current;
      if (c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        cam.current = clampCamera(cam.current, w, h);
        const view = viewOf(cam.current, w, h);
        const ctx = c.getContext("2d");
        if (ctx) render(ctx, snapRef.current, view, dpr, performance.now(), snapRef.current.plan.step === "move" ? hover.current : null);
        const el = wrap.current;
        if (el) {
          // Für Tests und Hilfsmittel: Umrechnung Spielfeld → Bildschirm
          el.dataset.view = `${view.scale.toFixed(5)},${view.ox.toFixed(2)},${view.oy.toFixed(2)}`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Am kleinen Bildschirm zum eigenen Zug heranzoomen
  const turnKey = `${snap.state.moves}-${snap.canAct}`;
  useEffect(() => {
    const s = snapRef.current;
    if (!s.canAct) return;
    const fit = Math.min(size.w / WIDTH, size.h / HEIGHT);
    if (fit >= 0.42) return;
    const units = alive(s.state, s.state.turn).filter((u) => u.type === s.state.drawn);
    if (units.length === 0) return;
    const cx = units.reduce((a, u) => a + u.x, 0) / units.length;
    const cy = units.reduce((a, u) => a + u.y, 0) / units.length;
    cam.current = clampCamera({ zoom: 0.5 / fit, cx, cy }, size.w, size.h);
  }, [turnKey, size.w, size.h]);

  const toWorld = (clientX: number, clientY: number): Vec => {
    const rect = canvas.current!.getBoundingClientRect();
    const view = viewOf(cam.current, rect.width, rect.height);
    return { x: (clientX - rect.left - view.ox) / view.scale, y: (clientY - rect.top - view.oy) / view.scale };
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const before = cam.current;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, before.zoom * factor));
    let { cx, cy } = before;
    if (clientX !== undefined && clientY !== undefined) {
      const p = toWorld(clientX, clientY);
      const ratio = before.zoom / zoom;
      cx = p.x + (before.cx - p.x) * ratio;
      cy = p.y + (before.cy - p.y) * ratio;
    }
    cam.current = clampCamera({ zoom, cx, cy }, rect.width, rect.height);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false, button: e.button });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: cam.current.zoom };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointers.current.get(e.pointerId);
    const s = snapRef.current;
    if (!p) {
      // Maus ohne gedrückte Taste: Vorschau
      if (e.pointerType === "mouse") {
        const world = toWorld(e.clientX, e.clientY);
        hover.current = world;
        if (s.plan.step === "aim" && s.canAct && !s.anim && !aimLocked.current) game.setAim(world);
      }
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 8) p.moved = true;
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const rect = canvas.current!.getBoundingClientRect();
      cam.current = clampCamera({ ...cam.current, zoom: pinch.current.zoom * (d / Math.max(1, pinch.current.dist)) }, rect.width, rect.height);
      return;
    }
    if (!p.moved) return;
    // Beim Zielen zieht ein Finger das Ziel, sonst wird die Karte verschoben
    const aiming = s.plan.step === "aim" && s.canAct && p.button === 0;
    if (aiming) {
      aimLocked.current = true;
      game.setAim(toWorld(e.clientX, e.clientY));
      return;
    }
    const rect = canvas.current!.getBoundingClientRect();
    const view = viewOf(cam.current, rect.width, rect.height);
    cam.current = clampCamera({ ...cam.current, cx: cam.current.cx - dx / view.scale, cy: cam.current.cy - dy / view.scale }, rect.width, rect.height);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!p || p.moved || p.button !== 0) return;
    if (pointers.current.size > 0) return;
    if (snapRef.current.plan.step === "aim") aimLocked.current = true;
    game.tapGround(toWorld(e.clientX, e.clientY));
    wrap.current?.focus({ preventScroll: true });
  };

  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 2 : 10;
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      a: [-step, 0],
      d: [step, 0],
      w: [0, -step],
      s: [0, step]
    };
    const k = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (k) {
      e.preventDefault();
      game.nudge(k[0], k[1]);
    } else if (e.key === "Tab" && snapRef.current.canAct && snapRef.current.plan.step === "select") {
      e.preventDefault();
      game.cycleUnit();
    } else if (e.key === "Enter") {
      e.preventDefault();
      game.confirmMove();
    } else if (e.key === " ") {
      e.preventDefault();
      game.fire();
    } else if (e.key === "Escape") {
      game.back();
    } else if (e.key === "+") zoomAt(1.25);
    else if (e.key === "-") zoomAt(0.8);
  };

  const state: PublicGnomesState = snap.state;
  const eligible = game.eligible();
  const selected = snap.plan.unit ? unitById(state, snap.plan.unit) : undefined;
  const fireLabel = selected ? `${SPECS[selected.type].weaponName} abfeuern` : "Spritzen!";

  return (
    <div className={`board-area ${compact ? "compact" : ""}`}>
      <div
        ref={wrap}
        className="board"
        tabIndex={0}
        role="application"
        aria-label="Garten"
        aria-describedby="board-help"
        data-moves={state.moves}
        data-phase={snap.phase}
        data-step={snap.canAct ? snap.plan.step : "wait"}
        data-map={state.map}
        data-turn={state.turn}
        data-remote={snap.remote ? snap.remote.unit : ""}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => (hover.current = null)}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="zoom" role="group" aria-label="Ansicht">
          <button type="button" aria-label="Näher heran" onClick={() => zoomAt(1.4)}>
            +
          </button>
          <button type="button" aria-label="Weiter weg" onClick={() => zoomAt(1 / 1.4)}>
            −
          </button>
          <button type="button" aria-label="Ganzer Garten" onClick={() => (cam.current = { zoom: 1, cx: WIDTH / 2, cy: HEIGHT / 2 })}>
            ⤢
          </button>
        </div>
        {snap.warning && (
          <div className="board-warning" role="status">
            {snap.warning}
          </div>
        )}
      </div>
      <p id="board-help" className="sr-only">
        Pfeiltasten oder WASD verschieben Laufziel und Zielpunkt, Enter bestätigt das Laufziel, Leertaste schießt, Escape geht einen Schritt zurück, Tab wechselt den Zwerg.
      </p>
      {snap.canAct && snap.phase === "choosing" && (
        <div className="controls">
          <p className="step-text">{stepText(snap, eligible.length)}</p>
          <div className="row wrap">
            {snap.plan.step !== "select" && (eligible.length > 1 || (snap.plan.step === "aim" && selected && SPECS[selected.type].move > 0)) && (
              <button type="button" className="ghost" onClick={() => game.back()}>
                Schritt zurück
              </button>
            )}
            {snap.plan.step === "move" && (
              <button type="button" className="ghost" onClick={() => game.confirmMove()}>
                {snap.plan.to && selected && (snap.plan.to.x !== selected.x || snap.plan.to.y !== selected.y) ? "Weiter zum Zielen" : "Hier stehen bleiben"}
              </button>
            )}
            {snap.plan.step === "aim" && (
              <button type="button" className="primary fire" disabled={!snap.plan.aim} aria-label={fireLabel} onClick={() => game.fire()}>
                Spritzen!
              </button>
            )}
          </div>
        </div>
      )}
      <ul className="sr-only unit-list" aria-label="Zwerge">
        {state.units.map((u) => (
          <li key={u.id} data-id={u.id} data-seat={u.seat} data-type={u.type} data-x={u.x} data-y={u.y} data-hp={u.hp}>
            {TEAM[u.seat].name}: {SPECS[u.type].name}, {u.hp > 0 ? `${u.hp} von ${u.maxHp} trocken` : "im Liegestuhl"}
          </li>
        ))}
      </ul>
    </div>
  );
}

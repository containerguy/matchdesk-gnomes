import { HEIGHT, mapById, SPECS, SPRAY_HALF_ANGLE, UNIT_RADIUS, WIDTH, type Feature, type Unit, type Vec, type Weapon } from "@gartenfehde/gnomes";

/** Alles selbst gezeichnet: Schrebergarten von oben, Zwerge, Wasser. */

export const TEAM = [
  { hat: "#D7263D", coat: "#F25C54", dark: "#8E1B2A", name: "Rot" },
  { hat: "#1E6FD9", coat: "#5AA9F2", dark: "#123F7A", name: "Blau" }
] as const;

const WATER = "#5EC8F2";
const WATER_DARK = "#2E8FC4";

/** Kleiner fester Zufall für Grashalme und Kies, damit der Garten bei jedem Zeichnen gleich aussieht. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawFeature(ctx: CanvasRenderingContext2D, f: Feature, rnd: () => number) {
  if (f.kind === "path" && f.shape === "rect") {
    ctx.fillStyle = "#D9C9A3";
    roundRect(ctx, f.x, f.y, f.w, f.h, 10);
    ctx.fill();
    ctx.fillStyle = "#BFAE86";
    const n = Math.floor((f.w * f.h) / 140);
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(f.x + 4 + rnd() * (f.w - 8), f.y + 4 + rnd() * (f.h - 8), 1.5 + rnd() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (f.kind === "bed" && f.shape === "rect") {
    ctx.fillStyle = "#7A5236";
    roundRect(ctx, f.x, f.y, f.w, f.h, 8);
    ctx.fill();
    ctx.strokeStyle = "#5C3B24";
    ctx.lineWidth = 3;
    ctx.stroke();
    // Reihen mit Pflänzchen
    for (let y = f.y + 15; y < f.y + f.h - 8; y += 18) {
      for (let x = f.x + 14; x < f.x + f.w - 8; x += 22) {
        ctx.fillStyle = rnd() < 0.3 ? "#E8A33D" : "#5FB548";
        ctx.beginPath();
        ctx.ellipse(x - 3, y, 5, 3, -0.6, 0, Math.PI * 2);
        ctx.ellipse(x + 3, y, 5, 3, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }
  if (f.kind === "pond" && f.shape === "circle") {
    ctx.fillStyle = "#3F8F4E";
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r + 8, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(f.x - f.r * 0.3, f.y - f.r * 0.3, f.r * 0.1, f.x, f.y, f.r);
    g.addColorStop(0, "#8ADAF5");
    g.addColorStop(1, "#2C86B8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
    // Seerosenblätter
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const d = f.r * (0.3 + rnd() * 0.45);
      ctx.fillStyle = "#4BA35A";
      ctx.beginPath();
      ctx.moveTo(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d);
      ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 10, a + 0.4, a + Math.PI * 2 - 0.4);
      ctx.fill();
    }
    return;
  }
  if (f.kind === "rock" && f.shape === "circle") {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(f.x + 5, f.y + 7, f.r, f.r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9AA0A6";
    ctx.beginPath();
    const pts = 9;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = f.r * (0.88 + rnd() * 0.14);
      const x = f.x + Math.cos(a) * rr;
      const y = f.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#C3C8CC";
    ctx.beginPath();
    ctx.ellipse(f.x - f.r * 0.25, f.y - f.r * 0.3, f.r * 0.45, f.r * 0.3, -0.4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (f.kind === "hedge" && f.shape === "rect") {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    roundRect(ctx, f.x + 5, f.y + 6, f.w, f.h, 14);
    ctx.fill();
    ctx.fillStyle = "#2F7A3A";
    roundRect(ctx, f.x, f.y, f.w, f.h, 14);
    ctx.fill();
    // Buschige Kugeln
    const long = Math.max(f.w, f.h);
    const vertical = f.h > f.w;
    for (let t = 10; t < long - 6; t += 14) {
      const x = vertical ? f.x + f.w / 2 + (rnd() - 0.5) * 6 : f.x + t;
      const y = vertical ? f.y + t : f.y + f.h / 2 + (rnd() - 0.5) * 6;
      ctx.fillStyle = rnd() < 0.5 ? "#3C9447" : "#348A40";
      ctx.beginPath();
      ctx.arc(x, y, Math.min(f.w, f.h) * 0.48, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (f.kind === "shed" && f.shape === "rect") {
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(f.x + 7, f.y + 9, f.w, f.h);
    ctx.fillStyle = "#A0522D";
    ctx.fillRect(f.x, f.y, f.w, f.h);
    // Dach von oben: zwei Flächen mit Schindeln
    ctx.fillStyle = "#B8653A";
    ctx.fillRect(f.x, f.y, f.w, f.h / 2);
    ctx.strokeStyle = "#7E3F20";
    ctx.lineWidth = 2;
    for (let y = f.y + 12; y < f.y + f.h; y += 12) {
      ctx.beginPath();
      ctx.moveTo(f.x, y);
      ctx.lineTo(f.x + f.w, y);
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#6B341A";
    ctx.beginPath();
    ctx.moveTo(f.x, f.y + f.h / 2);
    ctx.lineTo(f.x + f.w, f.y + f.h / 2);
    ctx.stroke();
    ctx.strokeRect(f.x, f.y, f.w, f.h);
  }
}

const gardenCache = new Map<string, HTMLCanvasElement>();

/** Hintergrund einer Karte (einmal gezeichnet, dann wiederverwendet). */
export function gardenImage(mapId: string): HTMLCanvasElement {
  const cached = gardenCache.get(mapId);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const rnd = rand(mapId.length * 977 + mapId.charCodeAt(0));
  // Rasen mit Mähstreifen
  for (let i = 0; i < WIDTH / 80; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#8CCB5E" : "#82C155";
    ctx.fillRect(i * 80, 0, 80, HEIGHT);
  }
  ctx.strokeStyle = "rgba(60,110,40,0.35)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * WIDTH;
    const y = rnd() * HEIGHT;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 4, y - 5 - rnd() * 4);
    ctx.stroke();
  }
  // Gänseblümchen
  for (let i = 0; i < 70; i++) {
    const x = rnd() * WIDTH;
    const y = rnd() * HEIGHT;
    ctx.fillStyle = "#FFFFFF";
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#F5C518";
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = mapById(mapId);
  const order: Feature["kind"][] = ["path", "bed", "pond", "rock", "hedge", "shed"];
  for (const kind of order) for (const f of map.features.filter((x) => x.kind === kind)) drawFeature(ctx, f, rnd);
  // Zaun am Rand
  ctx.strokeStyle = "#C9A26B";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, WIDTH - 6, HEIGHT - 6);
  gardenCache.set(mapId, canvas);
  return canvas;
}

// ——— Zwerge ———

function drawVehicle(ctx: CanvasRenderingContext2D, u: Unit, team: (typeof TEAM)[number]) {
  const r = UNIT_RADIUS;
  if (u.type === "mower") {
    // Rasenmäher: Gehäuse mit vier Rädern, Zwerg sitzt drauf
    ctx.fillStyle = "#2B2B2B";
    for (const [x, y] of [[-r * 0.7, -r * 0.85], [r * 0.5, -r * 0.85], [-r * 0.7, r * 0.85], [r * 0.5, r * 0.85]]) {
      roundRect(ctx, x! - 5, y! - 4, 11, 8, 3);
      ctx.fill();
    }
    ctx.fillStyle = "#3FA34D";
    roundRect(ctx, -r * 0.95, -r * 0.75, r * 1.9, r * 1.5, 6);
    ctx.fill();
    ctx.fillStyle = "#2E7D38";
    roundRect(ctx, r * 0.55, -r * 0.6, r * 0.45, r * 1.2, 4);
    ctx.fill();
  } else if (u.type === "barrow") {
    // Schubkarre: große Wanne, Rad vorn, Griffe hinten
    ctx.strokeStyle = "#5A4632";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.55);
    ctx.lineTo(-r * 1.35, -r * 0.7);
    ctx.moveTo(-r * 0.6, r * 0.55);
    ctx.lineTo(-r * 1.35, r * 0.7);
    ctx.stroke();
    ctx.fillStyle = "#2B2B2B";
    roundRect(ctx, r * 0.9, -4, 12, 8, 3);
    ctx.fill();
    ctx.fillStyle = "#7D8A96";
    roundRect(ctx, -r * 0.8, -r * 0.85, r * 1.8, r * 1.7, 8);
    ctx.fill();
    ctx.fillStyle = "#A9B4BE";
    roundRect(ctx, -r * 0.6, -r * 0.65, r * 1.4, r * 1.3, 6);
    ctx.fill();
    // Gießkanne als Kanone
    ctx.fillStyle = "#E0B040";
    roundRect(ctx, r * 0.2, -4, r * 1.3, 8, 3);
    ctx.fill();
  } else if (u.type === "sling") {
    // Schleuder in der Hand
    ctx.strokeStyle = "#8B5A2B";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(r * 0.5, 0);
    ctx.lineTo(r * 1.05, 0);
    ctx.moveTo(r * 1.05, 0);
    ctx.lineTo(r * 1.4, -r * 0.4);
    ctx.moveTo(r * 1.05, 0);
    ctx.lineTo(r * 1.4, r * 0.4);
    ctx.stroke();
    ctx.fillStyle = WATER;
    ctx.beginPath();
    ctx.arc(r * 0.55, r * 0.55, 6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Vogelscheuche: Querholz mit Strohärmeln
    ctx.strokeStyle = "#8B5A2B";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3);
    ctx.lineTo(0, r * 1.3);
    ctx.stroke();
    ctx.strokeStyle = "#E3C567";
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, s * r * 1.3);
      ctx.lineTo(-5, s * r * 1.55);
      ctx.moveTo(0, s * r * 1.3);
      ctx.lineTo(5, s * r * 1.55);
      ctx.stroke();
    }
    ctx.fillStyle = team.coat;
    roundRect(ctx, -r * 0.5, -r * 1.0, r * 1.0, r * 2.0, 5);
    ctx.fill();
  }
}

/** Ein Zwerg von oben: Fahrzeug, Mantel, weißer Bart, Zipfelmütze in Teamfarbe. */
export function drawUnit(ctx: CanvasRenderingContext2D, u: Unit, opts: { highlight?: boolean; selected?: boolean; ghost?: boolean; time: number }) {
  const team = TEAM[u.seat];
  const r = UNIT_RADIUS;
  ctx.save();
  ctx.translate(u.x, u.y);
  if (u.hp <= 0) {
    drawDeckchair(ctx, team);
    ctx.restore();
    return;
  }
  if (opts.ghost) ctx.globalAlpha = 0.45;
  // Schatten
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(4, 6, r * 1.15, r, 0, 0, Math.PI * 2);
  ctx.fill();
  if (opts.selected || opts.highlight) {
    const pulse = opts.selected ? 1 : 0.6 + 0.4 * Math.sin(opts.time / 220);
    ctx.strokeStyle = opts.selected ? "#FFF6B0" : `rgba(255,246,176,${pulse})`;
    ctx.lineWidth = opts.selected ? 5 : 4;
    ctx.beginPath();
    ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(u.facing);
  drawVehicle(ctx, u, team);
  // Schultern / Mantel
  ctx.fillStyle = team.coat;
  ctx.beginPath();
  ctx.ellipse(-2, 0, r * 0.6, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bart (zeigt nach vorn)
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.ellipse(r * 0.32, 0, r * 0.34, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // Nase
  ctx.fillStyle = "#F2B9A0";
  ctx.beginPath();
  ctx.arc(r * 0.42, 0, 3.4, 0, Math.PI * 2);
  ctx.fill();
  // Zipfelmütze: von oben ein Kreis mit Spitze nach hinten
  ctx.fillStyle = team.hat;
  ctx.beginPath();
  ctx.arc(-1, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-1, -r * 0.3);
  ctx.lineTo(-r * 0.95, 0);
  ctx.lineTo(-1, r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = team.dark;
  ctx.beginPath();
  ctx.arc(-r * 0.9, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Lebensbalken
  if (!opts.ghost) {
    const w = 36;
    const frac = u.hp / u.maxHp;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, u.x - w / 2 - 1, u.y - r - 15, w + 2, 7, 3);
    ctx.fill();
    ctx.fillStyle = frac > 0.5 ? "#4CD964" : frac > 0.25 ? "#FFCC00" : "#FF3B30";
    roundRect(ctx, u.x - w / 2, u.y - r - 14, w * frac, 5, 2);
    ctx.fill();
  }
}

function drawDeckchair(ctx: CanvasRenderingContext2D, team: (typeof TEAM)[number]) {
  // Pfütze
  ctx.fillStyle = "rgba(94,200,242,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, 4, 26, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Liegestuhl mit Streifen in Teamfarbe
  ctx.strokeStyle = "#8B5A2B";
  ctx.lineWidth = 3;
  ctx.strokeRect(-11, -16, 22, 30);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? team.coat : "#FFFFFF";
    ctx.fillRect(-10 + i * 5, -15, 5, 28);
  }
  // Mütze des nassen Zwergs
  ctx.fillStyle = team.hat;
  ctx.beginPath();
  ctx.arc(0, -8, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WATER_DARK;
  for (const [x, y] of [[-14, -18], [14, -12], [-16, 10]]) {
    ctx.beginPath();
    ctx.ellipse(x!, y!, 2, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ——— Vorschau und Effekte ———

export function drawRange(ctx: CanvasRenderingContext2D, center: Vec, radius: number) {
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawPath(ctx: CanvasRenderingContext2D, from: Vec, to: Vec) {
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Zielvorschau je Waffe. */
export function drawAim(ctx: CanvasRenderingContext2D, weapon: Weapon, from: Vec, aim: Vec, impact: Vec, splash: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  if (weapon === "spray") {
    const dir = Math.atan2(aim.y - from.y, aim.x - from.x);
    const range = SPECS.mower.range;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.arc(from.x, from.y, range, dir - SPRAY_HALF_ANGLE, dir + SPRAY_HALF_ANGLE);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.9;
    ctx.setLineDash(weapon === "balloon" ? [4, 7] : weapon === "crows" ? [2, 10] : []);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    if (weapon === "balloon") {
      const mid = { x: (from.x + impact.x) / 2, y: (from.y + impact.y) / 2 - Math.hypot(impact.x - from.x, impact.y - from.y) * 0.25 };
      ctx.quadraticCurveTo(mid.x, mid.y, impact.x, impact.y);
    } else ctx.lineTo(impact.x, impact.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(impact.x, impact.y, splash + UNIT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    // Fadenkreuz
    ctx.beginPath();
    ctx.moveTo(impact.x - 10, impact.y);
    ctx.lineTo(impact.x + 10, impact.y);
    ctx.moveTo(impact.x, impact.y - 10);
    ctx.lineTo(impact.x, impact.y + 10);
    ctx.stroke();
  }
  ctx.restore();
}

/** Flugphase eines Schusses; t von 0 bis 1. */
export function drawProjectile(ctx: CanvasRenderingContext2D, weapon: Weapon, from: Vec, impact: Vec, aim: Vec, t: number) {
  ctx.save();
  if (weapon === "spray") {
    const dir = Math.atan2(aim.y - from.y, aim.x - from.x);
    const reach = SPECS.mower.range * Math.min(1, t * 1.4);
    const r = rand(7);
    ctx.fillStyle = WATER;
    for (let i = 0; i < 70; i++) {
      const a = dir + (r() - 0.5) * 2 * SPRAY_HALF_ANGLE;
      const d = r() * reach;
      ctx.globalAlpha = 0.85 * (1 - t * 0.5);
      ctx.beginPath();
      ctx.arc(from.x + Math.cos(a) * d, from.y + Math.sin(a) * d, 2.5 + r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (weapon === "crows") {
    // Krähenschwarm zieht von oben links herein
    const start = { x: impact.x - 500, y: impact.y - 400 };
    const r = rand(3);
    for (let i = 0; i < 9; i++) {
      const off = { x: (r() - 0.5) * 120, y: (r() - 0.5) * 90 };
      const x = start.x + (impact.x - start.x) * t + off.x * (1 - t * 0.6);
      const y = start.y + (impact.y - start.y) * t + off.y * (1 - t * 0.6);
      drawCrow(ctx, x, y, t * 30 + i);
    }
  } else {
    let x = from.x + (impact.x - from.x) * t;
    let y = from.y + (impact.y - from.y) * t;
    let size = weapon === "cannon" ? 8 : 10;
    if (weapon === "balloon") {
      const lift = Math.sin(Math.PI * t);
      y -= lift * Math.hypot(impact.x - from.x, impact.y - from.y) * 0.25;
      size += lift * 8;
      // Schatten am Boden
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(from.x + (impact.x - from.x) * t, from.y + (impact.y - from.y) * t, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      x = from.x + (impact.x - from.x) * t;
    }
    ctx.fillStyle = weapon === "balloon" ? "#7FD3F7" : WATER;
    ctx.strokeStyle = WATER_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(x - size * 0.35, y - size * 0.35, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCrow(ctx: CanvasRenderingContext2D, x: number, y: number, phase: number) {
  const flap = Math.sin(phase) * 7;
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.ellipse(x, y, 7, 4, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - 12, y - flap);
  ctx.quadraticCurveTo(x - 4, y - 6, x, y);
  ctx.quadraticCurveTo(x + 4, y - 6, x + 12, y - flap);
  ctx.stroke();
  ctx.fillStyle = WATER;
  ctx.beginPath();
  ctx.arc(x + 2, y + 6, 3, 0, Math.PI * 2);
  ctx.fill();
}

/** Platscher am Einschlag; t von 0 bis 1. */
export function drawSplash(ctx: CanvasRenderingContext2D, at: Vec, radius: number, t: number) {
  ctx.save();
  const rr = Math.max(25, radius) * (0.4 + t * 0.9);
  ctx.globalAlpha = 0.7 * (1 - t);
  ctx.strokeStyle = WATER;
  ctx.lineWidth = 6 * (1 - t) + 1;
  ctx.beginPath();
  ctx.arc(at.x, at.y, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = WATER;
  const r = rand(11);
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const d = rr * (0.3 + r() * 0.8);
    ctx.beginPath();
    ctx.arc(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, 3 + r() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Schaden als aufsteigende Zahl. */
export function drawDamage(ctx: CanvasRenderingContext2D, at: Vec, damage: number, t: number) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, 2 * (1 - t));
  ctx.font = "bold 26px 'Baloo 2', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#0B3954";
  ctx.fillStyle = "#FFFFFF";
  const y = at.y - UNIT_RADIUS - 20 - t * 30;
  ctx.strokeText(`-${damage}`, at.x, y);
  ctx.fillText(`-${damage}`, at.x, y);
  ctx.restore();
}

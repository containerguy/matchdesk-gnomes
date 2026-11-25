/** Kleine Geometrie-Helfer für Spielfeld, Bewegung und Schüsse. Alles in Spielfeld-Einheiten. */

export type Vec = { x: number; y: number };

export type Shape =
  | { shape: "circle"; x: number; y: number; r: number }
  | { shape: "rect"; x: number; y: number; w: number; h: number };

export function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleOf(from: Vec, to: Vec) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Kleinster Winkelabstand zweier Richtungen (0 … π). */
export function angleDiff(a: number, b: number) {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

export function lerp(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Abstand eines Punkts zum Rand einer Form; negativ bzw. 0 heißt innen. */
export function distToShape(p: Vec, s: Shape) {
  if (s.shape === "circle") return Math.hypot(p.x - s.x, p.y - s.y) - s.r;
  const dx = Math.max(s.x - p.x, 0, p.x - (s.x + s.w));
  const dy = Math.max(s.y - p.y, 0, p.y - (s.y + s.h));
  return Math.hypot(dx, dy);
}

export function insideShape(p: Vec, s: Shape) {
  return distToShape(p, s) <= 0;
}

/** Punkte entlang einer Strecke im Abstand `step` (Anfang und Ende eingeschlossen). */
export function samples(a: Vec, b: Vec, step = 4): Vec[] {
  const n = Math.max(1, Math.ceil(dist(a, b) / step));
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) out.push(lerp(a, b, i / n));
  return out;
}

/** Kommt die Strecke a→b der Form näher als `pad`? */
export function segmentTouches(a: Vec, b: Vec, s: Shape, pad = 0) {
  return samples(a, b).some((p) => distToShape(p, s) < pad);
}

/** Erster Abstand entlang a→b (0 … Länge), an dem ein Kreis um c mit Radius r berührt wird; null, wenn nie. */
export function rayCircle(a: Vec, b: Vec, c: Vec, r: number): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const ux = dx / len;
  const uy = dy / len;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const bq = fx * ux + fy * uy;
  const cq = fx * fx + fy * fy - r * r;
  const disc = bq * bq - cq;
  if (disc < 0) return null;
  const t = -bq - Math.sqrt(disc);
  if (t < 0 || t > len) return cq <= 0 ? 0 : null;
  return t;
}

export function clampToRange(from: Vec, to: Vec, range: number): Vec {
  const d = dist(from, to);
  if (d <= range || d === 0) return { x: to.x, y: to.y };
  return lerp(from, to, range / d);
}

export function round1(v: number) {
  return Math.round(v * 10) / 10;
}

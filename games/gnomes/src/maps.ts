import type { Shape, Vec } from "./geometry";

/**
 * Schrebergärten. Jede Karte beschreibt nur die linke Hälfte; die rechte entsteht durch Spiegeln
 * am Mittelpunkt, damit beide Seiten gleich gute Bedingungen haben.
 */

export const WIDTH = 1600;
export const HEIGHT = 1000;

/**
 * hedge, rock, shed: blockieren Bewegung und flache Schüsse (Spritze, Gießkanne).
 * pond: blockiert nur Bewegung, Schüsse gehen darüber.
 * bed (Beet): Bewegung kostet das 1,5-Fache. path (Kiesweg): Bewegung kostet nur 0,6.
 */
export type FeatureKind = "hedge" | "rock" | "shed" | "pond" | "bed" | "path";
export type Feature = Shape & { kind: FeatureKind };

export type MapDef = {
  id: string;
  name: string;
  features: Feature[];
  /** Startplätze für Platz 1 (links), in der Reihenfolge der Aufstellung. */
  starts: Vec[];
};

function mirror(f: Feature): Feature {
  if (f.shape === "circle") return { ...f, x: WIDTH - f.x, y: HEIGHT - f.y };
  return { ...f, x: WIDTH - f.x - f.w, y: HEIGHT - f.y - f.h };
}

/** Gespiegelter Startplatz für Platz 2. */
export function mirrorPoint(p: Vec): Vec {
  return { x: WIDTH - p.x, y: HEIGHT - p.y };
}

type HalfMap = { id: string; name: string; half: Feature[]; center: Feature[]; starts: Vec[] };

function build(m: HalfMap): MapDef {
  return { id: m.id, name: m.name, features: [...m.center, ...m.half, ...m.half.map(mirror)], starts: m.starts };
}

const c = (kind: FeatureKind, x: number, y: number, r: number): Feature => ({ kind, shape: "circle", x, y, r });
const r = (kind: FeatureKind, x: number, y: number, w: number, h: number): Feature => ({ kind, shape: "rect", x, y, w, h });

/**
 * Aufstellung (Reihenfolge wie `SQUAD`): Vogelscheuche, 2 Schubkarren, 3 Rasenmäher, 3 Schleudern.
 */
export const MAPS: MapDef[] = [
  build({
    id: "allotment",
    name: "Schrebergarten",
    center: [c("pond", 800, 500, 80)],
    half: [
      r("shed", 40, 40, 150, 110),
      r("path", 0, 600, 640, 44),
      r("hedge", 520, 170, 30, 220),
      r("bed", 300, 420, 130, 64),
      c("rock", 400, 760, 38),
      c("rock", 680, 860, 30),
      r("bed", 620, 40, 150, 60),
      r("hedge", 980, 640, 30, 160)
    ],
    starts: [
      { x: 80, y: 500 },
      { x: 200, y: 300 },
      { x: 200, y: 740 },
      { x: 330, y: 230 },
      { x: 360, y: 540 },
      { x: 300, y: 880 },
      { x: 120, y: 220 },
      { x: 240, y: 520 },
      { x: 120, y: 820 }
    ]
  }),
  build({
    id: "vegetables",
    name: "Gemüsegarten",
    center: [r("hedge", 785, 380, 30, 240)],
    half: [
      r("bed", 260, 120, 200, 60),
      r("bed", 260, 820, 200, 60),
      r("bed", 520, 470, 160, 60),
      r("path", 0, 300, 760, 40),
      c("pond", 560, 780, 70),
      c("rock", 450, 360, 32),
      r("shed", 620, 120, 110, 90),
      c("rock", 990, 210, 34)
    ],
    starts: [
      { x: 70, y: 500 },
      { x: 180, y: 380 },
      { x: 180, y: 640 },
      { x: 340, y: 240 },
      { x: 380, y: 520 },
      { x: 340, y: 720 },
      { x: 120, y: 160 },
      { x: 260, y: 480 },
      { x: 120, y: 860 }
    ]
  }),
  build({
    id: "roses",
    name: "Rosengarten",
    center: [c("rock", 800, 500, 50)],
    half: [
      r("hedge", 400, 120, 30, 260),
      r("hedge", 400, 620, 30, 260),
      r("hedge", 620, 330, 200, 30),
      r("path", 430, 470, 300, 60),
      c("pond", 220, 120, 60),
      r("bed", 520, 760, 140, 60),
      c("rock", 640, 160, 28),
      r("shed", 40, 880, 160, 100)
    ],
    starts: [
      { x: 70, y: 500 },
      { x: 200, y: 330 },
      { x: 200, y: 670 },
      { x: 320, y: 230 },
      { x: 330, y: 500 },
      { x: 320, y: 780 },
      { x: 110, y: 250 },
      { x: 220, y: 500 },
      { x: 110, y: 760 }
    ]
  })
];

export function mapById(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0]!;
}

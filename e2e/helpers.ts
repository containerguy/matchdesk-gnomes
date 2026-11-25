import { expect, type Browser, type Page } from "@playwright/test";

export const HINT = {
  myTurn: /^Du bist dran/,
  over: "Partie vorbei."
};

export async function newPlayer(browser: Browser, options: { phone?: boolean } = {}) {
  const context = await browser.newContext(
    options.phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } }
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { context, page, errors };
}

export async function enterLobby(page: Page, name: string, path = "/") {
  await page.goto(path);
  await page.getByLabel("Dein Name").fill(name);
  await page.getByRole("button", { name: "Weiter zur Lobby" }).click();
}

export const hint = (page: Page) => page.locator("p.hint");
export const board = (page: Page) => page.locator(".board");
export const gameLog = (page: Page) => page.locator("ol.log li");

export type UnitInfo = { id: string; seat: number; type: string; x: number; y: number; hp: number };

/** Zwerge, wie dieser Spieler sie gerade sieht (aus der barrierefreien Liste neben dem Garten). */
export async function units(page: Page): Promise<UnitInfo[]> {
  return page.locator(".unit-list li").evaluateAll((items) =>
    items.map((li) => {
      const d = (li as HTMLElement).dataset;
      return { id: d.id!, seat: Number(d.seat), type: d.type!, x: Number(d.x), y: Number(d.y), hp: Number(d.hp) };
    })
  );
}

/** Lebenspunkte aller Zwerge als Text, zum Vergleich zwischen zwei Geräten. */
export async function unitSummary(page: Page) {
  return (await units(page)).map((u) => `${u.id}:${u.x},${u.y},${u.hp}`).join(" ");
}

export async function moveCount(page: Page) {
  return Number(await board(page).getAttribute("data-moves"));
}

export async function step(page: Page) {
  return (await board(page).getAttribute("data-step")) ?? "wait";
}

/** Wartet, bis dieser Spieler am Zug ist oder die Partie vorbei ist. Gibt false zurück, wenn sie vorbei ist. */
export async function waitForTurn(page: Page, timeout = 60_000) {
  await expect(hint(page)).toHaveText(/^Du bist dran|Partie vorbei/, { timeout });
  return !(await hint(page).innerText()).includes(HINT.over);
}

/** Wartet, bis die Animation vorbei ist und der Zug ausgewertet ist. */
export async function settled(page: Page, after: number, timeout = 20_000) {
  await expect.poll(async () => (await moveCount(page)) > after && (await board(page).getAttribute("data-phase")) !== "animating", { timeout }).toBe(true);
}

/** Bildschirmpunkt eines Spielfeldpunkts. */
export async function toScreen(page: Page, p: { x: number; y: number }) {
  const [scale, ox, oy] = ((await board(page).getAttribute("data-view")) ?? "1,0,0").split(",").map(Number) as [number, number, number];
  const box = (await page.locator(".board canvas").boundingBox())!;
  return { x: box.x + ox + p.x * scale, y: box.y + oy + p.y * scale };
}

/** Auf einen Punkt im Garten klicken (Maus) oder tippen (Touch). */
export async function tapAt(page: Page, p: { x: number; y: number }, touch = false) {
  const s = await toScreen(page, p);
  if (touch) await page.touchscreen.tap(s.x, s.y);
  else await page.mouse.click(s.x, s.y);
}

/** Ganzen Garten zeigen, damit jeder Punkt antippbar ist. */
export async function showAll(page: Page) {
  await page.getByRole("button", { name: "Ganzer Garten" }).click();
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Ein ganzer Zug über die Oberfläche: Zwerg wählen, ggf. ein Stück auf den nächsten Gegner zulaufen,
 * auf ihn zielen und abfeuern.
 */
export async function playTurn(page: Page, options: { touch?: boolean; walk?: number; wait?: boolean; aim?: { x: number; y: number }; fire?: boolean } = {}) {
  const touch = options.touch ?? false;
  await expect.poll(() => step(page)).not.toBe("wait");
  await showAll(page);
  const before = await moveCount(page);
  const turn = Number(await board(page).getAttribute("data-turn"));
  const drawn = (await page.getByTestId("drawn").getAttribute("data-type"))!;
  const all = await units(page);
  const mine = all.filter((u) => u.seat === turn && u.type === drawn && u.hp > 0);
  const enemies = all.filter((u) => u.seat !== turn && u.hp > 0);

  if ((await step(page)) === "select") {
    await tapAt(page, mine[0]!, touch);
    await expect.poll(() => step(page)).not.toBe("select");
  }
  let me = mine[0]!;
  const target = enemies.reduce((a, b) => (dist(a, me) <= dist(b, me) ? a : b));

  if ((await step(page)) === "move") {
    const walk = options.walk ?? 0;
    if (walk > 0) {
      const d = dist(me, target);
      const to = { x: Math.round(me.x + ((target.x - me.x) / d) * walk), y: Math.round(me.y + ((target.y - me.y) / d) * walk) };
      await tapAt(page, to, touch);
      if ((await step(page)) === "aim") me = { ...me, ...to };
    }
    if ((await step(page)) === "move") await tapAt(page, me, touch);
    await expect.poll(() => step(page)).toBe("aim");
  }
  await tapAt(page, options.aim ?? target, touch);
  const fire = page.locator("button.fire");
  await expect(fire).toBeEnabled();
  if (options.fire === false) return;
  if (touch) await fire.tap();
  else await fire.click();
  if (options.wait !== false) await settled(page, before);
}

/** Einfacher fester Zufall, damit Testläufe wiederholbar sind. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

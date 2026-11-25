import { expect, test } from "@playwright/test";
import { board, gameLog, hint, moveCount, newPlayer, playTurn, settled, showAll, step, tapAt, units, waitForTurn } from "./helpers";

test("Solo-Partie gegen den Computer bis zum Ende (kurze Testaufstellung)", async ({ browser }) => {
  const { page, errors } = await newPlayer(browser);
  await page.goto("/?quick=1&seed=4");
  await page.getByRole("button", { name: "Allein gegen den Computer spielen" }).click();
  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Schwer" }).click();
  await expect(page.locator(".player .name").nth(1)).toContainText("Computer (Schwer)");

  let turns = 0;
  for (; turns < 30; turns++) {
    if (!(await waitForTurn(page, 30_000))) break;
    await playTurn(page, { walk: 120, wait: false });
  }
  expect(turns).toBeLessThan(30);
  await expect(page.locator(".badge", { hasText: "Gewonnen" })).toHaveCount(1);
  await expect(gameLog(page).last()).toContainText("gewinnt");
  await expect(gameLog(page).filter({ hasText: "Liegestuhl" }).first()).toBeVisible();
  // Abschluss über dem Garten: Blütenregen und "Gewonnen!" für den Sieger, ein ruhiger Hinweis nach einer Niederlage
  const humanWon = (await page.locator(".player").first().locator(".badge").innerText()) === "Gewonnen";
  await expect(page.locator(".celebration")).toHaveAttribute("data-result", humanWon ? "won" : "lost");
  await expect(page.locator(".celebration-banner strong")).toHaveText(humanWon ? "Gewonnen!" : "Verloren");
  await expect(page.locator(".celebration .confetti i")).toHaveCount(humanWon ? 70 : 0);

  // Neue Partie beginnt wieder bei null, man selbst ist dran
  await page.getByRole("button", { name: "Neue Partie" }).click();
  await expect.poll(() => moveCount(page)).toBe(0);
  await expect(hint(page)).toHaveText(/^Du bist dran/);
  await expect(page.locator(".celebration")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Am Smartphone: Zwerg wählen, laufen, zielen, spritzen; Computer antwortet; danach zu zweit", async ({ browser }) => {
  const { page, errors } = await newPlayer(browser, { phone: true });
  await page.goto("/?seed=11");
  await page.getByRole("button", { name: "Allein gegen den Computer spielen" }).click();
  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Leicht" }).click();
  await waitForTurn(page);
  await showAll(page);

  // Ein ungültiges Laufziel (außerhalb des Gartens) wird abgelehnt
  const drawn = await page.getByTestId("drawn").getAttribute("data-type");
  const mine = (await units(page)).filter((u) => u.seat === 0 && u.type === drawn);
  if ((await step(page)) === "select") await tapAt(page, mine[0]!, true);
  if (drawn !== "scarecrow") {
    await expect.poll(() => step(page)).toBe("move");
    await tapAt(page, { x: 3, y: 3 }, true);
    await expect(page.locator(".board-warning")).toBeVisible();
    await expect.poll(() => step(page)).toBe("move");
    await page.getByRole("button", { name: "Hier stehen bleiben" }).tap();
    await expect.poll(() => step(page)).toBe("aim");
    await page.getByRole("button", { name: "Schritt zurück" }).tap();
    await expect.poll(() => step(page)).toBe("move");
  }

  // Jetzt ein richtiger Zug mit Laufen
  const before = (await units(page)).find((u) => u.id === mine[0]!.id)!;
  await playTurn(page, { touch: true, walk: drawn === "scarecrow" ? 0 : 60, wait: false });
  await settled(page, 0);
  if (drawn !== "scarecrow") {
    const after = (await units(page)).find((u) => u.id === before.id)!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(40);
  }

  // Der Computer zeigt erst, was er vorhat, dann zieht er
  await expect(board(page)).not.toHaveAttribute("data-remote", "", { timeout: 10_000 });
  await expect.poll(() => moveCount(page), { timeout: 15_000 }).toBe(2);
  await expect(gameLog(page).filter({ hasText: /^Computer \(Leicht\): / })).toHaveCount(1);
  await expect(hint(page)).toHaveText(/^Du bist dran/);

  await page.getByRole("group", { name: "Gegner wählen" }).getByRole("button", { name: "Zu zweit" }).click();
  await expect(page.locator(".player .name").nth(1)).toContainText("Spieler 2");
  await playTurn(page, { touch: true });
  await playTurn(page, { touch: true });
  expect(await moveCount(page)).toBe(2);
  expect(errors).toEqual([]);
});

test("Eingebettete Partie gegen den Computer (Matchdesk) mit Tastatur", async ({ browser }) => {
  const { page, errors } = await newPlayer(browser);
  await page.goto("/?embed=1&solo=easy&name=Anna&seed=7");
  await expect(page.locator(".app.embed")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator(".player .name").nth(0)).toContainText("Anna");
  await expect(page.locator(".player .name").nth(1)).toContainText("Computer (Leicht)");

  // Nur Tastatur: Zwerg per Tab, Laufziel mit Pfeilen, Enter, Ziel mit Pfeilen, Leertaste
  await board(page).focus();
  if ((await step(page)) === "select") await page.keyboard.press("Tab");
  if ((await step(page)) === "move") {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
  }
  await expect.poll(() => step(page)).toBe("aim");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect.poll(() => moveCount(page), { timeout: 15_000 }).toBe(2);
  await waitForTurn(page);

  await page.getByRole("button", { name: "Neue Partie" }).click();
  await expect.poll(() => moveCount(page)).toBe(0);
  expect(errors).toEqual([]);
});

import { expect, test } from "@playwright/test";
import { board, enterLobby, gameLog, hint, moveCount, newPlayer, playTurn, settled, unitSummary, waitForTurn } from "./helpers";

// Der Testserver läuft mit QUICK_GAMES=1: zwei Zwerge je Seite mit 1 Lebenspunkt.

test("Online-Partie zwischen Desktop und Smartphone: Einladung, Vorschau, Züge, Uhr, Chat, Aufgabe", async ({ browser }) => {
  const rene = await newPlayer(browser);
  const mia = await newPlayer(browser, { phone: true });

  await enterLobby(rene.page, "René");
  await rene.page.getByRole("button", { name: "Privat mit Einladungslink" }).click();
  const link = await rene.page.locator("#invite-link").inputValue();
  expect(link).toMatch(/\/\?t=[A-Z2-9]{5}$/);

  // Mia kommt über den Einladungslink direkt an den Tisch
  await enterLobby(mia.page, "Mia", new URL(link).pathname + new URL(link).search);
  await expect(rene.page.locator(".player .name").nth(1)).toContainText("Mia");
  await expect(hint(mia.page)).toHaveText("René ist am Zug.");
  expect(await unitSummary(mia.page)).toBe(await unitSummary(rene.page));
  await expect(rene.page.getByTestId("timer")).toHaveText(/^(30|29|28) s$/);
  // Wer nicht dran ist, bekommt keine Bedienelemente
  await expect(mia.page.locator("button.fire")).toHaveCount(0);
  expect(await board(mia.page).getAttribute("data-step")).toBe("wait");

  // René zieht und zielt absichtlich daneben; Mia sieht vorher seine Vorschau
  await waitForTurn(rene.page);
  await playTurn(rene.page, { walk: 50, aim: { x: 800, y: 60 }, wait: false });
  await settled(mia.page, 0);
  await settled(rene.page, 0);
  expect(await unitSummary(mia.page)).toBe(await unitSummary(rene.page));

  // Mia ist dran und zieht per Touch, ebenfalls daneben
  await waitForTurn(mia.page);
  await playTurn(mia.page, { touch: true, aim: { x: 800, y: 950 }, wait: false });
  await settled(rene.page, 1);
  await settled(mia.page, 1);
  expect(await unitSummary(mia.page)).toBe(await unitSummary(rene.page));
  expect(await gameLog(mia.page).allInnerTexts()).toEqual(await gameLog(rene.page).allInnerTexts());
  await expect(gameLog(rene.page).filter({ hasText: /^Mia: .*daneben/ })).toHaveCount(1);

  // Vorschau: René legt sein Ziel fest, Mia sieht es, bevor er abfeuert
  await waitForTurn(rene.page);
  await expect(board(mia.page)).toHaveAttribute("data-remote", "");
  await playTurn(rene.page, { fire: false });
  await expect(board(mia.page)).toHaveAttribute("data-remote", /^r\d$/);

  // Chat am Tisch
  await mia.page.getByPlaceholder(/Nachricht/).last().fill("Gut gezielt!");
  await mia.page.getByPlaceholder(/Nachricht/).last().press("Enter");
  await expect(rene.page.getByText("Gut gezielt!")).toBeVisible();

  // Mia gibt auf: sie landet in der Lobby, René bleibt am Tisch und sieht den Grund
  await mia.page.getByRole("button", { name: "Aufgeben und Tisch verlassen" }).click();
  await expect(mia.page.getByRole("button", { name: "Privat mit Einladungslink" })).toBeVisible();
  await expect(rene.page.getByText("Mia hat den Tisch verlassen.")).toBeVisible();

  expect(rene.errors).toEqual([]);
  expect(mia.errors).toEqual([]);
});

test("Online-Partie bis zum Ende und Revanche", async ({ browser }) => {
  const a = await newPlayer(browser);
  const b = await newPlayer(browser);
  await enterLobby(a.page, "Anna");
  await a.page.getByLabel("Tischname").fill("Finale");
  await a.page.getByRole("button", { name: "Tisch eröffnen" }).click();

  // Ben findet den Tisch in der Lobby-Liste
  await enterLobby(b.page, "Ben");
  await b.page.getByRole("listitem").filter({ hasText: "Finale" }).getByRole("button", { name: "Beitreten" }).click();
  await expect(a.page.locator(".player .name").nth(1)).toContainText("Ben");

  let moves = 0;
  for (; moves < 30; moves++) {
    const turn = await Promise.race([waitForTurn(a.page).then((on) => ({ page: a.page, on })), waitForTurn(b.page).then((on) => ({ page: b.page, on }))]);
    if (!turn.on) break;
    await playTurn(turn.page, { walk: 120 });
  }
  expect(moves).toBeLessThan(30);

  // Beide sehen dasselbe Ergebnis
  await expect(a.page.locator(".badge", { hasText: /Gewonnen|Verloren/ })).toHaveCount(2);
  await expect(b.page.locator(".badge", { hasText: /Gewonnen|Verloren/ })).toHaveCount(2);
  await expect(a.page.locator(".score")).toContainText(/Partien (1 : 0|0 : 1)/);
  await expect.poll(() => unitSummary(b.page)).toBe(await unitSummary(a.page));
  expect(await gameLog(b.page).allInnerTexts()).toEqual(await gameLog(a.page).allInnerTexts());
  await expect(gameLog(a.page).last()).toContainText("gewinnt");

  // Der Sieger bekommt Blütenregen und "Gewonnen!", der Verlierer nur einen ruhigen Hinweis
  const annaWon = (await a.page.locator(".player").first().locator(".badge").innerText()) === "Gewonnen";
  const [winner, loser] = annaWon ? [a.page, b.page] : [b.page, a.page];
  await expect(winner.locator(".celebration")).toHaveAttribute("data-result", "won");
  await expect(winner.locator(".celebration-banner strong")).toHaveText("Gewonnen!");
  await expect(winner.locator(".celebration .confetti i")).toHaveCount(70);
  await expect(loser.locator(".celebration")).toHaveAttribute("data-result", "lost");
  await expect(loser.locator(".celebration-banner")).toContainText(`${annaWon ? "Anna" : "Ben"} gewinnt diese Partie.`);
  await expect(loser.locator(".celebration .confetti i")).toHaveCount(0);

  // Revanche: erst wenn beide wollen, beginnt die nächste Partie
  await a.page.getByRole("button", { name: "Revanche" }).click();
  await expect(b.page.getByRole("button", { name: "Revanche annehmen" })).toBeVisible();
  await b.page.getByRole("button", { name: "Revanche annehmen" }).click();
  await expect(a.page.locator(".badge", { hasText: /Gewonnen|Verloren/ })).toHaveCount(0);
  await expect(a.page.locator(".celebration")).toHaveCount(0);
  await expect(b.page.locator(".celebration")).toHaveCount(0);
  await expect.poll(() => moveCount(a.page)).toBe(0);
  await expect(a.page.getByTestId("gnomes-0")).toHaveText("2/2");
  await expect(b.page.getByTestId("gnomes-1")).toHaveText("2/2");

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

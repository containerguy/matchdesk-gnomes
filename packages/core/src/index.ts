/**
 * Spiel-Schnittstelle: trennt Lobby und Server vom konkreten Spiel.
 *
 * Lobby, Tische, Chat, Rangliste und Integrations-API kennen kein bestimmtes Spiel.
 * Jedes Spiel (hier Gartenfehde) liefert eine `GameDefinition`,
 * über die der Server Züge prüft und anwendet. Alles darin ist rein und deterministisch,
 * damit Server und Client dieselbe Logik nutzen können.
 */

/** Sitzplatz am Tisch: 0 oder 1 (alle Spiele sind vorerst für zwei Spieler). */
export type Seat = 0 | 1;

export type GameResult =
  | { kind: "running" }
  | { kind: "won"; winner: Seat; reason: string };

export type MoveCheck = { ok: true } | { ok: false; reason: string };

export interface GameDefinition<State, Move, Event> {
  /** Stabile Kennung, z. B. `gnomes`. Taucht in Tischen, Rangliste und API auf. */
  readonly id: string;
  readonly name: string;
  readonly players: 2;
  /** `quick`: verkürzte Partie für Tests (Server mit `QUICK_GAMES=1`). */
  createInitialState(options: { seed: number; startingSeat: Seat; quick?: boolean }): State;
  /** Wer ist am Zug? */
  currentSeat(state: State): Seat;
  /** Liest einen Zug aus einer Netzwerknachricht; `null`, wenn die Form nicht stimmt. */
  parseMove(raw: unknown): Move | null;
  /** Prüft einen Zug, ohne den Zustand zu ändern. */
  checkMove(state: State, seat: Seat, move: Move): MoveCheck;
  /** Wendet einen geprüften Zug an und liefert den neuen Zustand und was passiert ist. */
  applyMove(state: State, seat: Seat, move: Move): { state: State; events: Event[] };
  result(state: State): GameResult;
  /** Was Clients vom Zustand sehen dürfen (z. B. ohne Zufallszustand). Ohne Angabe: der ganze Zustand. */
  publicView?(state: State): unknown;
  /** Bedenkzeit pro Zug in Online-Partien; danach setzt der Server `timeoutMove` ein. */
  turnTimeMs?: number;
  timeoutMove?(state: State): Move;
}

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

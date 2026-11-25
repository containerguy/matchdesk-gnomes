import { applyGnomesMove, checkGnomesMove, createState, publicState, type ActMove, type GnomesOptions, type GnomesState } from "@gartenfehde/gnomes";
import type { Seat } from "@gartenfehde/core";
import { TableController } from "./controller";

/** Seed und Testaufstellung aus der Adresse (`?seed=…&quick=1`), sonst zufällig. */
function localSetup(): { seed: number; options: Partial<GnomesOptions> } {
  const params = new URL(location.href).searchParams;
  const seed = Number(params.get("seed"));
  return {
    seed: Number.isInteger(seed) && seed > 0 ? seed : Date.now() % 2 ** 31,
    options: params.get("quick") === "1" ? { squad: "quick" } : {}
  };
}

/** Partie an einem Gerät: beide Seiten ziehen hier (Grundlage für die Partie gegen den Computer). */
export class HotseatGame extends TableController {
  protected full: GnomesState;

  constructor(names: [string, string] = ["Spieler 1", "Spieler 2"], startingSeat: Seat = 0) {
    const { seed, options } = localSetup();
    const state = createState(seed, startingSeat, options);
    super(publicState(state), names, [`${names[startingSeat]} beginnt.`]);
    this.full = state;
    this.adoptFull(state);
  }

  newGame() {
    const { seed, options } = localSetup();
    const state = createState(seed + this.full.moves + 1, 0, options);
    this.set({ log: [`Neue Partie. ${this.snapshot.names[0]} beginnt.`] });
    this.adoptFull(state);
  }

  protected adoptFull(state: GnomesState, extraLog: string[] = []) {
    this.full = state;
    this.adopt(publicState(state), extraLog);
  }

  protected mayAct(_state: unknown) {
    return true;
  }

  protected submit(move: ActMove) {
    const before = this.full;
    const check = checkGnomesMove(before, before.turn, move);
    if (!check.ok) {
      this.adoptFull(before);
      this.set({ warning: check.reason });
      return;
    }
    const { state, events } = applyGnomesMove(before, before.turn, move);
    this.full = state;
    this.play(publicState(before), before.turn, events, publicState(state), () => this.afterMove(state));
  }

  /** Nach dem Abspielen eines Zuges (für den Computergegner). */
  protected afterMove(_state: GnomesState) {}
}

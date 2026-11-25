import type { ActMove, GnomesEvent, PublicGnomesState } from "@gartenfehde/gnomes";
import type { TableView } from "@gartenfehde/protocol";
import { TableController } from "./controller";
import type { NetClient } from "./net";

/** So oft geht die Vorschau des eigenen Zugs höchstens an den Gegner. */
const PREVIEW_EVERY_MS = 120;

/** Online-Partie: Züge gehen an den Server, die Züge beider Spieler werden hier abgespielt. */
export class OnlineTable extends TableController {
  private view: TableView;
  private pendingView: TableView | null = null;
  private lastPreview = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private net: NetClient, view: TableView) {
    super(view.state as PublicGnomesState, namesOf(view), []);
    this.view = view;
    this.adopt(view.state as PublicGnomesState);
    this.setDeadline(view);
    net.onGame((msg) => {
      if (msg.t === "preview") {
        if (msg.seat !== this.view.mySeat) this.showRemote(msg.move as ActMove | null);
        return;
      }
      this.play(msg.before as PublicGnomesState, msg.seat, msg.events as GnomesEvent[], msg.after as PublicGnomesState, () => {
        if (this.pendingView) {
          const next = this.pendingView;
          this.pendingView = null;
          this.update(next);
        }
      });
    });
  }

  /** Nach einer Ablehnung durch den Server wieder den Stand des Servers zeigen. */
  resync() {
    if (!this.isAnimating() && this.view.state) this.adopt(this.view.state as PublicGnomesState);
  }

  dispose() {
    this.net.onGame(null);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    super.dispose();
  }

  private setDeadline(view: TableView) {
    this.set({ deadline: view.turnMsLeft === null ? null : performance.now() + view.turnMsLeft });
  }

  /** Neue Tischansicht vom Server. */
  update(view: TableView) {
    if (this.isAnimating()) {
      this.pendingView = view;
      return;
    }
    const prev = this.view;
    this.view = view;
    this.set({ names: namesOf(view) });
    this.setDeadline(view);
    const state = view.state as PublicGnomesState | null;
    if (!state) return;
    const prevState = prev.state as PublicGnomesState | null;
    const changed = !prevState || prevState.moves !== state.moves || prev.status !== view.status || prevState.turn !== state.turn;
    if (changed) this.adopt(state);
    else this.set({ canAct: this.mayAct(state) && this.snapshot.phase === "choosing" });
  }

  protected mayAct(state: PublicGnomesState) {
    return this.view.status === "playing" && this.view.mySeat !== null && state.turn === this.view.mySeat && state.winner === null;
  }

  protected submit(move: ActMove) {
    this.net.send({ t: "move", move });
  }

  protected onPlan(move: ActMove | null) {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    const wait = Math.max(0, this.lastPreview + PREVIEW_EVERY_MS - Date.now());
    this.previewTimer = setTimeout(() => {
      this.lastPreview = Date.now();
      this.net.send({ t: "preview", move });
    }, wait);
  }
}

function namesOf(view: TableView): [string, string] {
  return [view.seats[0]?.name ?? "frei", view.seats[1]?.name ?? "frei"];
}

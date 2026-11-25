# matchdesk-gnomes

**Gartenfehde** ist ein rundenbasiertes Taktikspiel für zwei Spieler im Browser: Zwei Trupps Gartenzwerge machen sich im Schrebergarten mit Wasser nass. Lobby, Tische mit Einladungslink, Chat, Partie gegen den Computer in drei Stufen. Gespielt wird online zwischen zwei Geräten, auch am Smartphone. Eingebunden wird es über das Modul „arena“ in [Matchdesk](https://github.com/containerguy/Matchdesk).

Dieses Repository enthält nur Gartenfehde. Jedes Spiel hat ein eigenes Repository (Billard: [matchdesk-billiard](https://github.com/containerguy/matchdesk-billiard), Dreierschub: [matchdesk-shift](https://github.com/containerguy/matchdesk-shift)); Server, Lobby und Einbindung folgen demselben Aufbau.

## Regeln

Jeder Trupp hat neun Zwerge:

| Zwerg (Anzahl) | Leben | Laufweite | Waffe |
| --- | --- | --- | --- |
| Rasenmäher-Zwerg (3) | 60 | 260 | Spritzkegel: fächert vor ihm auf (260 weit), trifft alles im Kegel, nah mehr als fern, nicht durch Hecken, Felsen, Gartenhaus |
| Schleuder-Zwerg (3) | 50 | 180 | Wasserbombe: fliegt im Bogen bis 520 weit über alles hinweg, Platschkreis 60 |
| Schubkarren-Zwerg (2) | 120 | 110 | Gießkannen-Kanone: gerade bis 700 weit, stoppt am ersten Zwerg oder Hindernis, Platschkreis 45 |
| Vogelscheuche (1) | 40 | steht | Krähenschwarm: beliebiger Punkt im Garten, Platschkreis 90; danach zwei eigene Züge Pause |

- Pro Zug lost der Server einen Typ aus (nur Typen, von denen noch einer trocken ist). Der Spieler wählt einen seiner Zwerge dieses Typs, lässt ihn laufen oder stehen und gibt genau einen Schuss ab.
- Hecken, Felsen, Gartenhaus und Teich blockieren das Laufen. Kieswege kosten nur 0,6 der Laufweite, Beete das 1,5-Fache.
- Treffer kosten Leben; eigene Zwerge können mitgetroffen werden. Wer kein Leben mehr hat, sitzt im Liegestuhl.
- Gewonnen hat, wer alle Zwerge des Gegners nass gemacht hat. Nach 80 Zügen gewinnt, wer mehr Leben übrig hat (dann mehr Zwerge, sonst der Nachziehende).
- Online hat jeder Zug 30 Sekunden. Läuft die Zeit ab, verfällt der Zug; nach drei verpassten Zügen in Folge ist die Partie verloren.
- Drei Gärten (Schrebergarten, Gemüsegarten, Rosengarten), jeweils punktsymmetrisch, damit keine Seite im Vorteil ist.

Der Zufall steckt im Spielzustand auf dem Server; Clients bekommen den Zustand ohne ihn und können die nächste Auslosung nicht vorhersehen.

## Aufbau

```text
packages/core      Spiel-Schnittstelle (GameDefinition)
packages/protocol  Nachrichten zwischen Client und Server (zod-geprüft)
games/gnomes       Karten, Regeln und Computergegner (rein, deterministisch, getestet)
apps/server        Express + WebSocket: Lobby, Tische, Schiedsrichter, Integrations-API
apps/client        Vite + React + Canvas: Lobby, Garten, Steuerung
e2e                End-to-End-Tests (Playwright)
```

## Entwickeln

```bash
npm install
npm run dev        # Server auf :3000, Client auf http://localhost:5173
npm test           # Unit-Tests (Vitest)
npm run typecheck
npm run test:e2e   # End-to-End-Tests im Browser (Playwright)
```

## End-to-End-Tests

Die Tests unter `e2e/` bauen den Client, starten den echten Spielserver und spielen im Browser: eine Online-Partie zwischen Desktop und Smartphone (Einladungslink, Uhr, Züge per Maus und Touch, Vorschau beim Gegner, Chat, Aufgabe), eine Online-Partie bis zum Ende mit Revanche, eine Partie gegen den Computer bis zum Ende, eine am Smartphone (ungültiges Laufziel, Schritt zurück, Laufen, Computerzug, Wechsel zu zweit) und die eingebettete Partie gegen den Computer nur mit der Tastatur. Sie laufen in der CI als eigener Check `e2e` und sind Pflicht: ohne grüne E2E-Tests wird nicht gemergt.

Der Testserver läuft mit `QUICK_GAMES=1` (zwei Zwerge je Seite mit 1 Lebenspunkt), damit Partien schnell enden. Lokal gibt es dasselbe mit `?quick=1`, einen festen Garten mit `?seed=<zahl>`.

Einmalig vor dem ersten lokalen Lauf: `npx playwright install chromium`.

## Bedienung

- Maus und Finger: leuchtenden Zwerg antippen (bei nur einem passenden ist er schon gewählt), auf den Rasen tippen zum Laufen oder auf den Zwerg selbst zum Stehenbleiben, dann Ziel antippen oder ziehen, „Spritzen!“.
- Karte: Mausrad oder zwei Finger zoomen, Ziehen verschiebt, Knöpfe +, − und „Ganzer Garten“.
- Tastatur (Garten im Fokus): Tab wechselt den Zwerg, Pfeile oder WASD verschieben Laufziel bzw. Ziel, Enter bestätigt das Laufziel, Leertaste schießt, Escape geht einen Schritt zurück.

## Betreiben

Ein Prozess liefert Client und WebSocket (`/ws`) auf einem Port aus.

```bash
npm ci
npm run build
npm start          # Port 3000 (PORT=... zum Ändern)
```

Oder mit Docker: `docker compose up -d --build`. Fertige Images baut der Workflow „Image“ bei jedem Push auf `main`: `ghcr.io/containerguy/matchdesk-gnomes:latest` und `:sha-<commit>`. In PRs wird das Image nur gebaut und unter `/game-servers/gnomes` kurz gestartet.

Der Spielstand liegt im Arbeitsspeicher, ein Neustart beendet laufende Partien. `GET /health` meldet den Zustand.

## Einbindung in Matchdesk

Gleiche Schnittstelle wie beim Billard, damit das Modul „arena“ alle Spiele gleich behandelt:

- Eingebettet mit `?embed=1`, Platz-Link `?seat=<token>`; gegen den Computer `?embed=1&solo=easy|medium|hard&name=<Anzeigename>` (läuft ganz im Browser).
- `<BASE_PATH>/api/integrations/v1`: `POST /tables` (reservierter Tisch, `game` ist `gnomes`), `GET /tables/:id`, `DELETE /tables/:id`.
- Ereignisse `game.finished`, `table.expired`, `table.closed` per `POST` an die `callbackUrl`, signiert mit `X-Bandenduell-Timestamp` und `X-Bandenduell-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`. Die Header-Namen sind die gemeinsame Kennung aller Spielserver.
- `postMessage` an das umgebende Fenster: `{ source: "bandenduell", type: "ready" | "status" | "matchEnded" | "closed", … }`.

| Umgebungsvariable | Bedeutung |
| --- | --- |
| `BASE_PATH` | Unterpfad hinter dem Reverse Proxy, z. B. `/game-servers/gnomes` |
| `INTEGRATION_API_KEY` | Schlüssel für `Authorization: Bearer …`; ohne ihn ist die Schnittstelle aus |
| `INTEGRATION_WEBHOOK_SECRET` | Geheimnis für die Signatur der Ereignisse |
| `FRAME_ANCESTORS` | wer das Spiel einbetten darf (CSP `frame-ancestors`), Standard `'self'` |
| `QUICK_GAMES` | `1`: verkürzte Partien (nur für Tests) |

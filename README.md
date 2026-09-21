# umlLight

Eine kleine **PWA zum Spezifizieren von Anwendungen** — ohne Build-Schritt, ohne Backend, ohne Framework.
Nur HTML, CSS und ES-Module, damit sie direkt über GitHub Pages ausgeliefert werden kann.
Diagramme entstehen als **PlantUML**-Quelltext und werden von einem PlantUML-Server gerendert.

## Funktionsumfang

| Bereich | Inhalt |
| --- | --- |
| **Projekte** | Anlegen, duplizieren, löschen, als JSON exportieren/importieren, Gesamt-Backup |
| **Produktvision** | Elevator-Pitch-Vorlage mit Satzgenerator, Ziele, Nicht-Ziele, Rahmenbedingungen |
| **Use-Case-Modell** | Akteure, Use Cases mit Priorität/Vorbedingung/Ergebnis, `include`/`extend`, Ablaufschritte inkl. Entscheidungen → Use-Case-Diagramm + Aktivitätsdiagramm je Use Case |
| **Deployment** | Wahlweise Knotenmodell (verschachtelbar, Artefakte, Verbindungen) **oder** reine Textbeschreibung → Deployment-Diagramm |
| **Datenmodell** | Entitäten mit Attributen (Typ, PK/FK, Pflicht) und typisierten Beziehungen (1:n, n:m, Vererbung, Komposition …) → ER-Diagramm |
| **View-Modell** | Views mit Elementen, Navigationsübergänge → Zustands-/Navigationsdiagramm, plus beliebig viele Aktivitätsdiagramme |
| **Übersicht** | Stand der Spezifikation, alle Diagramme auf einer Seite, Markdown-Export |
| **KI-Assistent** | Diagramme per Anweisung erzeugen oder ändern — über die Hugging-Face-Inference-API, Modell/Token/System-Prompt frei konfigurierbar |
| **Markdown-Export** | Spezifikation als Markdown, wahlweise mit Inhaltsverzeichnis, PlantUML-Quelltext und/oder Diagramm-Bildlinks; einzeln oder alle Projekte in einem Dokument |
| **GitHub-Sync** | Projekte als JSON im Repository versionieren: Push, Pull, Konflikterkennung, Pull Requests, Commit-Verlauf mit Wiederherstellen, Import aus dem Repository |

Jedes generierte Diagramm kann per **„Quelle → Überschreiben"** durch handgeschriebenes PlantUML ersetzt
und jederzeit wieder auf die generierte Fassung zurückgesetzt werden.

## KI-Assistent

Jedes Diagramm hat eine **✨ KI**-Schaltfläche. Dort eine Anweisung eingeben
(oder einen der vorgeschlagenen Prompts antippen) — der Vorschlag wird
live gestreamt, der PlantUML-Block daraus extrahiert und auf Wunsch als Quelle
des Diagramms übernommen. Mitgesendet werden die Anweisung sowie optional die
aktuelle Diagrammquelle und ein kompakter Projektkontext (Vision, Akteure,
Entitäten, Views) — beides pro Anfrage abwählbar.

Einrichtung unter **Einstellungen → KI-Assistent**:

| Einstellung | Bedeutung |
| --- | --- |
| **Zugriffstoken** | Hugging-Face-Token (huggingface.co → Settings → Access Tokens, Rolle „read") |
| **Modell** | z. B. `Qwen/Qwen2.5-Coder-32B-Instruct`, optional mit Provider-Suffix (`…:together`) |
| **Endpunkt** | OpenAI-kompatibler Chat-Completions-Endpunkt, Standard `https://router.huggingface.co/v1/chat/completions`; funktioniert auch mit eigenen Inference-Endpoints oder lokalen Servern |
| **System-Prompt** | erzwingt reine PlantUML-Ausgabe; frei editierbar und auf den Standard zurücksetzbar |
| **Temperatur / Max. Tokens** | Steuerung von Kreativität und Antwortlänge |

„Verbindung testen" schickt eine Minimalanfrage und meldet, ob Token, Modell und
Prompt zusammenpassen. Der Token wird **unverschlüsselt im localStorage**
gespeichert und ausschließlich als `Authorization`-Header an den konfigurierten
Endpunkt geschickt — auf geteilten Geräten besser leer lassen.

## GitHub-Synchronisation

Jedes Projekt kann als JSON-Datei in einem Repository liegen — versioniert,
reviewbar, zwischen Geräten teilbar. Die App spricht die GitHub-REST-API direkt
aus dem Browser an: kein Server, kein Proxy.

**Einrichten** unter *Einstellungen → GitHub-Synchronisation*:

1. Feingranularen Token auf github.com unter *Settings → Developer settings →
   Personal access tokens → Fine-grained tokens* anlegen, auf genau dieses
   Repository beschränken, Berechtigung **Contents: read and write**
   (für Pull Requests zusätzlich **Pull requests: write**).
2. Owner und Repository eintragen — auf einer `*.github.io`-Adresse füllt
   „Aus Adresse übernehmen" beides vor.
3. Optional Branch und Verzeichnis (Standard: `umllight`), Commit-Autor,
   sowie für GitHub Enterprise eine eigene API-Basis.
4. „Repository prüfen" bestätigt Zugriff, Standard-Branch und Schreibrecht und
   füllt die Branch-Vorschläge.

**Ablauf.** In der Projektübersicht oder der Projektliste öffnet „Synchronisieren"
den Sync-Dialog. Der erste Push legt `umllight/<projekt>.json` an; danach zeigt
der Dialog den Zustand:

| Status | Bedeutung | Angebotene Aktionen |
| --- | --- | --- |
| nicht verknüpft | nur lokal vorhanden | Verknüpfen & pushen |
| synchron | identisch mit dem Branch | — |
| lokal geändert | seit dem letzten Sync bearbeitet | Commit & Push, Pull Request |
| entfernt geändert | jemand hat im Repository committet | Pull |
| divergiert | beides | Remote übernehmen, Force-Push, Pull Request |
| im Repository entfernt | Datei gelöscht oder verschoben | neu anlegen, Verknüpfung lösen |

Erkannt wird das über die Blob-`sha` des letzten Syncs plus einen lokalen
Inhalts-Hash — es wird nie stillschweigend gemergt, die Entscheidung liegt immer
beim Nutzer. Commits entstehen über die Git-Data-API (Blob → Tree → Commit →
Ref), also als **ein** Commit pro Push mit sauberer Historie.

Weiter im Dialog: **Verlauf** listet die Commits der Datei, jede Version lässt
sich auf GitHub öffnen oder lokal wiederherstellen (landet erst mit dem nächsten
Push im Repository). **Als Pull Request** committet auf einen frischen Branch
`umllight/<projekt>-<zeitstempel>` und öffnet den PR gegen den verfolgten Branch.
In der Projektliste holt **Aus Repository** Projekte, die dort liegen, aber
lokal fehlen.

Der Token wird nur als `Authorization`-Header an die konfigurierte API-Basis
geschickt und wahlweise dauerhaft oder nur für die aktuelle Sitzung gespeichert.

## Mobile Nutzung

Die Oberfläche ist für Telefone ausgelegt:

* feste **Bottom-Navigation** über die sechs Projektbereiche, Schubladen-Menü für den Projektwechsel
* Dialoge erscheinen als **Bottom-Sheets** mit klebender Aktionsleiste
* Tabellen (Attribute, Beziehungen, Verbindungen, Navigation) werden zu **gestapelten Karten** mit Feldbeschriftungen
* Sortieren per **↑/↓-Schaltflächen** statt Drag & Drop (auf dem Desktop zusätzlich ziehbar)
* Diagramme mit **Zoom-Schaltflächen und Vollbild** (dort Pinch-Zoom), sekundäre Aktionen im **⋯-Menü**
* Eingabefelder mit 16 px Schriftgröße (kein iOS-Zoom beim Fokus), Tap-Ziele ≥ 36 px, Beachtung der Safe-Area-Ränder

## Betrieb auf GitHub Pages

1. Repository auf GitHub pushen.
2. **Settings → Pages → Source: GitHub Actions** wählen. Der Workflow `.github/workflows/pages.yml`
   veröffentlicht den Repository-Inhalt bei jedem Push auf `main`.
   (Alternativ: *Deploy from a branch* — `.nojekyll` liegt bereits im Repository.)
3. Seite aufrufen und über das Browser-Menü „Installieren" / „Zum Startbildschirm hinzufügen"
   als App ablegen.

Lokal testen:

```bash
python3 -m http.server 8080
# http://localhost:8080
```

Ein Webserver ist nötig (ES-Module und Service Worker laufen nicht über `file://`).

## Daten & Datenschutz

* Alle Projekte liegen im `localStorage` des Browsers — es gibt keinen Server und keine Anmeldung.
* Der KI-Assistent sendet nur bei aktiver Nutzung Daten (Anweisung, Diagrammquelle, optionaler Projektkontext) an den eingestellten Endpunkt.
* Die GitHub-Synchronisation läuft ausschließlich manuell — es wird nichts im Hintergrund gepusht oder geholt.
* Beim Rendern wird **nur der PlantUML-Quelltext des jeweiligen Diagramms** (komprimiert und kodiert in der URL)
  an den eingestellten PlantUML-Server geschickt. Voreinstellung: `https://www.plantuml.com/plantuml`.
* Für vertrauliche Inhalte in den Einstellungen einen eigenen Server eintragen, z. B.:

  ```bash
  docker run -d -p 8080:8080 plantuml/plantuml-server:jetty
  # Einstellungen → PlantUML-Server: http://localhost:8080
  ```

* Gerenderte Diagramme werden vom Service Worker zwischengespeichert, sodass zuletzt
  betrachtete Diagramme auch offline sichtbar bleiben. Bearbeiten funktioniert vollständig offline.

## Technik

```
index.html            App-Shell
css/styles.css        Styling inkl. Dark/Light-Mode
js/app.js             Hash-Router, Sidebar, Einstellungen
js/store.js           localStorage-Persistenz, Import/Export
js/plantuml.js        PlantUML-Kodierung (deflate + Base64, Hex-Fallback)
js/diagram.js         Diagramm-Panel (rendern, zoomen, Quelle, Download, Überschreiben)
js/generators.js      Modell → PlantUML
js/export.js          Markdown-Export inkl. Optionsdialog
js/ai.js              Hugging-Face-Client (Streaming, PlantUML-Extraktion)
js/aipanel.js         KI-Dialog je Diagramm
js/github.js          GitHub-REST-Client (Git-Data-API, atomare Commits)
js/gitsync.js         Sync-Logik: Status, Push, Pull, PR, Verlauf, Import
js/gitpanel.js        Sync- und Import-Dialog
js/views/*.js         Die sechs Bereiche der Anwendung
sw.js                 Service Worker (App-Shell offline, Diagramm-Cache)
```

Kein Build, keine Abhängigkeiten. Änderungen an den Dateien wirken nach einem Reload
(der Service Worker aktualisiert sich selbst; bei Bedarf `VERSION` in `sw.js` erhöhen).

## Datenformat

Export einzelner Projekte: `{ "type": "umllight.project", "version": 1, "project": { … } }`
Gesamt-Backup: `{ "type": "umllight.backup", "version": 1, "projects": [ … ] }`
Beide Formate lassen sich über „Importieren" wieder einlesen.

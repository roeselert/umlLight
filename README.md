# umlLight

Eine kleine **PWA zum Spezifizieren von Anwendungen** — ohne Build-Schritt, ohne Backend, ohne Framework.
Nur HTML, CSS und ES-Module, damit sie direkt über GitHub Pages ausgeliefert werden kann.
Diagramme entstehen als **PlantUML**-Quelltext und werden von einem PlantUML-Server gerendert.

## Funktionsumfang

| Bereich | Inhalt |
| --- | --- |
| **Projekte** | Anlegen, duplizieren, löschen, als JSON exportieren/importieren, Gesamt-Backup |
| **Produktvision** | Kurzbeschreibung, Ziele, Nicht-Ziele, Rahmenbedingungen |
| **Use-Case-Modell** | Akteure, Use Cases mit Priorität/Vorbedingung/Ergebnis, `include`/`extend`, Ablaufschritte inkl. Entscheidungen → Use-Case-Diagramm + Aktivitätsdiagramm je Use Case; dazu frei gestaltbare Abläufe (Aktivitätsdiagramme), mit denen Use Cases verknüpft werden |
| **Deployment** | Wahlweise Knotenmodell (verschachtelbar, Artefakte, Verbindungen) **oder** reine Textbeschreibung → Deployment-Diagramm |
| **Robustheitsmodell** | Boundary–Control–Entity nach ICONIX, gruppiert in Business-Komponenten: Boundaries (Masken, APIs mit verknüpften Endpunkten, Fremdsysteme), Controls als Freitext-Spezifikation, Entitäten mit Attributen und typisierten Beziehungen, Interaktionen mit Regelprüfung → Robustheitsdiagramm (gesamt oder je Komponente), ER-Diagramm |
| **Übersicht** | Stand der Spezifikation, alle Diagramme auf einer Seite, Markdown-Export |
| **KI-Assistent** | Diagramme per Anweisung erzeugen oder ändern — über die Hugging-Face-Inference-API, Modell/Token/System-Prompt frei konfigurierbar |
| **Markdown-Export** | Spezifikation als Markdown, wahlweise mit Inhaltsverzeichnis, PlantUML-Quelltext und/oder Diagramm-Bildlinks; einzeln oder alle Projekte in einem Dokument |
| **API & Schemas** | OpenAPI-3.1-Spezifikation und Avro-Records aus Entitäten und API-Boundaries, mit Optionen, eigener Fassung und Export |
| **GitHub-Sync** | Projekte als JSON in einem frei wählbaren Repository versionieren: Push, Pull, Konflikterkennung, Pull Requests, Commit-Verlauf mit Wiederherstellen, Import |

Jedes generierte Diagramm kann per **„Quelle → Überschreiben"** durch handgeschriebenes PlantUML ersetzt
und jederzeit wieder auf die generierte Fassung zurückgesetzt werden.

## Robustheitsmodell

Statt Datenmodell und Views getrennt zu pflegen, beschreibt ein Robustheitsmodell
(Boundary–Control–Entity) die Anwendung als Ganzes:

| Element | Inhalt |
| --- | --- |
| **Business-Komponente** | Fachlicher Baustein mit Verantwortung; bündelt Boundaries, Controls und Entitäten (direkt in der Komponente zuordenbar) und wird im Robustheits- und im ER-Diagramm als Paket gezeichnet |
| **Boundary** | Schnittstelle nach außen — *Oberfläche/Maske* (mit Elementen), *API* (mit Operationen) oder *Fremdsystem* |
| **Control** | Fachlogik, frei als Text spezifiziert (Regeln, Abläufe, Fehlerfälle) |
| **Entität** | Wie bisher: Attribute mit Typ, PK/FK, Pflicht sowie typisierte Beziehungen |
| **Interaktion** | Verbindung zwischen Akteur (aus dem Use-Case-Modell), Boundary, Control und Entität |

**API-Boundaries** werden mit Operationen (`GET /auftraege/{id}` …) verknüpft. Die
aus den Entitäten generierten CRUD-Endpunkte lassen sich direkt übernehmen und sind
als „generiert" markiert; eigene Endpunkte werden als Stubs in die
OpenAPI-Spezifikation aufgenommen und mit der Business-Komponente getaggt.

**Regeln.** Akteur ↔ Boundary, Boundary ↔ Control, Control ↔ Control/Entität.
Verstöße (etwa Boundary → Boundary oder Boundary → Entität) werden markiert, aber
nicht verhindert.

Das Robustheitsdiagramm lässt sich auf eine Komponente eingrenzen; gezeigt werden
dann ihre Elemente und alles, womit sie interagieren.

**Migration.** Projekte im alten Format werden beim Laden übernommen: Views werden
zu Boundaries vom Typ „Oberfläche", Navigationsübergänge zu Interaktionen,
Aktivitätsdiagramme werden zu Abläufen im Use-Case-Modell, ein überschriebenes
Navigationsdiagramm wird ebenfalls als Ablauf abgelegt. Alte Links auf `#/…/datamodel` und `#/…/viewmodel` führen
zum Robustheitsmodell.

## API & Schemas

Aus den Entitäten (und den API-Boundaries) des Robustheitsmodells entstehen zwei Artefakte, die sich unabhängig voneinander
konfigurieren, überschreiben und exportieren lassen:

**OpenAPI 3.1** — `components.schemas` je Entität plus, auf Wunsch, vollständige
CRUD-Endpunkte (`GET`/`POST` auf der Sammlung, `GET`/`PATCH`/`DELETE` auf dem
Element) mit Paginierungsparametern und Fehlerantworten. Einstellbar sind Titel,
Version, Server-URL, Authentifizierung (keine, Bearer/JWT, API-Key, OAuth2),
Ausgabeformat (YAML oder JSON) und die Pfadform — englischer Plural (`/orders`)
oder die Entität unverändert (`/auftrag`), was bei deutschen Namen meist besser
passt. Vererbung wird zu `allOf`, Beziehungen werden zu Fremdschlüsselfeldern.

**Avro** — ein Record je Entität mit Namespace, logischen Typen
(`uuid`, `date`, `timestamp-millis`), nullable Unions mit `default: null` für
optionale Felder und Referenzfeldern aus den Beziehungen. Download als eine
Datei mit allen Records oder je Record einzeln (`.avsc`), wie es Schema-
Registries erwarten.

Beide Fassungen lassen sich per „Überschreiben" von Hand weiterschreiben und
jederzeit auf die generierte Fassung zurücksetzen; der KI-Assistent arbeitet hier
mit einem eigenen System-Prompt, der reine Schema-Ausgaben erzwingt.

## KI-Assistent

Jedes Diagramm hat eine **✨ KI**-Schaltfläche. Dort eine Anweisung eingeben
(oder einen der vorgeschlagenen Prompts antippen) — der Vorschlag wird
live gestreamt, der PlantUML-Block daraus extrahiert und auf Wunsch als Quelle
des Diagramms übernommen. Mitgesendet werden die Anweisung sowie optional die
aktuelle Diagrammquelle und ein kompakter Projektkontext (Vision, Akteure,
Komponenten, Boundaries, Controls, Entitäten) — beides pro Anfrage abwählbar.

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

**Das Zielrepository ist frei wählbar und gehört nicht in das Repository der
App.** Die Einstellungen legen nur ein Standard-Repository fest; jedes Projekt
kann im Sync-Dialog auf ein anderes Repository, einen anderen Branch oder einen
anderen Pfad zeigen. Trägt man versehentlich das Repository ein, aus dem die App
ausgeliefert wird, weist die Oberfläche darauf hin.

**Einrichten** unter *Einstellungen → Daten-Repository (GitHub)*:

1. Feingranularen Token auf github.com unter *Settings → Developer settings →
   Personal access tokens → Fine-grained tokens* anlegen, auf das gewünschte
   Datenrepository beschränken, Berechtigung **Contents: read and write**
   (für Pull Requests zusätzlich **Pull requests: write**).
2. Standard-Repository als `owner/name` eintragen — „Meine laden" holt die
   Repositories mit Schreibzugriff als Vorschlagsliste.
3. Optional Branch und Verzeichnis (Standard: `umllight`), Commit-Autor,
   sowie für GitHub Enterprise eine eigene API-Basis.
4. „Repository prüfen" bestätigt Zugriff, Standard-Branch und Schreibrecht und
   füllt die Branch-Vorschläge.

**Ablauf.** In der Projektübersicht oder der Projektliste öffnet „Synchronisieren"
den Sync-Dialog. Der erste Push legt `umllight/<projekt>.json` an; danach zeigt
der Dialog den Zustand:

| Status | Bedeutung | Angebotene Aktionen |
| --- | --- | --- |
| nicht verknüpft | nur lokal vorhanden | Ziel wählen, verknüpfen & pushen |
| synchron | identisch mit dem Branch | — |
| lokal geändert | seit dem letzten Sync bearbeitet | Commit & Push, Pull Request |
| entfernt geändert | jemand hat im Repository committet | Pull |
| divergiert | beides | Remote übernehmen, Force-Push, Pull Request |
| im Repository entfernt | Datei gelöscht oder verschoben | neu anlegen, Verknüpfung lösen |

Erkannt wird das über die Blob-`sha` des letzten Syncs plus einen lokalen
Inhalts-Hash — es wird nie stillschweigend gemergt, die Entscheidung liegt immer
beim Nutzer. Commits entstehen über die Git-Data-API (Blob → Tree → Commit →
Ref), also als **ein** Commit pro Push mit sauberer Historie.

Über **Ziel ändern** lässt sich ein bereits verknüpftes Projekt jederzeit in ein
anderes Repository umziehen; der nächste Push legt die Datei dort an.

Weiter im Dialog: **Verlauf** listet die Commits der Datei, jede Version lässt
sich auf GitHub öffnen oder lokal wiederherstellen (landet erst mit dem nächsten
Push im Repository). **Als Pull Request** committet auf einen frischen Branch
`umllight/<projekt>-<zeitstempel>` und öffnet den PR gegen den verfolgten Branch.
In der Projektliste holt **Aus Repository** Projekte, die dort liegen, aber lokal
fehlen — auch dort sind Repository, Branch und Verzeichnis frei einstellbar.

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
js/schemas.js         Entitäten/API-Boundaries → OpenAPI 3.1 und Avro (inkl. YAML-Ausgabe)
js/robustness.js      BCE-Hilfen: Teilnehmer, Robustheitsregeln, API-Operationen
js/export.js          Markdown-Export inkl. Optionsdialog
js/ai.js              Hugging-Face-Client (Streaming, PlantUML-Extraktion)
js/aipanel.js         KI-Dialog je Diagramm
js/github.js          GitHub-REST-Client (Git-Data-API, atomare Commits)
js/gitsync.js         Sync-Logik: Status, Push, Pull, PR, Verlauf, Import
js/gitpanel.js        Sync- und Import-Dialog
js/views/*.js         Die Bereiche der Anwendung
sw.js                 Service Worker (App-Shell offline, Diagramm-Cache)
```

Kein Build, keine Abhängigkeiten. Änderungen an den Dateien wirken nach einem Reload
(der Service Worker aktualisiert sich selbst; bei Bedarf `VERSION` in `sw.js` erhöhen).

## Datenformat

Export einzelner Projekte: `{ "type": "umllight.project", "version": 3, "project": { … } }`
Gesamt-Backup: `{ "type": "umllight.backup", "version": 3, "projects": [ … ] }`
Beide Formate lassen sich über „Importieren" wieder einlesen; Dateien mit
ältere Versionen (getrenntes View-Modell, Abläufe im Robustheitsmodell) werden
dabei automatisch migriert.

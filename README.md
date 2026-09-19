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
| **Übersicht** | Stand der Spezifikation, alle Diagramme auf einer Seite, Export als Markdown-Spezifikation |

Jedes generierte Diagramm kann per **„Quelle → Überschreiben"** durch handgeschriebenes PlantUML ersetzt
und jederzeit wieder auf die generierte Fassung zurückgesetzt werden.

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
js/diagram.js         Diagramm-Panel (rendern, Quelle, Download, Überschreiben)
js/generators.js      Modell → PlantUML + Markdown-Spezifikation
js/views/*.js         Die sechs Bereiche der Anwendung
sw.js                 Service Worker (App-Shell offline, Diagramm-Cache)
```

Kein Build, keine Abhängigkeiten. Änderungen an den Dateien wirken nach einem Reload
(der Service Worker aktualisiert sich selbst; bei Bedarf `VERSION` in `sw.js` erhöhen).

## Datenformat

Export einzelner Projekte: `{ "type": "umllight.project", "version": 1, "project": { … } }`
Gesamt-Backup: `{ "type": "umllight.backup", "version": 1, "projects": [ … ] }`
Beide Formate lassen sich über „Importieren" wieder einlesen.

# FORTH TRACE · Motion Tracking & Dryfire Analysis

Architektur, Implementierungsstand und nächste Schritte der Erweiterung des
Dryfire Stage Studio zu einer kamerabasierten Trainings- und
Bewegungsanalyseplattform. Stand: Prototyp (Phase 1 + 2, Kernlogik von Phase 3).

> **Grundsatz:** Alle angezeigten Messwerte stammen aus dem echten Kamerabild.
> Es gibt keinen Demo-Modus mit simulierten Trackingdaten in der App.
> Synthetische Posen existieren nur in den Unit-Tests
> (`src/motion/testing/syntheticPose.ts`, als TEST ONLY gekennzeichnet).
> Alle Zeiten sind als **experimentell, nicht gegen eine Referenz validiert**
> gekennzeichnet. Es gibt **keine Treffererkennung**.

---

## 1. Bestandsanalyse

| Frage | Befund |
|---|---|
| Technologien | React 19, TypeScript 7 (strict), Vite 8, Konva / react-konva. Rein statische Web-App, Hash-Routing, Deploy über GitHub Pages. Kein Backend, kein Testrunner (jetzt: Vitest). |
| Aufbau Stage Builder | `components/editor/*` (Editor), `components/stage/StageCanvas` (gemeinsamer Renderer für Editor und Player), `components/player/*` (Vollbild-Player mit HUD), `components/home`, `components/match`. |
| Targets & Speicherung | `types/stage.ts`: Stage = JSON, Objekte mit normierten Bodenpunkten `x`,`y` (0..1), Perspektive aus `environments.ts`. Speicherung über `StageRepository`-Interface (localStorage + eingebaute JSON-Dateien). |
| Darstellung & Animation | Konva-Layer; Bewegung (`utils/motion.ts`) als reine Funktion der Zeit seit dem Startsignal, imperativ pro Frame angewendet. |
| Timer, Par-Time, Wiederholungen | `utils/schedule.ts`: deterministischer Ablauf aus Stage + Seed (gleicher Seed ⇒ gleiche Standby-Verzögerungen). `utils/audioEngine.ts`: Signale sample-genau auf der Web-Audio-Uhr. `matchSchedule.ts` reiht Stages. |
| Wiederverwendbar | Stage-Modell, `buildSchedule`/`snapshotAt`, `motion.ts`, `StageCanvas`, `PlayerOverlay`, `AudioEngine`, `stageRepository`, Design-Tokens. |
| Mobile / PWA | Die App ist bereits ein reines Web-Frontend; die Erweiterung läuft im Smartphone-Browser. Für Kamera ist ein sicherer Kontext (HTTPS) Pflicht. |

Der bestehende Player ist bereits eine reine Funktion von *(Stage, Seed, Zeit)* —
das ist der Schlüssel der TV-Synchronisation: Telefon und TV berechnen aus
demselben Seed denselben Ablauf und müssen nur den Startzeitpunkt teilen.

## 2. Architektur

```
 Smartphone (Controller)                                   TV-Browser (Renderer)
 ┌───────────────────────────────────────────────┐        ┌──────────────────────────────┐
 │ Camera Capture  src/capture                   │        │ TV Renderer  src/trace/tv    │
 │  getUserMedia → <video> → requestVideoFrame-  │        │  StageCanvas + PlayerOverlay │
 │  Callback (captureTime-Zeitstempel)           │        │  buildSchedule(seed)         │
 │            │                                  │        │  Beeps (optional)            │
 │ AI Pose Tracking  src/pose                    │        └──────────────▲───────────────┘
 │  MediaPipe Pose Landmarker (WASM, lokal)      │                       │
 │  Qualitätsbewertung je Körperregion           │   run_start {stage, seed, startAt}
 │            │                                  │   rep_result {Zusammenfassung}
 │ Motion Analysis  src/motion                   │   ping/pong (Uhrabgleich)
 │  BodyFrame (Torso-Einheiten) → RepAnalyzer    │                       │
 │  READY→MOVEMENT→PRESENTATION→STABILIZATION→…  │◄──── WebSocket-Relay ─┘
 │            │                                  │      scripts/trace-relay.mjs
 │ Training / Stage Engine  src/trace, utils     │      (im Vite dev/preview-Server)
 │  TrainingRun: Ablauf, Signale, Analyse je Rep │
 │            │                                  │
 │ Performance Analytics  src/analytics          │
 │  TrainingLog (localStorage), Auswertung       │
 └───────────────────────────────────────────────┘
```

| Modul (Spezifikation) | Umsetzung |
|---|---|
| A. Stage Engine | Bestehend: `types/stage.ts`, `utils/schedule.ts`, `utils/matchSchedule.ts`, `utils/motion.ts`, `utils/audioEngine.ts`. Neu: `utils/stageMotion.ts` (aus dem Player extrahiert, von Player und TV genutzt). |
| B. TV Renderer | `src/trace/tv/TvReceiver.tsx`, Route `#/tv/<CODE>` |
| C. Camera Capture | `src/capture/camera.ts`, `frameLoop.ts`, `videoRecorder.ts` |
| D. AI Pose Tracking | `src/pose/poseTracker.ts`, `landmarks.ts`, `quality.ts`, `drawSkeleton.ts` |
| E. Motion Analysis | `src/motion/features.ts`, `analyzer.ts`, `calibration.ts` |
| F. Performance Analytics | `src/analytics/trainingLog.ts`, `src/trace/tabs/AnalysisTab.tsx` |
| Session / Sync | `src/session/protocol.ts`, `transport.ts`, `SessionClient.ts`, `clockSync.ts`, `audioClock.ts` |
| UI (Smartphone) | `src/trace/TraceApp.tsx` + `tabs/*`, Route `#/trace/<tab>` |

UI, Kamera, KI und Trainingslogik sind getrennt: `src/motion` und `src/session/clockSync`
kennen weder React noch den Browser und sind vollständig unit-getestet. `TraceController`
und `TrackingPipeline` sind React-frei; die Views abonnieren nur Zustandsänderungen.

### Uhren und Zeitstempel

* **Eine Zeitbasis pro Gerät:** `performance.now()` (ms, monoton).
* **Kameraframes:** `requestVideoFrameCallback` → `captureTime` (Sensorzeitpunkt) wenn verfügbar,
  sonst `presentationTime`, sonst Callback-Zeit. Die Quelle wird pro Frame und pro Session gespeichert.
* **Startsignal auf dem Telefon:** Web-Audio-Zeit ↔ Performance-Uhr über `getOutputTimestamp()`
  (`session/audioClock.ts`), inkl. der vom Browser gemeldeten Ausgabelatenz.
* **Telefon ↔ TV:** NTP-artiger Abgleich (`clockSync.ts`): Median der schnellsten Ping-Runden,
  Unsicherheit = halbe minimale Rundlaufzeit + Streuung. Im lokalen Test: ±0,4 ms.
* **Nicht messbar im Browser:** die Ton-/Bildverzögerung des Fernsehers selbst (HDMI, Soundprozessor,
  Bluetooth). Deshalb ist **„Signal auf dem Telefon“ der Standard** — dann kennt das messende Gerät
  den Signalzeitpunkt selbst. Bei „nur TV“ wird der Unterschied in der UI ausdrücklich genannt.

## 3. Web oder nativ?

| Funktion | Web (umgesetzt) | Wann nativ nötig |
|---|---|---|
| Kamera, Auflösungs-/FPS-Wunsch | ✔ `getUserMedia` (HTTPS) | Feste 120/240 fps, manuelle Belichtung/Shutter, Fokus-Lock: nur nativ (AVFoundation / Camera2) zuverlässig. |
| Frame-Zeitstempel | ✔ Chrome/Android: `captureTime`; Safari: Präsentationszeit | Sensor-Zeitstempel garantiert nur nativ. |
| Pose-Erkennung auf dem Gerät | ✔ MediaPipe WASM + WebGL, ~7 ms/Frame GPU (Desktop-Messung) | Bei schwachen Telefonen: nativer MediaPipe-/Core-ML-Pfad deutlich schneller. |
| Bildschirm wach halten | ✔ Wake Lock API (Chrome, Safari ≥ 16.4) | — |
| Hintergrundbetrieb | ✘ Browser pausiert Kamera bei gesperrtem Bildschirm | nativ |
| TV-Verbindung | ✔ WebSocket-Relay im LAN | Ohne Rechner im Netz: native App als Server, oder WebRTC (siehe Nächste Schritte). |
| Markertracking / Kalibrierung (Phase 5) | machbar mit OpenCV.js / js-aruco | Bei hohen Genauigkeitsanforderungen + IMU-Fusion: nativ. |

**Empfehlung:** Web/PWA bleibt für Phase 1–4 die richtige Wahl (eine TypeScript-Codebasis,
keine Store-Hürde). Eine Capacitor-Hülle (wie beim FORTH TRACE Timer) ist der natürliche Schritt,
wenn Hochfrequenz-Kamera oder IMU gebraucht werden — die Module unter `src/` bleiben dabei unverändert.

## 4. TV-Verbindung

* **Relay:** `scripts/trace-relay.mjs` hängt sich als Vite-Plugin an den dev/preview-Server
  (Pfad `/__trace`). Räume mit 4-stelligem Code, Weiterleitung von JSON an alle anderen Teilnehmer,
  Präsenzliste, Heartbeat, Größen-/Raumlimits. Es fließen **keine Bild- oder Posedaten**.
* **HTTPS im LAN:** `npm run dev:lan` startet mit selbstsigniertem Zertifikat (`@vitejs/plugin-basic-ssl`),
  weil Telefone die Kamera nur im sicheren Kontext freigeben. Das Zertifikat muss auf Telefon **und** TV
  einmal akzeptiert werden.
* **Fallback ohne Server:** `BroadcastChannel` — nur Tabs desselben Browsers (z. B. statischer
  GitHub-Pages-Build). Die UI weist darauf hin.
* **Synchronisation:** Telefon sendet `run_start {stage, seed, startAt}` 3 s vor dem Start (Countdown).
  Der TV rechnet `startAt` mit seinem Offset in die eigene Uhr um, friert ihn ein (Bild und Ton bleiben
  konsistent) und plant optional die Signale.

## 5. Bewegungsanalyse

### Merkmale (`features.ts`)
Alle Positionen relativ zur Schultermitte in **Torso-Einheiten** (Schulter- → Hüftmitte). Dadurch sind
Schwellen unabhängig von Körpergröße und Abstand (getestet: 0,55-fache Größe ⇒ gleiche Zeiten).
Armstreckung zur Kamera (= Richtung TV) wird **nur** aus MediaPipes Welt-Tiefe geschätzt.

### Zustände (`analyzer.ts`)

| Übergang | Kriterium (Standardwerte, per Einstellung skalierbar) |
|---|---|
| READY | ab STANDBY scharf; Hände sollen ruhen. Bewegung vor dem Signal ⇒ `early_movement`, Rep wird aus Statistiken ausgeschlossen. |
| → MOVEMENT | Hand ≥ 0,12 Torso vom Ruhepunkt **und** Geschwindigkeit ≥ 0,45 Torso/s (über 40 ms gemessen). Zeitpunkt = Rückverfolgung bis zum Überschreiten von 40 % der Schwelle. |
| → PRESENTATION | 2 Frames in Folge in der Präsentationszone: Hände 0,7 über bis 0,45 unter Schulterlinie, ≤ 0,6 seitlich, optional beide Hände zusammen, und — falls Tiefe vorhanden — Streckung ≥ 0,3 m. |
| → STABILIZATION | in der Zone und Geschwindigkeit < 0,35 Torso/s |
| → COMPLETE | 200 ms stabil ⇒ `stabilized` (Zeitpunkt = Beginn der Ruhephase) — oder Ende Par + 1 s ⇒ `timeout` |
| Positionswechsel | Hüftmitte ≥ 0,6 Torso verschoben bei ≥ 0,5 Torso/s ⇒ `position_change_start`; 300 ms Ruhe ⇒ `position_reached` |

* **Konfidenz:** Trackingqualität des Frames (schwächste benötigte Körperregion), halbiert nach
  Trackinglücke, × 0,7 wenn die Präsentationszone ohne Tiefe entschieden wurde.
* **Unsicherheit:** halber Frameabstand bzw. halbe Lücke; Metriken addieren die Unsicherheiten
  von Start- und Endereignis (konservativ).
* **Kalibrierung:** 6 s Weg zur Position, 3 s still stehen. Prüft Trackingquote (≥ 90 %), beide Hände,
  misst das Jitter (p95). Schwellen liegen danach nie unter 3 × Jitter.
* **Bekannte systematische Effekte (bis zur Validierung offen):** Schwellendetektion erkennt den Beginn
  einer weich einsetzenden Bewegung einige 10 ms zu spät (Test: ≤ 60 ms bei Smoothstep-Profil);
  die Präsentationszone ist eine Körperpositions-Heuristik, **keine Aussage über Zielausrichtung**.
* **Nicht implementiert:** „Trainingsgerät wird sichtbar“. Erfordert einen eigenen Objektdetektor
  (kein COCO-Standardmodell erkennt Trainingsgeräte zuverlässig) — siehe Phase 5.

### Kennzahlen
Reaktion (Signal → erste Bewegung), Präsentation (Signal → Zone), Bewegungsdauer, Stabilisierung,
Gesamt (Signal → stabil). Ausdrücklich **nicht** „Zeit bis zum ersten Schuss“.
Fehlende Messungen werden als „—“ angezeigt und in Statistiken als *n/von* ausgewiesen, nie aufgefüllt.

## 6. Experimentelles Tracking (Phase 5) — Konzept, nicht implementiert

**Ausgangslage:** Die Kamera steht zwischen Sportler und TV und blickt zum Sportler. Der TV ist
nicht im Bild; seine Ebene lässt sich nicht aus dem Kamerabild bestimmen.

1. **Kameraintrinsik:** Schachbrett/ChArUco-Board vor der Telefonkamera (OpenCV.js `calibrateCamera`),
   einmal pro Gerät + Auflösung. Ergebnis: Brennweite, Hauptpunkt, Verzeichnung.
2. **Geräteorientierung:** ArUco/AprilTag-Marker (z. B. Würfel mit 3–5 Markern) am Trainingsgerät,
   `solvePnP` ⇒ Pose des Geräts im Kamerakoordinatensystem, mit Reprojektionsfehler als Gütemaß.
3. **Kamera ↔ TV-Transformation**, Optionen:
   * **a) Geometrisch vermessen:** Abstand Kamera–TV, Höhe, Bildschirmgröße manuell eingeben;
     Telefon per Wasserwaage/IMU (DeviceOrientation) ausgerichtet. Einfach, Fehler im Bereich mehrerer cm.
   * **b) Zielpunkt-Kalibrierung (empfohlen):** Der TV zeigt nacheinander ≥ 5 Punkte; der Sportler
     richtet das markierte Gerät jeweils darauf aus und hält still. Aus den Geräteposen und den bekannten
     Punkten werden TV-Ebene und -Lage per Ausgleichsrechnung (Strahl–Ebene, RANSAC) geschätzt;
     Residuen ergeben direkt die erreichbare Genauigkeit.
   * **c) Hilfsaufnahme:** Telefon kurz um 180° drehen, Marker auf dem TV erfassen, zurückdrehen —
     nur mit mechanisch reproduzierbarem Drehteller sinnvoll.
4. **Validierung vor jeder Wertung:** unabhängige Referenz, z. B. Laser-Trainingsgerät + zweite Kamera
   auf den TV, Vergleich geschätzter vs. tatsächlicher Auftreffpunkt über ≥ 100 Versuche,
   Bias und 95 %-Fehlerellipse je Distanz. Erst bei nachgewiesener Genauigkeit (Fehler deutlich kleiner
   als die A-Zone auf der dargestellten Distanz) darf eine Trefferanzeige entwickelt werden.

Schnittstelle vorbereitet: `PoseFrame` (Zeitbasis), `RepAnalyzer`-Ereignisse und `TrainingSession`
sind getrennt erweiterbar; ein `DeviceTracker` würde als weiterer Frame-Listener der `TrackingPipeline`
andocken.

## 7. Implementierungsstand

### Umgesetzt und automatisiert geprüft
* 33 Unit-Tests (`npm test`): Zustandsmaschine (Reihenfolge, Zeiten, 30/60 fps, Körpergröße,
  Zone ohne/mit Tiefe, Fehlstart, Trackinglücke, Rauschboden, Positionswechsel), Qualitätsbewertung,
  Kalibrierung, Uhrabgleich, Audio-Uhr-Abbildung, Frame-Statistik, Trainingslog/Statistik.
* `npm run typecheck`, `npm run build` fehlerfrei.

### Umgesetzt und im Browser geprüft (Desktop, ohne Kamera)
* Trace-App: Training, Live, Analysis, Settings; Stage Builder unverändert erreichbar.
* Relay + TV: Telefon-Tab und TV-Tab treten demselben Raum bei, Uhrabgleich ±0,4 ms, Stagewechsel
  erscheint sofort auf dem TV.
* MediaPipe lädt vollständig lokal; Inferenz GPU ≈ 6,6 ms, CPU ≈ 13,5 ms pro Frame (Desktop).
  Erster GPU-Frame ≈ 4,8 s (Shader-Aufwärmphase).
* Kamera verweigert ⇒ klare Fehlermeldung; Start ohne Kamera wird abgelehnt.
* Bestehender Player inkl. Aktivator/Swinger nach Refactoring unverändert.

### Erfordert Hardwaretests
* Echte Kamera auf Android-Chrome und iOS-Safari: gelieferte Auflösung/FPS, `captureTime`-Verfügbarkeit,
  Wake Lock, Thermik über 20 min.
* Pose-Qualität auf mehreren Metern Abstand, bei Gegenlicht, Dämmerung, verschiedenen Körpergrößen
  und Kleidung; Schwellen ggf. anpassen.
* Vollständiger Lauf Telefon + TV im WLAN (`npm run dev:lan`), inkl. TV-Browser (Tizen/webOS/Android TV).
* Validierung der Zeiten gegen eine Referenz (siehe Nächste Schritte).

## 8. Bedienung

```bash
npm install
npm run dev:lan      # HTTPS im LAN: https://<PC-IP>:5180
```

1. Telefon: `https://<PC-IP>:5180/#/trace` öffnen, Zertifikat akzeptieren, **Training → Connect TV**.
2. TV-Browser: angezeigte Adresse `…/#/tv/<CODE>` öffnen, Zertifikat akzeptieren, *Enable sound* falls
   der TV die Signale spielen soll, *Fullscreen*.
3. Telefon aufs Stativ, Rückkamera auf den Sportler, Ganzkörper im Bild. **Live → Start camera →
   Calibrate**.
4. **Training → Start training.** Ergebnisse je Rep auf Telefon und TV; danach unter **Analysis**.

Befehle: `npm test`, `npm run typecheck`, `npm run build`, `npm run models` (MediaPipe-Runtime und
Modelle nach `public/`, wird von dev/build automatisch ausgeführt).

## 9. Nächste Schritte (priorisiert)

1. **Hardwaretest + Referenzvalidierung (Phase 3 abschließen):** 240-fps-Referenzvideo
   (z. B. Smartphone-Zeitlupe) parallel aufnehmen, Ereignisse manuell annotieren, mit
   der exportierten Session-JSON vergleichen; Bias/Streuung je Kennzahl bestimmen, Schwellen
   kalibrieren, `ANALYZER_VERSION` erhöhen.
2. **Signal-Erkennung per Mikrofon** auf dem Telefon (Onset-Erkennung wie im FORTH TRACE Timer):
   misst den tatsächlich hörbaren Signalzeitpunkt, auch wenn der TV piept — eliminiert die
   unbekannte TV-Latenz.
3. **Pose-Frames mitspeichern** (komprimiert, optional) für nachträgliche Neuberechnung mit
   verbesserten Analysatorversionen; Video + Frames in IndexedDB statt nur im Speicher.
4. **Verbindung ohne Rechner:** WebRTC-DataChannel mit QR-Code-Signalisierung, oder Relay in einer
   Capacitor-App auf dem Telefon.
5. **Performance auf Telefonen:** Inferenz in einen Worker (OffscreenCanvas) verlagern, adaptive
   Auflösung bei niedriger FPS.
6. **Phase 5-Prototyp:** OpenCV.js-Kamerakalibrierung + ArUco-Pose des Trainingsgeräts, nur als
   Rohdaten-Logging mit Reprojektionsfehler — keine Zielpunktanzeige vor der Validierung.
7. Stage Builder (Editor) für Tablets anpassen; der Editor ist weiterhin Desktop-orientiert.

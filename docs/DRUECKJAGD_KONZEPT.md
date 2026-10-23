# FORTH TRACE · Drückjagd-Dryfire — Konzept

Stand: 23.10.2026 · Prototyp: `tools/plate-renderer/blender/hunt.py` (+ `hunt_compose.py`, `scripts/fetch-forest.mjs`)

## 1. Prinzip

- **Kein VR.** Man steht mit der eigenen, entladenen Büchse vor dem Bildschirm oder der Leinwand, schwingt mit und löst aus.
  Gewicht, Anschlag und Optik sind die echten.
- **Video statt Echtzeit.** Jede Übung ist ein fertig gerendertes Video (16:9 für YouTube, 9:16 für Shorts).
  Wald und Wild werden offline in Blender/Cycles gerendert. three.js im Studio dient nur zum Planen und als Vorschau.
- **Blickwinkel 1:1.** Die Kamera hat 42° horizontales Bildfeld. Steht man im Abstand **Bildbreite × 1,30** vor dem
  Bild, erscheint ein Stück Wild auf 35 m so groß wie in echt. Beispiele: 65"-TV (1,43 m breit) → 1,86 m Abstand,
  Leinwand 2,5 m → 3,3 m. Der Abstand kommt in die Videobeschreibung und auf den Briefing-Screen.
- **Perspektive:** Man sitzt auf einem Drückjagdbock (Auge ca. 3,3 m über dem Boden) am Rand einer Schneise und
  schaut die Schneise hinunter. Unten im Bild ist nur die Auflage des Bocks zu sehen, leicht unscharf.

## 2. Szenarien

### Ablauf eines Videos (eine „Drückjagd“ = 4–8 Anläufe, 3–6 min)

1. **Briefing** (wie bei den Stages): Revier/Schneise, Schussfeld, **Freigabe des Jagdleiters**, Sicherheitsregeln,
   Abstand zum Bildschirm.
2. **Anblasen** (Hornsignal „Aufbruch zur Jagd / Anblasen des Treibens“), dann Ruhe. Die Wartezeit zwischen den
   Anläufen ist zufällig (10–60 s): Erwartung und Konzentration gehören zur Übung.
3. **Anlauf:** Hundelaut und Rauschen im Laub kündigen das Wild an (Richtung über Stereo-Panning). Das Wild kommt aus
   der Deckung, kreuzt die Schneise, verhofft eventuell und ist wieder weg. Ansprechen, Freigabe prüfen,
   mitschwingen, Schuss — oder eben **nicht** schießen.
4. **Auflösung** nach jedem Anlauf (abschaltbar, z. B. nur am Ende): Standbild mit Wildart, Geschlecht/Klasse,
   Freigabe **ja/nein + Grund**, Haltepunkt mit Vorhaltemaß, Zeitfenster, in dem ein Schuss vertretbar war.
5. **Hahn in Ruh** und Abschluss-Screen mit allen Anläufen.

### Wild

| Wildart | Stücke / Klassen | Größe (Schulter) | Typisches Verhalten |
|---|---|---|---|
| Schwarzwild | Keiler, Bache (führend / nicht führend), Überläufer, Frischlinge (im Herbst ohne Streifen) | 0,5–1,0 m | einzeln oder als Rotte, oft im Troll, flüchtig in Reihe; Leitbache vorn |
| Rotwild | Hirsch (Klassen), Alttier, Schmaltier, Kalb | 1,0–1,5 m | Rudel: Alttier führt, Kalb folgt; zieht, trollt, flüchtig im Galopp |
| Damwild | Schaufler, Hirsch, Alttier, Schmaltier, Kalb | 0,8–1,0 m | Rudel, springt („prellt“), verhofft gern kurz auf der Schneise |

Später ergänzbar: Rehwild, Fuchs, Hund und Treiber als **Nicht-Ziele** (so wie die No-Shoots in IPSC).

### Parameter pro Anlauf

- **Entfernung** zur Wechselstelle: 20–70 m (Standard 30–50 m). Die Schneise ist 9 m breit, Wild ist 2–4 s frei
  sichtbar, davor und danach teilweise verdeckt hinter Stämmen und Verjüngung.
- **Gangart / Geschwindigkeit:** ziehen 1–1,5 m/s · trollen 3–4 m/s · flüchtig 7–10 m/s (Schwarzwild),
  bis 12 m/s (Rotwild) · Verhoffen 0,5–3 s.
- **Winkel:** quer (Breitseite), schräg auf den Stand zu oder vom Stand weg.
- **Gruppen:** einzeln, Paar, Rotte (z. B. Bache + 4 Frischlinge + 2 Überläufer) oder Rudel (Alttier, Kalb, Schmaltier).
  Bei Rotten/Rudeln mit Abständen in der Reihe, Leittier vorn.
- **Licht/Jahreszeit:** Herbst (Laub, Referenzfoto 1) und Winter mit Schnee (Referenzfoto 2, grüner Kanzel-Bock).
  Die Buchenverjüngung behält ihr trockenes braunes Laub den Winter über, das ist im Prototyp schon so angelegt.

### Freigabe und Regeln (Beispiel, im Briefing einstellbar)

Die Freigabe ist pro Video ein Regelsatz. Der Editor rechnet daraus für jedes Stück automatisch „frei / nicht frei“
und den Grund aus.

- **Schwarzwild:** Frischlinge und Überläufer frei; **keine führende Bache** (Elterntierschutz, § 22 Abs. 4 BJagdG);
  **nie die Leitbache**. In der Rotte von hinten nach vorn bzw. die Kleinen zuerst. Keiler nur, wenn freigegeben.
- **Rotwild/Damwild:** Kalb vor Alttier: ein Alttier nur, wenn sein Kalb vorher gestreckt wurde. Schmaltier frei.
  Hirsche nur nach Freigabe/Klasse.
- **Sicherheit:** nur in das markierte Schussfeld (Sektor) schießen, nicht in Richtung der Nachbarstände oder ins
  Treiben. Hund dicht am Stück → kein Schuss. Spitz von vorn oder von hinten → kein Schuss. Nicht sicher
  angesprochen → kein Schuss. Maximale Entfernung (z. B. 60 m).
- **Wertung:** Ohne Treffererkennung bewertet man sich selbst über die Auflösungs-Screens (richtig geschossen /
  richtig nicht geschossen / Fehler). Später ist eine Kopplung an FORTH TRACE denkbar (Kamera/Laserpatrone).

### Vorhalt (Richtwerte für den Auflösungs-Screen)

Mittlere Geschossgeschwindigkeit ~800 m/s auf 35–50 m; Vorhalt = Wildgeschwindigkeit × Flugzeit, bei durchgezogenem
Mitschwingen:

| | 35 m (0,044 s) | 50 m (0,063 s) |
|---|---|---|
| trollen 3,5 m/s | 15 cm | 22 cm |
| flüchtig 8 m/s | 35 cm | 50 cm |
| flüchtig 12 m/s | 53 cm | 75 cm |

Der Auflösungs-Screen zeigt den Haltepunkt (Blatt) und den Vorhaltepunkt auf dem eingefrorenen Bild.

## 3. Modelle: kaufen oder selbst bauen

**Wild: kaufen.** Ein photorealistisches Tier (Anatomie, Fell-Groom, Rig, saubere Gangarten) selbst zu bauen kostet
pro Art Wochen. Der Prototyp-Keiler ist absichtlich nur ein grober Platzhalter aus Metaballs mit Borsten-Kurven,
damit Pipeline, Größen und Timing stimmen. Darauf beim Kauf achten:

- **Blender-nativ mit Fell** (Hair Curves bzw. Partikel-Groom). Beim FBX-Export geht das Fell meist verloren.
- **Rig + Animationen:** mindestens ziehen/Schritt, Troll, Galopp/Flucht, Stehen/Sichern. Wenn Troll oder
  Galopp fehlen, kann ich sie auf dem gekauften Rig nachbauen (prozedural wie im Prototyp oder per Keyframes),
  das kostet aber Zeit. Vor dem Kauf die Animations-Previews ansehen.
- **Lizenz:** Royalty-free mit erlaubter Nutzung in monetarisierten Videos; nicht „Editorial only“.
- **Klassen:** Aus einem Modell lassen sich durch Skalierung, Groom-Länge/-Farbe und Proportionen mehrere Stücke
  machen (Keiler/Bache/Überläufer, Frischling). Geweihe (Rothirsch-Klassen, Damschaufler) müssen meist extra modelliert
  werden.

Kandidaten aus einer ersten Recherche (Preise und aktuelle Inhalte vor dem Kauf selbst prüfen):

1. **Wildschwein (Priorität 1):** „Fur Wild Boar v05 – rigged and animation“ (Blender/Cycles, Fell, Rig; Walk, Run,
   Idle, Eat, Attack; FBX ohne Fell) auf [CGTrader](https://www.cgtrader.com/3d-models/animal/mammal/fur-wild-boar-v05-rigged-and-animation-8115083a-4258-48a6-a389-1ee177e9f503),
   dazu eine schwarze Variante [v08](https://www.cgtrader.com/3d-models/animal/mammal/fur-black-wild-boar-v08-rigged-and-animation)
   und dasselbe Modell auf [TurboSquid](https://www.turbosquid.com/it/3d-models/3d-fur-wild-boar-rigged-and-animation-in-blender-model-1990500).
   Ein Troll ist dort nicht ausgewiesen.
2. **Rotwild:** Ein [Red Deer Stag](https://www.cgtrader.com/3d-models/animal/other/red-deer-stag-3d-model) (Rig; Walk,
   Run, Grazing, Idle; BLEND/FBX) wurde gefunden, ohne ausgewiesenes Fell-Groom. Alttier und Kalb fehlen.
   Qualitativ als Referenz: die VFX-Grace-Hirsche mit Blender-Fell ([Mule Deer](https://superhivemarket.com/products/mule-deer--vfx-grace),
   [Female Deer](https://www.cgtrader.com/3d-models/animal/mammal/female-canadian-deer-animation-vfx-grace)).
   Das sind nordamerikanische Arten; man müsste sie zu Rot- oder Damwild umbauen.
3. **Damwild:** Kein passendes Modell gefunden. Wahrscheinlich ein Umbau aus einem Hirschmodell (Fleckung, Spiegel,
   Schaufeln).

**Wald: Mischung.** Der Prototyp läuft komplett mit CC0-Material von Poly Haven (Laubstreu, Schotter, Rinde,
Totholz, Farn, Moos, Herbstwald-HDRI) und einem prozeduralen Buchengenerator (Stämme, Stangenholz, Naturverjüngung
mit Herbstlaub). Für Mittel- und Hintergrund reicht das. Mehr Realismus aus der Nähe bringt z. B. botaniq von
polygoniq, das eine „Fagus sylvatica autumn“ führt ([Katalog](https://docs.polygoniq.com/botaniq/7.3.0/catalog/deciduous/tree_fagus_sylvatica_t_autumn/), ~467k Dreiecke).
Optional, erst nach dem Wild.

## 4. Render-Weg

**Cycles, nicht EEVEE.** Fell, durchscheinendes Laub, weiche Schatten im bedeckten Wald und Tiefenschärfe sehen in
Cycles deutlich echter aus. Damit Cycles bezahlbar bleibt, wird **eine Plate pro Schneise plus nur das Wild** gerendert:

1. **Plate:** die leere Schneise, ein Bild bei statischer Kamera.
   Gemessen auf der RTX 2060: **~50 s für 1080p mit 256 Samples** (inklusive Szenenaufbau).
2. **Wild-Ausschnitte:** jeder Frame nur im Rechteck um das Tier und seinen Schatten, mit identischen
   Render-Einstellungen (Seed, Samples, Denoiser, Motion Blur). Alle Pixel, die das Tier nicht berührt, sind dadurch
   identisch mit der Plate. Gemessen: **~1 s pro Frame** mit dem Platzhalter-Keiler. Stämme und Verjüngung verdecken
   das Tier korrekt, Schatten und Umgebungslicht stimmen, weil der volle Wald mitgerendert wird.
3. **Compose:** Die Ausschnitte werden mit weicher Kante auf die Plate gesetzt (Abweichung am Rand ~2/255),
   danach wird das Video mit ffmpeg kodiert.

Hochrechnung pro Video (5 min, 30 fps, 1080p): Plate ~1 min; Wild ~3000 Frames mit sichtbarem Tier. Mit gekauften
Fellmodellen rechne ich mit 3–10 s pro Frame → **~3–8 h**. Gleichzeitig gerendert, beide aus derselben Szene:
16:9 und 9:16. Shorts bekommen eine eigene Hochkant-Kamera; sie werden nicht aus dem 16:9-Bild ausgeschnitten.
4K kostet etwa das Vierfache.

Grenze der statischen Plate: Es gibt **keinen Wind**, Laub und Äste stehen still. Ausbaustufe: eine Plate als
nahtlose Schleife von ein paar Sekunden mit leichtem Wind (≈ 2–3 h Rechenzeit pro Schneise, einmalig).

## 5. Einbau ins Studio

- **Daten:** `src/hunt/` mit `HuntLane` (Umgebung, Jahreszeit, Stand, Kamera, Schussfeld) und `HuntScenario`
  (Freigabe-Regelsatz + Liste von Anläufen: Zeit, Wildart, Klasse, Anzahl/Abstände, Wechsel (Ein- und Austritt),
  Gangart-Profil). Die JSON-Dateien nutzen App und Blender gemeinsam.
- **Editor:** Draufsicht der Schneise mit Stand, Schussfeld-Sektor und gezeichneten Wechseln, dazu eine Zeitleiste der
  Anläufe. Die Freigabe wird pro Stück automatisch aus dem Regelsatz berechnet. Vorschau in three.js mit
  Low-Poly-Proxys (GLB aus denselben Blender-Assets), nur zur Planung.
- **Render:** `npm run render:hunt -- <szenario>` → Blender (Plate + Ausschnitte, 16:9 und 9:16) → Compose →
  das Studio legt HUD und Screens darüber (`hud.ts`/`screens.ts`: Briefing mit Freigabe, Countdown, Auflösung mit
  Haltepunkt) und kodiert wie bei den Stage-Videos nach `D:/Dryfire-Videos`.
- **Ton:** Jagdhorn-Signale, Hundelaut, Laubrascheln, Wind. Die Sounds müssen CC0 sein oder lizenziert werden.

## 6. Prototyp (Stand)

`tools/plate-renderer`:

```
node scripts/fetch-forest.mjs                       # CC0-Assets nach public/tex/forest (einmalig, ~120 MB)
blender -b --factory-startup --python blender/hunt.py -- plate out/hunt/v1
blender -b --factory-startup --python blender/hunt.py -- game  out/hunt/v1 seconds=11
blender -b --factory-startup --python blender/hunt.py -- boar  out/hunt     # Modell-Check Nahaufnahme
blender -b --factory-startup --python blender/hunt_compose.py -- out/hunt/v1
ffmpeg -framerate 30 -i out/hunt/v1/frames/%04d.png -c:v libx264 -crf 17 -pix_fmt yuv420p out/hunt/v1/drueckjagd_proto.mp4
```

Inhalt: eine Schneise im herbstlichen Buchenwald mit Schotterweg und grünem Mittelstreifen, leicht nach rechts
abbiegend. Stand am linken Schneisenrand, Auflage unten im Bild. Ein Überläufer trollt mit 3,6 m/s auf 35 m von
links nach rechts über die Schneise.

Bekannte Grenzen: Der Keiler ist ein Platzhalter (Metaball-Körper, starre Laufsegmente, keine echte Anatomie). Die
Bäume sind prozedural (keine echten Buchenkronen-Scans). Es gibt keinen Wind und keinen Ton. Nur 16:9.

## 7. Entscheidungen, die bei dir liegen

1. **Kauf Wildschwein-Modell** (Kandidat oben). Damit ersetze ich den Platzhalter und baue Troll und Flucht aufs Rig.
2. Danach **Rot- und Damwild**: Kandidaten prüfen, eventuell Umbau.
3. **Größere Render-Jobs** (ein komplettes 5-min-Video, Winter-Schneise, 9:16) erst nach deiner Freigabe.

## 8. Stand 23.10.2026 (nachmittags): Sauen + Builder

**Sauen** (`tools/plate-renderer/blender/hunt.py`): Körper = Statue des Users (`public/tex/animals/boar_base.blend`,
erzeugt mit `blender/extract_boar_base.py` aus der Original-.blend), Vorderhand angehoben, Schweinekopf ersetzt durch
geformten Sauenkopf, eigene Lauscher/Augen/Gewaff/Pürzel, Läufe herausgeschnitten und an Knie/Sprunggelenk geteilt.
Fell = Hair-Curves (Borsten, dunkler Ansatz, melierte Spitzen). Klassen: Keiler, Bache, Überläufer, Frischling,
Frischling gestreift (Größe, Breite, Wurf, Lauflänge, Farbe, Streifen). Gangarten Troll und Galopp; Rotten-Aufstellung
(`rotte_layout`): Leitbache vorn, Frischlinge im Pulk, Überläufer hinten, ±8 % Größe, eigene Phase.

**Builder** (`#/hunt`, `src/hunt/*`): Szenario = Freigabe + Anläufe (Zeit, Wild je Klasse, Gangart, Tempo,
Entfernung, Richtung, Seed). Draufsicht (Anlauf ziehen = Entfernung), Zeitleiste (ziehen = Startzeit),
Freigabe/Auflösung live (`rules.ts`). „In Blender rendern“ → Vite-Plugin `scripts/hunt-render.mjs` startet Blender
(Plate je Format/Qualität gecacht, dann nur Wild-Ausschnitte, dann Ausschnitte mit Feather-Alpha). Der Player im
Builder legt die Ausschnitte auf die Plate; „MP4 exportieren“ kodiert im Browser (mediabunny) mit Briefing,
Auflösungskarten und Zusammenfassung. Formate 16:9 (42°) und 9:16 (30°).

Gemessen: Beispiel-Szenario (3 Anläufe, 1 Rotte à 7) in Vorschau-Qualität (960×540, 64 Samples) ≈ 8 min;
Plate ≈ 20 s. Final (1080p, 256 Samples) grob ×4–6.

Offen: Ton (Horn, Hundelaut), Wind, Rot-/Damwild, Wintervariante, gekaufte Tiermodelle optional.

## 9. Stand 23.10.2026 (abends): Bedienung wie der Match-Builder

- **Drückjagd ≙ Match** (`Hunt`): bis zu 9 Szenarien in Spielreihenfolge, eine Freigabe für die ganze Jagd,
  Briefing an/aus, Archiv, Duplizieren. Seite `#/hunt/<id>`: Szenarien ordnen/hinzufügen/entfernen, die ganze Jagd
  live in 3D abspielen (Briefing → je Szenario Titelkarte + Treiben → Auflösung), alle Szenarien nacheinander in
  Blender rendern, ein MP4 der ganzen Jagd exportieren.
- **Szenario ≙ Stage** (`HuntScenario`): Revier (Karte) + einer von 3 Ständen + Anläufe. Editor mit Revier- und
  Stand-Kacheln (Vorschaubilder aus Blender), Plan mit allen drei Ständen (klicken = wechseln).
- **Karten** (`src/hunt/maps.json`, von Blender und Studio gelesen): Buchenschneise Herbst, Buchenschneise Winter
  (Schnee, Altbuchen kahl, Verjüngung mit trockenem Laub), Fichtenschneise (prozedurale Fichten). Je 3 Stände:
  links am Schneisenrand, rechts weiter vorn (Blick schräg über die Schneise), Gegenrichtung.
- Blender: `hunt.py ... map=<id> stand=<0..2>`; `thumbs` (Stand-Vorschaubilder), `export3d map=<id> [boars=1]`
  (3D-Daten je Karte unter `public/3d/hunt/<map>/`). Neue Karte = Eintrag in maps.json + Look in `LOOKS` (hunt.py)
  und `LOOK` (HuntScene3D.ts), dann `thumbs` + `export3d`.

## 10. Stand 23.10.2026 (nachts): realistischere Wälder, Foto-Vorschau, schnellerer Render

- **Wälder:** Fichtenschneise mit fotogescannten Poly-Haven-Fichten (CC0) im Render; Buchen mit ambientCG-Fotorinde,
  Wurzelanläufen, feinem Reisig im Winter; Baumstümpfe; Stände und erste 20 m Sicht freier.
- **Live-Vorschau = Render-Look:** Die Kamera auf dem Stand steht fest, also zeigt die Vorschau als Hintergrund das
  Blender-Bild des Stands (`hunt.py previewplates` → `public/3d/hunt/<map>/plate_<n>_<fmt>.jpg` + `depth_…png`, 16 bit
  planare Tiefe in Rot/Grün). three.js schreibt die Tiefe in den Tiefenpuffer: die live laufenden Sauen verschwinden
  hinter Stämmen und Büschen wie im Render. Baum-Geometrie wird für die Vorschau nicht mehr geladen (~22 MB statt ~60 MB).
- **Schneller rendern:** Fell nach Entfernung (Bruchteil der Borsten, dicker), leere Bilder werden übersprungen,
  Final mit 160 statt 256 Samples (Hintergrund und Wild gleich). Gemessen Fichte · Stand 3 (55 s, 1080p): vorher
  hochgerechnet ~45–50 min, jetzt 27 min — die schweren Scan-Fichten bremsen, Buchen-Reviere sollten mehr profitieren.

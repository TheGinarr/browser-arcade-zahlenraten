/* ============================================================
   ZAHLENRATEN · game.js
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES SPIEL
   1. Zustand: Das Spiel würfelt eine geheime Zahl von 1 bis 100.
      Wir merken uns außerdem alle bisherigen Tipps (ein Set), die
      Anzahl der Versuche und die logisch noch möglichen Grenzen
      (untereGrenze / obereGrenze).
   2. Eingabe: Ein <form> im HTML liefert Enter-Taste und Knopf
      "Raten" mit einem einzigen "submit"-Ereignis.
   3. Auswertung (tippAbgeben): erst prüfen (leer? im Bereich?
      schon geraten?), dann vergleichen. Zu klein → "HÖHER",
      zu groß → "TIEFER", gleich → Treffer.
   4. Anzeige: Große Rückmeldung, Eingrenzung und Chip-Verlauf
      werden nach jedem Tipp aus dem Zustand neu aufgebaut.
      Es gibt kein <canvas>: Wenige Elemente, viel Text → DOM + CSS
      sind hier einfacher und barrierefreier.
   5. Ende: Bei einem Treffer blitzt das Feld, danach übernimmt
      gameOverDialog() aus ui.js (Initialen, Topliste, "Nochmal").
      Weniger Versuche = besser, deshalb richtung "runter".
   ============================================================ */

import { topliste, spielZuruecksetzen } from "./assets/storage.js";
import { bewegungReduziert, gameOverDialog, toplisteAnzeigen } from "./assets/ui.js";

/* ---------- Konstanten ---------- */
const SPIEL = "zahlenraten"; // Schlüssel für den Speicher (storage.js)
const KLEINSTE_ZAHL = 1;
const GROESSTE_ZAHL = 100;
const DIALOG_VERZOEGERUNG_MS = 500; // Zeit für das Aufblitzen, bevor der Dialog kommt

/* ---------- Elemente der Seite ---------- */
const formular = document.getElementById("formular");
const tippFeld = document.getElementById("tipp");
const fehlerBox = document.getElementById("fehler");
const rueckmeldungBox = document.getElementById("rueckmeldung");
const verlaufListe = document.getElementById("verlauf");
const grenzeUnten = document.getElementById("grenze-unten");
const grenzeOben = document.getElementById("grenze-oben");
const hudVersuche = document.getElementById("hud-versuche");
const hudBestwert = document.getElementById("hud-bestwert");
const toplisteBox = document.getElementById("topliste");
const resetKnopf = document.getElementById("reset");

/* ---------- Spielzustand ---------- */
let geheimzahl; // die gesuchte Zahl
let bisherigeTipps; // Set: alle schon abgegebenen Zahlen
let versuche; // Anzahl gültiger Tipps
let untereGrenze; // kleinste Zahl, die noch möglich ist
let obereGrenze; // größte Zahl, die noch möglich ist
// phase: "spielt"  → es wird geraten
//        "treffer" → Treffer, das Aufblitzen läuft noch, der Dialog kommt gleich
//        "vorbei"  → Dialog wurde gezeigt
let phase;

/* ============================================================
   Hilfsfunktionen
   ============================================================ */

/** Zufällige ganze Zahl von `min` bis `max`, beide inklusive. */
function zufallszahl(min, max) {
  // Math.random() liefert 0 bis <1. Mal Anzahl der Möglichkeiten, abrunden,
  // Startwert addieren: So sind 1 und 100 gleich wahrscheinlich.
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** "1 Versuch" / "7 Versuche": korrektes Deutsch für Einzahl und Mehrzahl. */
function versucheText(anzahl) {
  return anzahl === 1 ? "1 Versuch" : `${anzahl} Versuche`;
}

/**
 * Startet eine CSS-Animation (über eine Klasse) auch dann neu, wenn sie
 * gerade erst gelaufen ist.
 *
 * WARUM DER TRICK? Der Browser startet eine CSS-Animation nur, wenn die
 * Klasse NEU hinzukommt. Hängt .schuettel noch am Element oder wurde sie
 * im selben Moment entfernt und wieder gesetzt, merkt der Browser nichts
 * davon. Das Lesen von offsetWidth zwingt ihn, das Layout JETZT zu
 * berechnen ("Reflow"). Danach gilt die Klasse als frisch hinzugefügt.
 */
function animationNeuStarten(element, klasse) {
  element.classList.remove(klasse);
  void element.offsetWidth; // Wert wird nicht gebraucht, das Lesen genügt
  element.classList.add(klasse);
  // Aufräumen, damit die Klasse beim nächsten Mal wieder "neu" ist.
  element.addEventListener("animationend", () => element.classList.remove(klasse), { once: true });
}

/** Zeigt unter dem Eingabefeld eine Fehlermeldung und schüttelt das Feld. */
function fehlerZeigen(text) {
  fehlerBox.textContent = text;
  animationNeuStarten(tippFeld, "schuettel");
  tippFeld.focus({ preventScroll: true });
  tippFeld.select(); // markiert den Inhalt: direkt überschreibbar
}

/* ============================================================
   Anzeige
   ============================================================ */

/** Beste Leistung aus der Topliste (sie ist aufsteigend sortiert: wenigste Versuche zuerst). */
function bestwertAktualisieren() {
  const liste = topliste(SPIEL);
  hudBestwert.textContent = liste.length > 0 ? String(liste[0].punkte) : "–";
}

/** Setzt "Gesucht zwischen X und Y"; Zahlen, die sich ändern, "poppen" kurz. */
function grenzenAnzeigen(mitAnimation) {
  const anzeigen = [
    [grenzeUnten, untereGrenze],
    [grenzeOben, obereGrenze],
  ];
  for (const [element, wert] of anzeigen) {
    const neu = String(wert);
    if (element.textContent === neu) continue; // unverändert → keine Animation
    element.textContent = neu;
    if (mitAnimation) animationNeuStarten(element, "pop");
  }
}

/**
 * Ersetzt die große Rückmeldung. Jedes Mal entsteht ein NEUES Element,
 * dadurch spielt die Einblend-Animation aus dem CSS automatisch von vorn,
 * ganz ohne Reflow-Trick. replaceChildren tauscht den alten Inhalt aus.
 * `art`: "hoeher" | "tiefer" | "treffer" (steuert nur die Farbe im CSS)
 */
function rueckmeldungZeigen(art, text, pfeil) {
  const huelle = document.createElement("span");
  huelle.className = `rueckmeldung-text ${art}`;
  const wort = document.createElement("span");
  wort.textContent = text;
  const zeichen = document.createElement("span");
  zeichen.className = "pfeil";
  zeichen.textContent = pfeil;
  zeichen.setAttribute("aria-hidden", "true"); // Pfeil ist Deko, das Wort sagt alles
  huelle.append(wort, zeichen);
  rueckmeldungBox.replaceChildren(huelle);
}

/** Der Hinweis vor dem ersten Tipp. */
function startHinweisZeigen() {
  const huelle = document.createElement("span");
  huelle.className = "rueckmeldung-text start";
  huelle.textContent = "Gib deinen ersten Tipp ab";
  rueckmeldungBox.replaceChildren(huelle);
}

/** Fügt einen Chip mit Tipp und Pfeil VORN in den Verlauf ein (neuester zuerst). */
function chipHinzufuegen(zahl, art) {
  const chip = document.createElement("li");
  chip.className = `chip ${art}`;

  const zahlText = document.createElement("span");
  zahlText.className = "chip-zahl";
  zahlText.textContent = String(zahl);

  const pfeil = document.createElement("span");
  pfeil.className = "chip-pfeil";
  pfeil.setAttribute("aria-hidden", "true");
  pfeil.textContent = art === "hoeher" ? "▲" : art === "tiefer" ? "▼" : "★";

  // Für Screenreader: Wer nur Pfeile sieht, versteht nichts. Dieser Text
  // ist unsichtbar, wird aber vorgelesen.
  const lesetext = document.createElement("span");
  lesetext.className = "nur-screenreader";
  lesetext.textContent = art === "hoeher" ? "zu niedrig" : art === "tiefer" ? "zu hoch" : "Treffer";

  chip.append(zahlText, pfeil, lesetext);
  verlaufListe.prepend(chip);
}

/* ============================================================
   Spielablauf
   ============================================================ */

/**
 * Setzt alles auf Anfang. `fokussieren` ist beim ersten Laden false:
 * Auf dem Handy würde sonst sofort die Bildschirmtastatur aufpoppen und
 * die halbe Seite verdecken.
 */
function neuesSpiel(fokussieren) {
  geheimzahl = zufallszahl(KLEINSTE_ZAHL, GROESSTE_ZAHL);
  bisherigeTipps = new Set();
  versuche = 0;
  untereGrenze = KLEINSTE_ZAHL;
  obereGrenze = GROESSTE_ZAHL;
  phase = "spielt";

  verlaufListe.replaceChildren(); // leert die Liste (CSS :empty zeigt dann den Platzhalter)
  startHinweisZeigen();
  grenzenAnzeigen(false);
  hudVersuche.textContent = "0";
  fehlerBox.textContent = "";
  tippFeld.value = "";
  bestwertAktualisieren();
  toplisteAnzeigen(toplisteBox, SPIEL, versucheText);
  if (fokussieren) tippFeld.focus({ preventScroll: true });
}

/** Prüft die Eingabe. Gibt die Zahl zurück, oder null (dann wurde schon eine Fehlermeldung gezeigt). */
function eingabePruefen() {
  // Bei type="number" liefert .value einen leeren String, wenn der
  // Browser den Inhalt nicht als Zahl lesen kann (z. B. "abc" oder "1,2,3").
  const roh = tippFeld.value.trim();
  if (roh === "") {
    fehlerZeigen("Bitte gib eine Zahl ein.");
    return null;
  }
  const zahl = Number(roh);
  if (!Number.isInteger(zahl)) {
    fehlerZeigen("Bitte nur ganze Zahlen eingeben.");
    return null;
  }
  if (zahl < KLEINSTE_ZAHL || zahl > GROESSTE_ZAHL) {
    fehlerZeigen(`Die Zahl muss zwischen ${KLEINSTE_ZAHL} und ${GROESSTE_ZAHL} liegen.`);
    return null;
  }
  if (bisherigeTipps.has(zahl)) {
    fehlerZeigen(`Die ${zahl} hast du schon getippt.`);
    return null;
  }
  return zahl;
}

/** Wird bei jedem Absenden des Formulars aufgerufen (Enter oder Knopf). */
function tippAbgeben() {
  // Während des Aufblitzens passiert nichts. Wurde der Dialog mit Esc
  // geschlossen, ohne neu zu starten, beginnt der nächste Klick auf "Raten"
  // ein neues Spiel, damit man nie in einem toten Zustand hängen bleibt.
  if (phase === "treffer") return;
  if (phase === "vorbei") {
    if (!document.getElementById("spiel-dialog")) neuesSpiel(true);
    return;
  }

  const tipp = eingabePruefen();
  if (tipp === null) return;

  fehlerBox.textContent = "";
  bisherigeTipps.add(tipp);
  versuche += 1;
  hudVersuche.textContent = String(versuche);
  animationNeuStarten(hudVersuche, "pop");

  if (tipp === geheimzahl) {
    trefferBehandeln(tipp);
    return;
  }

  // Der Tipp war zu klein oder zu groß.
  const zuNiedrig = tipp < geheimzahl;
  if (zuNiedrig) {
    // Gesuchte Zahl ist größer als der Tipp. Math.max, falls der Tipp
    // unterhalb der bisherigen Grenze lag (dann ändert sich nichts).
    untereGrenze = Math.max(untereGrenze, tipp + 1);
    rueckmeldungZeigen("hoeher", "HÖHER", "▲");
    chipHinzufuegen(tipp, "hoeher");
  } else {
    obereGrenze = Math.min(obereGrenze, tipp - 1);
    rueckmeldungZeigen("tiefer", "TIEFER", "▼");
    chipHinzufuegen(tipp, "tiefer");
  }
  grenzenAnzeigen(true);

  // Feld leeren und Fokus behalten: Man kann sofort weitertippen,
  // am Handy bleibt die Tastatur offen.
  tippFeld.value = "";
  tippFeld.focus({ preventScroll: true });
}

function trefferBehandeln(tipp) {
  phase = "treffer";
  rueckmeldungZeigen("treffer", "TREFFER!", "★");
  chipHinzufuegen(tipp, "treffer");
  animationNeuStarten(tippFeld, "blitz"); // .blitz kommt aus style.css

  // Kurz warten, damit man das Aufblitzen sieht. Bei reduzierter Bewegung
  // gibt es keinen Effekt, also auch keinen Grund zu warten.
  const wartezeit = bewegungReduziert() ? 0 : DIALOG_VERZOEGERUNG_MS;
  setTimeout(dialogZeigen, wartezeit);
}

function dialogZeigen() {
  if (phase !== "treffer") return; // Sicherheitsnetz, falls zwischendurch neu gestartet wurde
  phase = "vorbei";
  const dialog = gameOverDialog({
    spiel: SPIEL,
    titel: "GETROFFEN!",
    punkte: versuche,
    punkteText: versucheText(versuche),
    richtung: "runter", // beim Raten ist WENIGER besser
    format: versucheText, // Topliste im Dialog hübsch anzeigen
    neustart: () => neuesSpiel(true),
  });
  // Schließt man den Dialog mit Esc, wird "neustart" nie aufgerufen. Das
  // "close"-Ereignis fängt das ab. Nach "Nochmal" steht phase schon wieder
  // auf "spielt", dann ist hier nichts mehr zu tun.
  dialog.addEventListener("close", () => {
    if (phase === "vorbei") neuesSpiel(true);
  });
}

/* ============================================================
   Ereignisse
   ============================================================ */

formular.addEventListener("submit", (ereignis) => {
  // Ohne preventDefault würde der Browser die Seite neu laden (so
  // schickt ein <form> normalerweise Daten an einen Server).
  ereignis.preventDefault();
  tippAbgeben();
});

// Sobald jemand weitertippt, ist die alte Fehlermeldung überholt.
tippFeld.addEventListener("input", () => {
  fehlerBox.textContent = "";
});

resetKnopf.addEventListener("click", () => {
  spielZuruecksetzen(SPIEL);
  toplisteAnzeigen(toplisteBox, SPIEL, versucheText); // jetzt leer
  bestwertAktualisieren(); // zeigt wieder "–"
});

/* ============================================================
   Start
   ============================================================ */
neuesSpiel(false);

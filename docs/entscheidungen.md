# Entscheidungen von Marco

## 23.10.2026 (nach Team-Prüfung der Spezifikation)
1. **Technik:** Vite + React + TS als PWA auf GitHub Pages (wie Gewohnheiten); KI-Analyse als Supabase Edge Function; kein Next.js, kein Vercel. Tailwind/Framer Motion erlaubt, Farben nur über Designsystem-Tokens.
2. **Datenbank:** Rechenstern-Muster im geteilten Projekt `asfwbuptsfcrgmmgdgim`: Schema `braincraft`, RLS an, keine Policies, Zugriff nur über `public.bc_*`-Funktionen mit Familien-Code (Hash). PIN als bcrypt, Sterne mit Buchungsprotokoll.
3. **Heftfotos:** privater Bucket `bc-scans`, Fotos nach der Analyse löschen; es bleiben nur Folien und Fragen.
4. **Spiel (Kinder-Regeln):** keine Herzen, die ein Spiel beenden; „Lerntage diese Woche“ statt Serien-Flamme; eigene Begriffe statt Minecraft/Netherite/Steve/Original-Sounds (Begriffsliste Gestaltungs-Greta); Shop-Stufen 60/100/300 Sterne.

## Team-Festlegungen auf Grundlage dieser Entscheidungen (änderbar)
- Leitner-Intervalle 0/1/3/6/14 Tage; falsche Antwort: 2 Stufen zurück (mind. 1), am Rundenende nochmal; Intervalle bis zum Arbeitsdatum gekürzt (Lern-Lotte).
- Boss ab 70 % der Fragen auf Stufe ≥ 3, 10 Lebenspunkte, kein Verlust bei Fehlern (Lern-Lotte).
- Sterne: 1 je richtig im 1. Versuch, +3 Rundenende, Boss +10, Gemeinsam-Abfragen +1; Spielregel max. 40 Sterne/Tag; technische Obergrenze in der Datenbank 100/Tag.
- KI-Fragen erst nach Freigabe durch Eltern (Status entwurf/freigegeben).
- `user-scalable=no` entfällt; `touch-action: manipulation`.
- PIN 4 Stellen, kein Standardwert; Zurücksetzen nur durch Marco (service_role).

## 23.10.2026 (Nachtrag)
- Aufräum-Zeitplan an: pg_cron `braincraft-aufraeumen` täglich 3:17 UTC löscht abgelaufene Eltern-Sitzungen und Antworten älter als 400 Tage. Liegengebliebene Fotos räumt die Edge Function (Schritt 2) über `bc_scan_stale()` auf.
- Status der Gutscheine auf Deutsch: `offen`, `erledigt`, `storniert`.

## 23.10.2026 (Team-Festlegungen nach Bug-Bodos Logik-Prüfung)
- Antworten im Boss- und Chill-Modus ändern den Leitner-Stand nicht (nur Protokoll); „kein Verlust bei Fehlern“.
- Ab 0:00 am Vortag der Arbeit und am Tag selbst zählen Antworten zu dieser Arbeit wie Chill (Server erzwingt).
- Boss-Bonus (+10) ist von der Tages-Sternegrenze ausgenommen (einmal je Kind und Arbeit).
- An der Tagesgrenze wird auf den Rest gekürzt statt ganz abgelehnt.
- Neue Familien nur mit Einladungscode (service_role), PIN-Sperre nach 3 Fehlversuchen, PIN-Änderung und Familie löschen nur mit aktueller PIN.

## 23.10.2026 – Schritt 1 abgeschlossen
- Migration `supabase/001_braincraft.sql` (md5 100d8cf82f7a1cc85d5a61e967b09f7b) von Marco eingespielt; Kontrolle: Schema braincraft mit 17 Tabellen (RLS an, keine Policies), 30 Funktionen public.bc_* (26 für anon, 4 nur service_role), anon ohne Schema-/Tabellenrechte, Bucket bc-scans privat 1 MB, cron braincraft-aufraeumen aktiv, 12 Inventar-Teile, 0 Familien. Andere Apps unverändert.
- Einladungscode wird erst erzeugt, wenn die Einrichtung in der App fertig ist (Codes gelten 7 Tage).

## 23.10.2026 – KI ohne Zusatzkosten
- Marco will nichts für eine KI-API ausgeben. Gemini scheidet aus (Googles Bedingungen: keine Nutzung in Apps für unter 18-Jährige, in der EU keine Gratisstufe in Apps; siehe docs/pruefung/sicherheits-siggi-gemini.md).
- Entscheidung: Heftfotos werden am Mac über Claude Code ausgewertet (Marcos Abo). Ablauf: Fotos in `scans/<arbeit>/`, Claude erstellt `ergebnis.json`, `node tools/braincraft.ts pruefen` (gleiche Prüfung wie validate.ts), Marco spielt im Terminal mit PIN ein (`einspielen`), Freigabe in der App.
- Edge Function `bc-extract` und Migration `002_scan.sql` ruhen (geprüft, nicht ausgeliefert); Scan-Bereich im Eltern-Cockpit zeigt die Anleitung für den Mac.
- Offen: Probe-Scan mit einer echten Heftseite.

## 24.10.2026 – Spielregeln der Arena (nach Lern-Lotte und Bug-Bodo)
- Lösung aufdecken: Einzelantworten (Multiple Choice, Lückenwort, Detektiv, Blasen) nach dem 2. Fehler; Sortieren, Paare, Reihenfolge nach dem 3. Fehler oder dem 2. Fehler am selben Teil. Kein Stern.
- Nach einem Fehler: Sperre 1 s, Wackeln, „Kurz durchatmen!“ plus Denkanstoß je Spielform (nie die Antwort). Falscher Teil leuchtet kurz auf.
- Beim Aufdecken bleiben eigene richtige Teile grün, die Lösung erscheint gold gestrichelt.
- Aufgedeckte Fragen kommen am Rundenende als Wiederholung, ohne Stern und ohne Leitner-Änderung.
- Frust-Notbremse: nach 2 aufgedeckten Fragen in Folge einmal je Runde eine sichere Frage (Stufe 3/4, sonst 2, sonst schon gelöst), ohne Stern.
- Sterne nur für normale Fragen: 1 je richtig im 1. Versuch, +3 ab 5 Antworten. Lob für den Denkweg („Gut überlegt!“), Spiel-Lob nur als Beimischung.
- Rundenaufbau: Festigung aus Stufe 3/4; fällige Stufe 5 nur zum Auffüllen.
- Offen: Spickzettel/Folienverweis je Frage (Feld beim Scan), Erklärung für alle Spielformen, Vorabend-Modus (isEve) mit echten Klassenarbeiten anschließen, Tageslimit 40 Sterne beim Speichern.

## 24.10.2026 – Datenanbindung (Siggi-Prüfung)
- Behoben: Cockpit sperrt beim Verlassen der App und nach 3 Minuten ohne Bedienung; Eltern-Inhalte (Entwürfe mit Lösungen, Scan-Aufträge) werden nie auf dem Gerät gespeichert; Trennen ohne Wettlauf; neuer Familien-Code übersteht Neuladen bis zum Bestätigen; Fehler im Cockpit sichtbar, abgelaufene Freischaltung führt zur PIN zurück; Sperrzeit wird immer angezeigt; Familien-Code ohne Modulo-Verzerrung.
- Bekanntes Risiko (offen, Marco entscheidet): Alle Studio-Apps auf marcokland-web.github.io teilen sich einen Origin und damit localStorage. B.A.S.E lädt Skripte von jsdelivr ohne Integritätsprüfung (tesseract.js@5 ohne feste Version) und hat keine CSP. Ein manipuliertes Paket könnte den BrainCraft-Familien-Code lesen (Kinderzugriff, keine Elternrechte). Sofortmaßnahme in B.A.S.E: feste Versionen, integrity, CSP. Dauerhaft: eigene Domain je App.
- Hinweis: Safari löscht Daten normaler Tabs nach 7 Tagen ohne Nutzung; BrainCraft als Home-Bildschirm-App installieren.

## 25.10.2026 – Testfragen und gefundener Mangel
- Testdaten: scans/religion-test (Josef und seine Brüder) und scans/englisch-test (Colours, Animals and Family), je 10 Fragen, alle 7 Formate.
- Mangel (offen, Fix geplant): Doppelte Fragen werden in validate.ts und in bc_unit_import nur an Typ + Fragetext erkannt. Gleiche allgemeine Fragetexte („Setze das passende Wort ein:“) fallen dadurch weg. Fix: Erkennung über Typ + Text + Inhalt (validate.ts und Migration 003); bis dahin beim Scan jeder Frage einen eigenen Fragetext geben.

## 25.10.2026 – Wissens-Hub nach Lern-Lotte
- Kapitel je gescannter Einheit; Hub öffnet beim ersten ungesehenen Kapitel; Kapitel gilt als gesehen, wenn die letzte Folie erreicht ist.
- Neue Fragen erst, wenn ihr Kapitel gesehen wurde (Wiederholungen bleiben frei). Sperre greift erst mit Migration 004 (unit_views); vorher keine Sperre.
- Schlüsselwörter fett im Text und antippbar; im Fach Englisch mit englischer Stimme (ohne englische Stimme kein Vorlesen).
- Vorlesen: Abkürzungen/Zahlen mit Punkt trennen keine Sätze; Knopf heißt „Stopp“. Vorlesen in der Arena folgt später (Einstellungs-Text angepasst).
- Abschluss-Knopf: „Alle Folien angeschaut! Jetzt probierst du’s im Spiel.“
- Spickzettel geplant: nach 1. Fehler nur Folientitel, beim Aufdecken der Folientext; Fragen bekommen `slide` (Migration 004 slide_index).
- Scan-Anleitung für Claude Code: .claude/skills/braincraft-scan/SKILL.md; `pruefen` warnt bei zu vielen Folien/Sätzen/Schlüsselwörtern und fehlendem Folienverweis.

## 28.10.2026 – Sternen-Shop, Spickzettel, Vorlesen in der Arena
- Migrationen 003 (Doppelte über Typ + Text + Inhalt) und 004 (Folien gesehen, slide_index) sind live (geprüft 28.10.).
- Sternen-Shop (Kind): Sparziel immer sichtbar, bei großem Abstand „Schon X von Y Sternen“; Einlösen nur online, mit Rückfrage; Einlöse-ID je Belohnung bis zum Erfolg gemerkt (keine Doppelbuchung nach Netzabbruch). Texte nach Lern-Lotte (docs/pruefung/lotte-shop.md): „Bekommen am …“, Storno nennt die Eltern, kein Drängen zum Ausgeben.
- Shop-Verwaltung (Eltern): Vorschläge 60/100/300 ohne Startdaten in der Datenbank; 8 Symbole; Storno und Löschen mit roter Rückfrage; Hinweis „Gutscheine möglichst innerhalb einer Woche erfüllen“, ab 7 Tagen „wartet seit N Tagen“; Fairness-Tipp im Formular.
- Spickzettel in der Arena: nach dem 1. Fehler nur Folientitel, nach dem Aufdecken der Folientext; nur wenn die Frage einen Folienbezug hat (Testarbeiten haben keinen).
- Vorlesen in der Arena: Lautsprecher an der Frage (Frage, Lückensatz, Antwortmöglichkeiten); „Automatisch“ liest jede neue Frage vor.
- Doppelter Ordner BrainCraft/DasTeam gelöscht (28.10., Marco).

## 28.10.2026 – Boss-Fight und Gemeinsam-Abfragen (Plan: docs/plan-boss-gemeinsam.md)
- Auslieferung zunächst unter marcokland-web.github.io/BrainCraft wie die anderen Apps (eigene Domain später).
- Gemeinsam-Abfragen ändert den Lernstand wie das Üben (Server-Verhalten von bc_answer mode 'eltern').
- Tagesgrenze 40 Sterne wird vom Server erzwungen (Migration 005; Boss-Bonus ausgenommen).
- Boss nach dem Sieg erneut spielbar, aber ohne Belohnung (Sterne und Teil nur beim ersten Sieg).

## 29.10.2026 – Veröffentlicht, Gemeinsam-Abfragen
- BrainCraft ist live unter https://marcokland-web.github.io/BrainCraft/ (Repository marcokland-web/BrainCraft, GitHub Actions → Pages). Migration 005 eingespielt (geprüft 29.10.).
- Gemeinsam-Abfragen im Eltern-Cockpit: Kind und Arbeit (oder „Alles, was fällig ist“) wählen, Runde über buildRound (Vorabend wie Chill), mündliche Fassung je Spielform, Lösung zuerst verdeckt, „Gewusst (+1 Stern)“ / „Nochmal üben“ (nicht rot). Antworten direkt mit Eltern-Token (mode 'eltern'), feste Antwort-ID je Frage; Runde nur im Speicher, nach PIN weiter bei derselben Frage, beim Sperren/Verlassen verworfen. Während der Runde zeigt das Cockpit nur die Abfrage.
- Marco (29.10.): direkt bauen und veröffentlichen; Team-Prüfung (Siggi, Bodo, Doris, Lotte) folgt nachträglich. Vorab geprüft: eigener Fake-Server-Lauf (16/16), bisherige Tests grün, Freigabe-Prüfung bestanden.

## 29.10.2026 – Klassenarbeiten löschen, Zurücksetzen (Migration 006)
- Eltern-Cockpit „Klassenarbeiten“: einzeln löschen (bc_exam_delete, Rückfrage mit rotem Knopf); Folien, Fragen, Lernstand und Antworten dazu werden mitgelöscht, verdiente Sterne und Teile bleiben.
- „Neu anfangen“: Sterne und Fortschritt zurücksetzen (bc_progress_reset, Migration 006) mit Eltern-Token und PIN, ein Kind oder alle; löscht progress, answers, unit_views, star_ledger, inventory, boss_wins, redemptions (auch offene Gutscheine, ohne Rückbuchung); Bremse 5 je 24 h. Freigegeben von Sicherheits-Siggi und Bug-Bodo (docs/pruefung/*-006.md).
- Offen für Migration 007: alte Offline-Antworten anderer Geräte werden nach dem Zurücksetzen neu gebucht (profiles.progress_reset_at). Bis dahin Hinweis in der Rückfrage.

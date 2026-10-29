# Migration 006 Zurücksetzen: Bericht von Daten-Dieter (29.10.2026)

**Datei:** `supabase/006_zuruecksetzen.sql`, md5 `3bebfe7ff2e5ed164f4ea29b5e8e9b25` (ohne begin/commit)
**Rumpf `bc_progress_reset`:** md5 `79834daaff8946fd282eea74b846d86a`
**Tests:** `supabase/tests/006_zuruecksetzen.sql`, md5 `fc81bf3ca91cc0d33286bcbd811a0df3`
**Stand:** Entwurf. Der Probelauf ist bestanden (43/43). **Noch nicht eingespielt.** Vorher prüfen Bug-Bodo und Sicherheits-Siggi, das Einspielen startet Marco.

## Was die Migration ändert

| Teil | Änderung |
|---|---|
| `braincraft.progress_resets` | Neu: `id`, `family_id` (cascade), `profile_id` (null = alle Kinder, bei gelöschtem Kind set null), `profiles`, `created_at`. RLS ist an, es gibt keine Policies und keine Tabellenrechte. Dient der Bremse und zum Nachvollziehen. Einträge älter als 30 Tage löscht die Funktion selbst. |
| `public.bc_progress_reset(p_code, p_token, p_pin, p_profile_id)` → jsonb | Neu, SECURITY DEFINER, `search_path=''`, EXECUTE für anon/authenticated/service_role |
| Rechte | Dieselbe Schleife wie in 003–005 |

Bestehende Funktionen und Zeilen bleiben unverändert. 005 ist live (md5 von `book`/`bc_answer` stimmt), 006 baut aber nicht darauf auf.

## Ablauf der Funktion

1. `braincraft.parent` prüft das Token, sonst `pin_required`.
2. `p_profile_id` ist gesetzt: `need_profile` prüft das Kind, sonst `profile_not_found`. Ist es null, betrifft der Aufruf alle Kinder der Familie.
3. Die Familienzeile wird gesperrt (`for update`). Danach greift die **Bremse**: Gab es in 24 h schon 5 Zurücksetzungen, kommt `limit_reached` (raise). Die Bremse wird vor der PIN geprüft. So verbraucht sie keinen PIN-Versuch, und parallele Aufrufe können sie nicht überholen.
4. `braincraft.pin_verify`: Bei falscher PIN oder Sperre gibt die Funktion dessen Ergebnis `{ok:false, error:'pin_wrong'|'pin_locked', locked_until}` zurück, ohne raise. Der Fehlzähler bleibt also stehen, genau wie bei `bc_family_delete`.
5. Die betroffenen Kinder werden gesperrt (wie in `book()`). Dann löscht die Funktion progress, answers, unit_views, star_ledger, inventory, boss_wins und redemptions (alle Gutscheine, auch offene) und setzt `stars_balance = 0`.
6. Sie schreibt einen Protokolleintrag und gibt `{ok:true, profiles:n, reset_at}` zurück.

Erhalten bleiben Familie, Kinder, PIN, Eltern-Sitzungen, Fächer, Klassenarbeiten, Lerneinheiten, Fragen (mit Freigabe-Status), Belohnungen, Scan-Aufträge und die Teile-Liste.

**Zur Bremse:** Ohne eigenes Protokoll geht es nicht, denn das Ledger wird ja gelöscht. Die schlankste dauerhafte Lösung ist die kleine Tabelle mit Selbstaufräumung nach 30 Tagen. Zwei Zähler-Spalten in `families` wären noch kleiner, sie zählen aber nur in festen Zeitfenstern statt gleitend über 24 h und zeigen nicht, wer wann zurückgesetzt wurde.

## Probelauf

Über die CLI ging ein äußerer DO-Block: die Migration zweimal (Idempotenz), dann die Tests, am Ende eine erzwungene Exception. Die CLI kürzt die Meldung, deshalb gab es drei Läufe mit unterschiedlicher Reihenfolge (vorwärts, rückwärts, von der Mitte aus). Jeder meldet **`BRAINCRAFT-006 43/43 bestanden`**. Zusammen ist jede der 43 Zeilen einzeln als OK zu sehen (1–16, 15–29, 28–43).

- **A Rechte:** anon und authenticated haben EXECUTE auf `bc_progress_reset`. Auf `pin_verify`, `parent`, `family`, `need_profile`, `is_parent` und `book` haben sie keines, auf `progress_resets` keine Tabellenrechte, auf das Schema kein USAGE. RLS ist an. Der md5 des Rumpfs stimmt mit der Datei überein, SECURITY DEFINER und `search_path=''` sind gesetzt. Echt als anon aufgerufen: ohne Token `pin_required`, beim Lesen der Tabelle 42501. Danach ist die Rolle wieder postgres.
- **B Abgelehnt:** ohne Token und mit dem Token einer anderen Familie `pin_required`. Fremdes Kind und unbekannte ID ergeben `profile_not_found`. Falsche PIN und falsches Format liefern `pin_wrong`, und `pin_fails` zählt 1, dann 2. Danach ist nichts gelöscht und das Protokoll leer.
- **C Ein Kind:** Alle sieben Tabellen des Kindes sind leer, der Stand ist 0. Geschwister und Familie B sind unberührt. Kinder, Fächer, Arbeiten, Einheiten, Fragen (frei und Entwurf), Belohnungen, Sitzung, PIN-Hash und Teile bleiben gleich. Die richtige PIN setzt den Fehlzähler auf 0. `bc_pull` zeigt für das Kind stars_balance, stars_today und learn_days_week je 0 und keine progress-, unit_views-, inventory-, boss_wins- oder redemptions-Einträge. Das Geschwisterkind behält 25 Sterne und seinen Lernstand. Danach bucht eine Antwort wieder 1 Stern, Leitner-Stufe 2.
- **D Alle Kinder:** Nach drei falschen PINs kommt die Sperre, dann liefert auch die richtige PIN `pin_locked` und es wird nichts gelöscht. `null` setzt 3 Kinder zurück, alle stehen auf 0. Familie B ist unberührt, `bc_pull` aus Kind-Sicht ist leer und zeigt überall 0.
- **E Bremse:** Die 5. Zurücksetzung geht, die 6. ergibt `limit_reached`. Das gilt auch mit falscher PIN, und `pin_fails` bleibt dann 0. Abgelehnte Aufrufe zählen nicht. Familie B hat ihre eigene Bremse. Einträge älter als 24 h zählen nicht mehr, ältere als 30 Tage werden aufgeräumt. Wird ein Kind gelöscht, bleibt sein Protokolleintrag ohne Kind-Bezug.

**Live ist nichts geblieben.** Vorher- und Nachher-Stand sind identisch: 43 Funktionen mit md5 über Rumpf und Rechte `14005ab2…`, kein `bc_progress_reset`, keine `progress_resets`, Familie, Profil und progress per md5 gleich, answers 78, Ledger 83/106, Fragen per md5 gleich.

## Hinweise

1. **Offline-Warteschlange eines zweiten Geräts (wichtig):** Liegen auf einem anderen Gerät noch Antworten aus der Zeit vor dem Zurücksetzen, werden sie danach neu gebucht, denn ihre `answers`-ID gibt es nicht mehr. So kommen Sterne und Lernstand teilweise zurück. Gutscheine (Stand 0 → `not_enough_stars`), Runden (`round_too_short`) und Boss-Siege (Lernstand fehlt) sind dagegen geschützt. Vorschlag für 007: `profiles.progress_reset_at`, und `bc_answer` ignoriert Antworten mit `answered_at < progress_reset_at`. Zurückdatieren schadet dabei nur dem eigenen Kind. Die App sollte außerdem auf dem Eltern-Gerät nach dem Erfolg die Warteschlange der betroffenen Kinder leeren und sofort `bc_pull` laden.
2. **App-Abgleich:** Das Zurücksetzen wirkt nur, wenn die App den Stand aus `bc_pull` übernimmt und Sterne oder Lernstand nicht mit dem lokalen Stand zusammenführt (etwa per Maximum). Geprüft habe ich das in `src/lib/store.ts` nicht vollständig.
3. **Tagesgrenze:** Das Zurücksetzen löscht auch die heute verdienten Sterne. Das Kind kann am selben Tag also wieder 40 verdienen. Die Bremse (5 in 24 h) begrenzt das, und auslösen können es nur die Eltern.
4. **Offene Gutscheine verfallen ohne Rückbuchung.** Die Rückfrage in der App sollte das sagen (Text-Tina): roter Knopf und PIN-Eingabe.
5. **Fehlercodes für die Übersetzung:** `pin_required`, `profile_not_found` und `limit_reached` kommen als raise, `pin_wrong`/`pin_locked` mit `locked_until` als Rückgabe.
6. **Einspielen:** Die Datei hat kein begin/commit. Sie muss deshalb in einer Transaktion laufen: entweder als ein CLI-Aufruf mit `-f` (eine Anfrage) oder im SQL-Editor mit eigenem `begin; … commit;` drumherum.

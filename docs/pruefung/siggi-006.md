# Migration 006 Zurücksetzen: Sicherheitsprüfung von Sicherheits-Siggi (29.10.2026)

**Geprüft:** `supabase/006_zuruecksetzen.sql` (md5 `3bebfe7ff2e5ed164f4ea29b5e8e9b25`), Rumpf `bc_progress_reset` (md5 nachgerechnet `79834daaff8946fd282eea74b846d86a`, stimmt mit Dieter überein), Tests `supabase/tests/006_zuruecksetzen.sql` (md5 `fc81bf3ca91cc0d33286bcbd811a0df3`, stimmt), `src/lib/store.ts` (Z. 285–330, 436–443), `src/views/Manage.tsx`.
**Art:** statisch und nur lesende Abfragen live. Einen eigenen Probelauf habe ich nicht gemacht (der braucht Marcos Erlaubnis). Ich verlasse mich auf Dieters Lauf (43/43).

## Ergebnis: Freigabe ja

Es gibt keinen blockierenden Befund. Dieters Punkt 1 muss nicht vor dem Einspielen gelöst sein, er kann als 007 kommen (Begründung unten).

## Geprüft und in Ordnung

| Punkt | Beleg |
|---|---|
| Rechte | Live haben anon/authenticated kein USAGE auf `braincraft`. In `braincraft` gibt es keine Default-Privilegien, deshalb bekommt die neue Tabelle auch keine Rechte; `revoke all on all tables` (Z. 84) räumt zusätzlich ab. Die Schleife Z. 88–101 entspricht 003–005. Live sind genau die 4 Server-Funktionen ohne anon-Recht (`bc_invite_create`, `bc_pin_reset`, `bc_scan_stale`, `bc_scan_update`), alle anderen 27 `public.bc_*` haben es, und alle sind SECURITY DEFINER mit `search_path=""`. Nach 006 kommt nur `bc_progress_reset` neu dazu. |
| Keine Objekte anderer Apps | Live gibt es keine `public.bc_*`-Funktion, deren Rumpf nicht auf `braincraft.` zeigt. Die Schleife trifft also nur BrainCraft. Die Migration legt nur `braincraft.progress_resets` und `public.bc_progress_reset` an. `bc_progress_reset` und `progress_resets` gibt es live noch nicht. |
| Fremde Familien und Kinder | `braincraft.parent` bindet das Token an die Familie des Codes (001 Z. 428). `need_profile` prüft das Kind gegen die Familie (Z. 49), und die Lösch-IDs kommen zusätzlich nur aus `profiles where family_id = f` (Z. 60–63). Gelöscht wird nur über `profile_id = any(v_ids)`. Fremde Familien und fremde Kinder sind also doppelt ausgeschlossen. |
| Kaskaden | Live zeigen alle Fremdschlüssel auf `profiles`. Auf die sieben geleerten Tabellen zeigt keiner, und Trigger gibt es in `braincraft` nicht. Das Löschen reißt also nichts mit. |
| PIN-Fehlzähler und Sperre | Wie bei `bc_family_delete`: `pin_verify` wirft nicht, und die Funktion gibt dessen Ergebnis normal zurück (Z. 56–57). Der Fehlzähler wird also festgeschrieben und nicht zurückgerollt. Die Sperre greift ab dem 3. Fehlversuch mit Wartezeit, die sich verdoppelt, und der Zähler ist derselbe wie beim Entsperren. Belegt durch Dieters Tests B6, B7, D1 und D2. |
| Bremse vor der PIN | Das ist sinnvoll. `limit_reached` kann nur entstehen, wenn vorher 5 Zurücksetzungen **mit richtiger PIN** gelungen sind; abgelehnte Aufrufe zählen nicht (Test E4). Ist die Bremse erreicht, wird die PIN gar nicht geprüft. So gibt es weder einen Versuch ohne Zählung noch einen Hinweis auf die PIN. Verraten wird mit gültigem Token höchstens, dass es heute schon 5 Zurücksetzungen gab, und das ist unerheblich. Läge die Bremse nach der PIN, kostete jeder Versuch über der Grenze unnötig einen PIN-Versuch. Die Zeilensperre auf `families` (Z. 51) verhindert, dass parallele Aufrufe die Bremse überholen. |
| Öffentliche Funktion, Grenzen | Aufrufen kann sie nur, wer ein Eltern-Token (kommt aus der PIN) **und** die PIN hat. Ein Fremder kann `progress_resets` nicht füllen, und pro Familie entstehen höchstens 5 Zeilen in 24 h. |
| Wiederholbarkeit | `if not exists` und `create or replace`, die Rechte-Schleife ist idempotent. Dieters Doppellauf ist bestanden. |
| App: PIN | Das Feld ist `type="password"`, `autoComplete="off"`, und die Eingabe wird im `finally` geleert (Manage.tsx). Die PIN wird nicht gespeichert und nicht protokolliert. Rückfrage und roter Knopf sind da. |
| App: Warteschlange | Der Filter in store.ts Z. 439 ist richtig: Bei `null` wird alles verworfen, sonst nur die Einträge des Kindes. |

## Hinweise (nicht blockierend)

**N1 Dieters Punkt 1: Offline-Antworten eines zweiten Geräts (mittel, als 007).**
Das Verhalten ist echt. Auf einem anderen Gerät bleiben nach dem Zurücksetzen Antworten in der Warteschlange. Sie werden neu gebucht, weil ihre `answers`-ID gelöscht ist (005 `bc_answer` nimmt bis zu 30 Tage alte Antworten an). Danach können sogar die Runde aus derselben Schlange (die 5 Antworten sind dann wieder da) und, falls der Lernstand reicht, ein Boss-Sieg durchgehen.
*Warum das nicht vor dem Einspielen sein muss:* Es ist keine neue Angriffsfläche. Ein Kind mit dem Familien-Code kann über `bc_answer` ohnehin jederzeit Antworten senden. Was zurückkommt, ist begrenzt: höchstens 40 Sterne je Tag für Antworten und Runden (live `stars_daily_limit` = 40), dazu der Boss-Bonus nur bei echtem Lernstand. Gutscheine kommen nicht zurück. Fremde Familien sind nicht betroffen. Es betrifft also, wie vollständig das Zurücksetzen wirkt, nicht die Sicherheit.
*Vorschlag 007:* wie Dieter `profiles.progress_reset_at`, gesetzt in `bc_progress_reset`. In `bc_answer` werden Antworten mit `answered_at < progress_reset_at` als `{ok:true, discarded:true}` angenommen, aber nicht gebucht. Dazu muss `bc_pull` `progress_reset_at` mitliefern, damit jedes Gerät ältere Einträge selbst aus der Schlange wirft. Das Klemmen auf `received_at` statt `answered_at` ist nicht nötig, denn wer zurückdatiert, schadet nur sich selbst. Bis dahin ein Satz in der Rückfrage (Text-Tina): „Öffne BrainCraft vorher auf allen Geräten einmal mit Internet.“

**N2 Laufendes Senden auf dem Eltern-Gerät (niedrig, App, an Bug-Bodo).**
`resetProgress` (store.ts Z. 436–443) wartet nicht auf ein laufendes `flush()`. Ist gerade eine Antwort unterwegs, kann sie nach dem Zurücksetzen landen. Außerdem entfernt `flush` danach mit `state.queue.slice(1)` (Z. 311/322) das erste Element der **schon gefilterten** Schlange. Das kann eine wartende Antwort eines anderen Kindes sein, die dann verloren geht.
*Vorschlag:* vor dem RPC `await flush()` (dann löscht das Zurücksetzen auch diese Antworten), und in `flush` den gesendeten Eintrag über seine Identität entfernen (`state.queue.filter((q) => q !== item)`), nicht über die Stelle.

**N3 Aufräumen des Protokolls (niedrig).**
Einträge älter als 30 Tage verschwinden nur bei der **nächsten** Zurücksetzung (Z. 75). Ohne weitere Zurücksetzung bleiben sie, bis die Familie gelöscht wird. Sie enthalten nur IDs, Anzahl und Zeitpunkt, keine Inhalte; die Kaskade beim Löschen der Familie ist vorhanden. Das ist vertretbar. Der Kopfkommentar (Z. 9–10) sollte das aber genau sagen, oder das Aufräumen läuft beim nächsten Gelegenheitsaufruf (z. B. im bestehenden Scan-Cron) mit.

**N4 Einspielen.** Wie Dieter Punkt 6: in einer Transaktion. Danach mit `has_function_privilege('anon', 'public.bc_progress_reset(text,text,text,uuid)', 'execute')` = true und `has_table_privilege('anon', 'braincraft.progress_resets', 'select')` = false gegenprüfen.

## Nicht geprüft

- Kein eigener Probelauf (dafür fehlt Marcos Erlaubnis), Laufzeitverhalten nach Dieters 43 Tests.
- Ansicht auf den drei Geräten (Sache von Design-Doris).

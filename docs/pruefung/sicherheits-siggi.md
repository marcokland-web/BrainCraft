# Sicherheits-Siggi: Sicherheit und Datenschutz (23.10.2026)

Blocker
1. Tabellen in public ohne RLS und ohne Familienbezug → Rechenstern-Muster (eigenes Schema, RLS an, keine Policies, nur `public.bc_*`-Funktionen mit Familien-Code als SHA-256, Grenzen).
2. Öffentlicher Bucket bc-scans mit Kinderheften → privat, Upload über Server-Funktion, kurze Signed URLs, Fotos nach Analyse löschen/befristen. ON DELETE CASCADE löscht keine Storage-Objekte.
3. Anthropic-Schlüssel: Next.js-Route läuft nicht auf GitHub Pages → Edge Function mit Secret; Familien-Code + Eltern-Freigabe, max. 10 Bilder/Aufruf, max. 1 MB/Bild, nur JPEG/PNG, Tageslimit je Familie, globale Obergrenze, Ausgabenlimit in Anthropic-Konsole.
4. Eltern-PIN Klartext mit Default 1234, lesbar → kein Default, crypt()/bcrypt, nur serverseitig lesbar und geprüft, Sperre nach 3 Fehlversuchen.

Wichtig
5. Kinderdaten an KI-Anbieter: Namen nicht in den Prompt (Platzhalter), Eltern-Hinweis Name/Schule abdecken; Aufbewahrung der API-Daten vor Start nachlesen.
6. Widerspruch zur Kinder-Regel „Daten bleiben auf dem Gerät“ → lokal zuerst, Sync freiwillig, dokumentierte Ausnahme für KI-Scan.

Hinweise
7. user-scalable=no → weglassen, touch-action: manipulation.
8. Sterne clientseitig manipulierbar (im Familienkreis vertretbar); Gutschein-Erledigung nur mit PIN.
9. Modell veraltet.

Fragen: Fotos in Cloud? Eigenes Supabase-Projekt wegen Kinderfotos? Hosting? Scan nur mit PIN? Monatsbudget KI?

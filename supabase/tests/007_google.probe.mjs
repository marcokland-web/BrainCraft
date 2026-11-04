// Daten-Dieter / Bug-Bodo: Probelauf der Migrationen 001, 003-008 in PGlite (echtes PostgreSQL als WASM, lokal)
// mit Attrappen für die Supabase-Schemas (auth.users/auth.uid(), extensions.digest/crypt, storage, cron).
// Prüft 007 (Google-Anmeldung, Bestandsfamilie, Einladungen, Rechte) und 008 (Code entfernen).
// Die echte Datenbank wird NIE erreicht. crypt() ist hier eine Attrappe (md5), bcrypt prüft das nicht.
// Aufruf: cd ~/Apps/BrainCraft && node supabase/tests/007_google.probe.mjs   (Exit-Code 0 = bestanden)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..') + '/'
const db = new PGlite()
const results = []
const ok = (name, cond, detail = '') => { results.push(!!cond); console.log(cond ? '  ok   ' : '  FEHLER', name, cond ? '' : detail) }

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create schema auth; create schema storage; create schema cron;
create function extensions.digest(t text, a text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
create function extensions.gen_salt(a text, n int) returns text language sql as $$ select 'salt' $$;
create function extensions.crypt(p text, s text) returns text language sql immutable as $$ select 'h$' || md5(p) $$;
create function extensions.gen_random_bytes(n int) returns bytea language sql as $$
  select substring(decode(md5(random()::text) || md5(random()::text) || md5(random()::text) || md5(random()::text), 'hex') from 1 for n) $$;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
create table storage.objects (id uuid, bucket_id text, name text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
`)

const run = async (f) => { await db.exec(readFileSync(DIR + f, 'utf8')) }
const tx = async (f) => { await db.exec('begin;\n' + readFileSync(DIR + f, 'utf8') + '\ncommit;') }
await run('001_braincraft.sql')
for (const f of ['003_duplikate.sql', '004_folien.sql', '005_tagesgrenze.sql', '006_zuruecksetzen.sql']) await tx(f)

// Bestand wie live: eine Familie mit Code, ein Kind, etwas Fortschritt; Marcos Konto und ein zweites Konto
const MARCO = '842f08e5-0b21-4941-ab50-fcee70d794e9'
const OTHER = '32c1fe54-c5f9-4d04-a409-5de8c6b0903a'
const STRANGER = '99999999-9999-4999-8999-999999999999'
await db.exec(`
insert into auth.users values ('${MARCO}', 'eltern.test@gmail.com', now()), ('${OTHER}', 'Zweit.Eltern+bc@GoogleMail.com', now()),
  ('${STRANGER}', 'fremd@example.org', now());
insert into braincraft.invites (code_hash, expires_at) values (encode(extensions.digest('INVITE0000000000', 'sha256'), 'hex'), now() + interval '1 day');
`)
const as = async (role, sub, sql, params = []) => {
  await db.exec('begin')
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })])
    await db.exec(`set local role ${role}`)
    const r = await db.query(sql, params)
    await db.exec('commit')
    return { rows: r.rows }
  } catch (e) {
    await db.exec('rollback')
    return { error: e.message }
  }
}
const CODE = 'ABCDEFGHJKMNPQRSTUVW'
let r = await as('anon', null, `select public.bc_create('INVITE0000000000', $1, 'Lia', '1234') as x`, [CODE])
ok('Bestand: Familie über alten Weg angelegt', r.rows, r.error)
const FAM = r.rows[0].x.family_id, KID = r.rows[0].x.profile_id
await db.exec(`insert into braincraft.star_ledger (profile_id, delta, reason) values ('${KID}', 5, 'correction');
  update braincraft.profiles set stars_balance = 5 where id = '${KID}';`)

// ---------- 007 ----------
await tx('007_google.sql')
ok('007 läuft durch', true)
await tx('007_google.sql')
ok('007 ist wiederholbar (idempotent)', true)
r = await db.query(`select family_id::text, user_id::text from braincraft.family_parents`)
ok('Bestandsfamilie Marco zugeordnet', r.rows.length === 1 && r.rows[0].family_id === FAM && r.rows[0].user_id === MARCO, JSON.stringify(r.rows))
r = await db.query(`select stars_balance from braincraft.profiles where id = $1`, [KID])
ok('Sterne bleiben erhalten', r.rows[0].stars_balance === 5)

// Rechte
r = await db.query(`select p.oid::regprocedure::text sig, has_function_privilege('anon', p.oid, 'execute') anon,
  has_function_privilege('authenticated', p.oid, 'execute') auth, coalesce('p_code' = any(p.proargnames), false) legacy
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'bc\\_%'`)
const neu = r.rows.filter((x) => !x.legacy && !/bc_create|bc_invite_create|bc_pin_reset|bc_scan_stale|bc_scan_update/.test(x.sig))
ok('neue Funktionen: nicht anon, aber authenticated', neu.length >= 33 && neu.every((x) => !x.anon && x.auth), JSON.stringify(neu.filter((x) => x.anon || !x.auth)))
ok('alte p_code-Funktionen bleiben für anon (bis 008)', r.rows.filter((x) => x.legacy).every((x) => x.anon))
r = await db.query(`select has_function_privilege('authenticated', 'braincraft.my_family()', 'execute') a, has_table_privilege('authenticated', 'braincraft.family_parents', 'select') b`)
ok('Helfer und Tabellen nicht direkt erreichbar', !r.rows[0].a && !r.rows[0].b)

// Alter Weg läuft weiter
r = await as('anon', null, `select public.bc_pull($1, null) ->> 'today' as x`, [CODE])
ok('alte App (p_code) funktioniert nach 007 weiter', r.rows && r.rows[0].x, r.error)

// Neue Wege
r = await as('anon', null, `select public.bc_pull(p_token => null) as x`)
ok('anon ohne Konto: bc_pull verboten', r.error && /permission denied/.test(r.error), r.error)
r = await as('authenticated', null, `select public.bc_pull(p_token => null) as x`)
ok('ohne sub: not_signed_in', r.error === 'not_signed_in', r.error)
r = await as('authenticated', STRANGER, `select public.bc_pull(p_token => null) as x`)
ok('Konto ohne Familie: no_family', r.error === 'no_family', r.error)
r = await as('authenticated', MARCO, `select public.bc_pull(p_token => null) as x`)
ok('Marco: bc_pull mit family_id und Kind', r.rows && r.rows[0].x.family_id === FAM && r.rows[0].x.profiles[0].child_name === 'Lia' && r.rows[0].x.parent === false, r.error)
r = await as('authenticated', MARCO, `select public.bc_session() as x`)
ok('bc_session: Familie', r.rows && r.rows[0].x.family_id === FAM, r.error ?? JSON.stringify(r.rows))

// Eltern-Rechte nur mit PIN
r = await as('authenticated', MARCO, `select public.bc_parents(p_token => null) as x`)
ok('bc_parents ohne Token: pin_required', r.error === 'pin_required', r.error)
r = await as('authenticated', MARCO, `select public.bc_parent_unlock(p_pin => '9999') as x`)
ok('falsche PIN: pin_wrong', r.rows && r.rows[0].x.error === 'pin_wrong', r.error)
r = await as('authenticated', MARCO, `select public.bc_parent_unlock(p_pin => '1234') as x`)
ok('richtige PIN: Token', r.rows && r.rows[0].x.ok && r.rows[0].x.token, r.error)
const TOK = r.rows[0].x.token
r = await as('authenticated', STRANGER, `select public.bc_parent_check(p_token => $1) as x`, [TOK])
ok('fremdes Konto mit Marcos Token: no_family', r.error === 'no_family', r.error)
r = await as('authenticated', MARCO, `select public.bc_parents(p_token => $1) as x`, [TOK])
ok('bc_parents: Marco ist Elternteil (is_me)', r.rows && r.rows[0].x.parents.length === 1 && r.rows[0].x.parents[0].is_me === true, r.error)

// Einladen per Gmail
r = await as('authenticated', MARCO, `select public.bc_parent_invite(p_token => $1, p_email => 'keine-adresse') as x`, [TOK])
ok('Einladung: ungültige Adresse -> bad_email', r.error === 'bad_email', r.error)
r = await as('authenticated', MARCO, `select public.bc_parent_invite(p_token => $1, p_email => 'Eltern.Test@gmail.com') as x`, [TOK])
ok('Einladung: eigene Adresse -> already_parent', r.error === 'already_parent', r.error)
r = await as('authenticated', MARCO, `select public.bc_parent_invite(p_token => $1, p_email => $2) as x`, [TOK, ' \u200BZweit.Eltern+x@GoogleMail.com\u00A0'])
ok('Einladung angelegt (vereinheitlicht: unsichtbare Zeichen, Punkte, +Zusatz, googlemail)', r.rows && r.rows[0].x.email === 'zweiteltern@gmail.com', r.error ?? JSON.stringify(r.rows))
r = await as('authenticated', OTHER, `select public.bc_session() as x`)
ok('Eingeladene: bc_session nimmt NICHT still an', r.rows && r.rows[0].x.family_id === null, r.error ?? JSON.stringify(r.rows))
r = await as('authenticated', OTHER, `select public.bc_my_invites() as x`)
ok('Eingeladene sieht die Einladung mit einladender Adresse', r.rows && r.rows[0].x.length === 1 && r.rows[0].x[0].family_id === FAM && r.rows[0].x[0].invited_by === 'eltern.test@gmail.com', r.error ?? JSON.stringify(r.rows))
r = await as('authenticated', STRANGER, `select public.bc_my_invites() as x`)
ok('Fremder sieht keine Einladung', r.rows && r.rows[0].x.length === 0, r.error)
r = await as('authenticated', STRANGER, `select public.bc_invite_accept(p_family_id => $1) as x`, [FAM])
ok('Fremder kann fremde Einladung nicht annehmen', r.error === 'invite_not_found', r.error)
r = await as('authenticated', OTHER, `select public.bc_invite_accept(p_family_id => $1) as x`, [FAM])
ok('Annehmen: Familie zugeordnet', r.rows && r.rows[0].x.family_id === FAM, r.error)
r = await as('authenticated', OTHER, `select public.bc_pull(p_token => null) ->> 'family_id' as x`)
ok('Eingeladene sieht Familie', r.rows && r.rows[0].x === FAM, r.error)
r = await db.query(`select count(*)::int n from braincraft.parent_invites`)
ok('Einladung nach Annehmen gelöscht', r.rows[0].n === 0)
r = await as('authenticated', OTHER, `select public.bc_invite_accept(p_family_id => $1) as x`, [FAM])
ok('zweites Annehmen: has_family', r.error === 'has_family', r.error)
r = await as('authenticated', STRANGER, `select public.bc_session() as x`)
ok('Fremder ohne Einladung: keine Familie', r.rows && r.rows[0].x.family_id === null, r.error)

// Ablehnen
await as('authenticated', MARCO, `select public.bc_parent_invite(p_token => $1, p_email => 'fremd@example.org')`, [TOK])
r = await as('authenticated', STRANGER, `select public.bc_invite_decline(p_family_id => $1) as x`, [FAM])
ok('Ablehnen löscht die eigene Einladung', r.rows && r.rows[0].x === true, r.error)
r = await as('authenticated', STRANGER, `select public.bc_my_invites() as x`)
ok('nach Ablehnen keine Einladung mehr', r.rows && r.rows[0].x.length === 0, r.error)

// Unbestätigte Adresse
await db.exec(`insert into auth.users values ('77777777-7777-4777-8777-777777777777', 'unbest@gmail.com', null)`)
await as('authenticated', MARCO, `select public.bc_parent_invite(p_token => $1, p_email => 'unbest@gmail.com')`, [TOK])
r = await as('authenticated', '77777777-7777-4777-8777-777777777777', `select public.bc_my_invites() as x`)
ok('unbestätigte Adresse sieht keine Einladung', r.rows && r.rows[0].x.length === 0, r.error)
r = await as('authenticated', '77777777-7777-4777-8777-777777777777', `select public.bc_invite_accept(p_family_id => $1) as x`, [FAM])
ok('unbestätigte Adresse kann nicht annehmen', r.error === 'invite_not_found', r.error)
r = await as('authenticated', MARCO, `select public.bc_parent_invite_delete(p_token => $1, p_email => 'unbest@gmail.com') as x`, [TOK])
ok('Einladung zurückziehen', r.rows && r.rows[0].x === true, r.error)

// Familie anlegen
r = await as('authenticated', MARCO, `select public.bc_family_create(p_child_name => 'X', p_pin => '1111') as x`)
ok('zweite Familie für Marco: has_family', r.error === 'has_family', r.error)
r = await as('authenticated', STRANGER, `select public.bc_family_create(p_child_name => 'Tom', p_pin => '12a4') as x`)
ok('Familie anlegen: PIN-Format', r.error === 'bad_pin', r.error)
r = await as('authenticated', STRANGER, `select public.bc_family_create(p_child_name => 'Tom', p_pin => '4321') as x`)
ok('Familie anlegen ohne Code', r.rows && r.rows[0].x.family_id, r.error)
const FAM2 = r.rows[0].x.family_id
r = await as('authenticated', STRANGER, `select public.bc_pull(p_token => null) as x`)
ok('neue Familie: eigenes Kind, keine fremden Daten', r.rows && r.rows[0].x.family_id === FAM2 && r.rows[0].x.profiles.length === 1 && r.rows[0].x.profiles[0].child_name === 'Tom', r.error)
r = await as('authenticated', STRANGER, `select public.bc_answer(p_answer_id => gen_random_uuid(), p_profile_id => $1, p_question_id => gen_random_uuid(), p_correct => true, p_first_try => true, p_mode => 'solo', p_answered_at => now()) as x`, [KID])
ok('fremdes Kind: profile_not_found', r.error === 'profile_not_found', r.error)
r = await as('authenticated', STRANGER, `select public.bc_parent_unlock(p_pin => '4321') ->> 'ok' as x`)
ok('neue Familie: PIN entsperrt', r.rows && r.rows[0].x === 'true', r.error)

// Kinder-Ablauf mit neuen Funktionen (Marco): Antwort, Runde, Gesehen, Einlösen-Fehler
r = await as('authenticated', MARCO, `select public.bc_round_finish(p_round_id => gen_random_uuid(), p_profile_id => $1) as x`, [KID])
ok('bc_round_finish ohne p_code erreichbar', r.rows || /round|answers|too/.test(r.error ?? ''), r.error)
r = await as('authenticated', MARCO, `select public.bc_profile_save(p_token => $1, p_id => null, p_child_name => 'Ben', p_avatar_id => null) as x`, [TOK])
ok('Eltern-Aktion mit Token (Kind anlegen)', r.rows && r.rows[0].x, r.error)

// Elternteil entfernen
r = await as('authenticated', MARCO, `select public.bc_parent_remove(p_token => $1, p_user_id => $2) as x`, [TOK, MARCO])
ok('sich selbst entfernen: cannot_remove_self', r.error === 'cannot_remove_self', r.error)
r = await as('authenticated', MARCO, `select public.bc_parent_remove(p_token => $1, p_user_id => $2) as x`, [TOK, OTHER])
ok('anderes Elternteil entfernen', r.rows && r.rows[0].x === true, r.error)
r = await as('authenticated', OTHER, `select public.bc_pull(p_token => null) as x`)
ok('entferntes Elternteil: no_family', r.error === 'no_family', r.error)
r = await as('authenticated', MARCO, `select public.bc_parents(p_token => $1) as x`, [TOK])
ok('Entfernen beendet Eltern-Sitzungen', r.error === 'pin_required', r.error)

// Grenzen: 3 neue Familien je 24 h
for (const id of ['a1', 'a2', 'a3']) {
  const u = `${id}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
  await db.exec(`insert into auth.users values ('${u}', '${id}@example.org', now())`)
}
const tries = []
for (const id of ['a1', 'a2', 'a3']) tries.push(await as('authenticated', `${id}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, `select public.bc_family_create(p_child_name => 'K', p_pin => '1234') as x`))
ok('Bremse: höchstens 3 neue Familien je 24 h (2 bestehen schon)', tries[0].rows && tries[1].error === 'limit_reached' && tries[2].error === 'limit_reached', JSON.stringify(tries.map((t) => t.error ?? 'ok')))

// ---------- 008 ----------
await tx('008_code_entfernen.sql')
ok('008 läuft durch', true)
r = await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'bc\\_%' and 'p_code' = any(p.proargnames)`)
ok('008: keine p_code-Funktionen mehr', r.rows[0].n === 0)
r = await db.query(`select count(*)::int n from information_schema.columns where table_schema = 'braincraft' and table_name = 'families' and column_name = 'code_hash'`)
ok('008: code_hash entfernt', r.rows[0].n === 0)
r = await as('authenticated', MARCO, `select public.bc_pull(p_token => null) ->> 'family_id' as x`)
ok('008: Marco weiter verbunden, Daten da', r.rows && r.rows[0].x === FAM, r.error)
r = await as('authenticated', MARCO, `select public.bc_pull(null) ->> 'family_id' as x`)
ok('008: Aufruf ohne Namen nicht mehr mehrdeutig', r.rows && r.rows[0].x === FAM, r.error)
await tx('008_code_entfernen.sql')
ok('008 ist wiederholbar', true)

const failed = results.filter((x) => !x).length
console.log(`\n${results.length - failed}/${results.length} bestanden`)
process.exit(failed ? 1 : 0)

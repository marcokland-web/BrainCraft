-- Einladungscode für eine neue BrainCraft-Familie erzeugen (einmal gültig, 7 Tage).
-- bc_invite_create ist nur für den Server (service_role); in dieser Transaktion setzen wir die Rolle dafür.
-- Aufruf (Marco, im Terminal):
--   cd ~/Apps/Gewohnheiten && npx supabase db query --linked --project-ref asfwbuptsfcrgmmgdgim -f ~/Apps/BrainCraft/tools/einladung.sql
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.bc_invite_create() as einladung;
commit;

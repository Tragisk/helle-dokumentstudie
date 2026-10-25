# LEA Dokumentstudie

Webværktøj til LEA's partnermateriale: master-skabeloner, der slår igennem hos alle partnere, og partner-varianter, der ligger ved siden af standarden.

- **App:** https://tragisk.github.io/helle-dokumentstudie/
- **Data:** Supabase-projektet *helle-dokumenter-og-videoer* (tabeller med præfikset `ds_`). Intet dokumentindhold ligger i dette repo.
- **Adgang:** Kun inviterede @leaforsikring.dk-adresser. Håndhæves i databasen (Row Level Security og en trigger på `auth.users`).

## Opbygning
- `src/lib/doc.ts` – dokumentmotoren (A4-sider i LEA-design, `{{partner}}`-pladsholder, sammenligning).
- `src/lib/store.tsx` – data og regler for, hvilken version en partner bruger.
- `src/components/` – brugerfladen.
- `supabase/functions/` – servicefunktioner: `ds-admin-brugere` (adgangskoder, kun admin) og `ds-claude-import` (upload fra Claude med tidsbegrænset nøgle).

## Begreber
- **Skabelon:** LEA's master. Rettes i en kladde og publiceres af admin som ny version (v1.1, v2.0 …).
- **Partner:** Følger enten nyeste standard, er låst til en bestemt standardversion eller bruger en **variant**.
- **Variant:** Partnerens egen version af et dokument. Markeres, når standarden ændres.

## PDF med udfyldelige felter

Knappen **Hent PDF** i et publiceret dokument opretter et job i `ds_pdf_jobs`. Edge Function `ds-pdf-start` starter workflowet `PDF` (`.github/workflows/pdf.yml`), som kører `pdf/lav_pdf.py`: dokumentet bygges i LEA-designet, gemmes som PDF med Chromium, og alle felter markeret med `data-f` bliver udfyldelige. PDF'en lægges i den private lagerplads `ds-pdf`, og appen henter den via et link, der udløber efter 5 minutter.

Opsætning (én gang):
- Supabase › Edge Functions › Secrets: `GITHUB_PDF_TOKEN` = finkornet GitHub-token til kun dette repo med *Actions: Read and write*.
- GitHub › Settings › Secrets and variables › Actions: `SUPABASE_SERVICE_ROLE_KEY` = service role-nøglen fra Supabase.

## Backup og hold i live

- Databasen tager selv et snapshot hver mandag nat (de 8 nyeste gemmes). Admin kan hente dem under **Backup og import**.
- Workflowet `Hold i live` pinger Supabase hver dag, så gratisprojektet ikke bliver sat på pause.
- Under **Backup og import** kan admin også importere en backup fra det gamle lokale HTML-værktøj.

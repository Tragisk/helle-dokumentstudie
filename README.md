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

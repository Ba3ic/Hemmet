# Hemmet

En delad hemapp (PWA) för två personer: kalender, listor med bilder, anteckningar, utgifter och en Idag-sida med väder från SMHI. Allt synkas i realtid via Supabase.

Appen är ren HTML, CSS och JavaScript (ES-moduler) utan byggsteg. Mappen kan läggas direkt på GitHub Pages, Netlify eller Cloudflare Pages.

## Struktur

```
index.html              Appskal, iOS-metataggar, tema sätts innan sidan ritas
manifest.webmanifest    PWA-manifest
sw.js                   Service worker (appskal + senast hämtade data offline)
css/app.css             All stil, mörkt och ljust tema via CSS-variabler
icons/                  App-ikoner (192, 512, apple-touch-icon 180)
js/config.js            DINA Supabase-uppgifter (fyll i själv)
js/app.js               Start, inloggningsflöde, router och flikrad
js/auth.js              Inloggning, registrering, skapa/gå med i hushåll
js/realtime.js          Supabase Realtime för alla tabeller
js/ui.js                Hjälpfunktioner: DOM, ikoner, blad, format, felmeddelanden
js/theme.js             Temaval (Mörk / Ljus / Angelica Mode / Följ systemet)
js/angelica.js          Glitter och katt i Angelica Mode
js/idag.js              Flik: Idag
js/kalender.js          Flik: Kalender
js/listor.js            Flik: Listor
js/anteckningar.js      Flik: Anteckningar
js/utgifter.js          Flik: Utgifter (Gemensamt + en flik per person, Lista/Trender)
js/utgifter-berakning.js Beräkningar: andel av gemensamt, inkomst, kvar, trender (utan DOM)
js/utgifter-kategorier.js Kategorier: välja, skapa, döpa om, ta bort
js/utgifter-trender.js  Trendvyn: rörliga utgifter per kategori över 6/12 månader
js/utgifter-graf.js     Stapelgraf per månad (egen SVG)
js/installningar.js     Inställningar (kugghjulet på Idag)
js/events.js            Händelser: hämtning och bladet för ny/redigera (Kalender + Idag)
js/images.js            Bilder: förminskning, uppladdning, signerade URL:er
js/weather.js           Väder från SMHI
schema.sql              Databasschemat (redan kört i Supabase)
migrations/             Databasändringar efter schema.sql, körs i nummerordning
tests/                  Tester för beräkningarna (node --test tests/utgifter.test.mjs)
```

## Kom igång

### 1. Supabase

1. Databasen skapas med `schema.sql` (SQL Editor > New query > Run). Kör den bara en gång.
2. Öppna **Project Settings > API** och kopiera **Project URL** och den **publika nyckeln** (`sb_publishable_…` eller den äldre `anon`-nyckeln).
3. Klistra in dem i `js/config.js`:

   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_...';
   ```

   Använd **aldrig** `service_role`- eller `sb_secret_`-nycklar i appen. Appen vägrar starta om den upptäcker en sådan.

4. **Authentication > URL Configuration**: sätt **Site URL** till adressen där appen ligger (t.ex. `https://dittnamn.github.io/hemmet/`) och lägg till samma adress plus `http://localhost:5511/` under **Redirect URLs**. Det är dit bekräftelselänken i registreringsmejlet leder.
   Vill ni slippa bekräfta e-post kan ni stänga av **Confirm email** under Authentication > Providers > Email.

### Migreringar

Efter `schema.sql` kör du filerna i `migrations/` i nummerordning, en gång var (SQL Editor > New query > Run):

| Fil | Vad den gör |
| --- | --- |
| `001_utgifter.sql` | Fasta utgifter får `start_month`/`end_month` så att de bara gäller framåt, och rörliga utgifter får `category` (`rorlig` eller `ovrigt`) för sektionen "Övrigt". |
| `002_personligt_och_kategorier.sql` | Personliga flikar och kategorier: `members` får `display_name` och `split_percent` (50), ny tabell `categories` (Mat, Utemat, Boende, Transport, Nöje, Övrigt), `owner` och `category_id` på utgifterna, ny tabell `incomes` för personlig inkomst och nya RLS-regler. Befintliga utgifter blir gemensamma med kategorin Övrigt, eller den kategori de heter exakt som (t.ex. "Mat"). Sektionen "Övrigt" ersätts av kategorin Övrigt. |

Saknas en migrering visar Utgifter-fliken ett felmeddelande som säger att den behöver köras.

### 2. Kör lokalt

Kräver Node.js (för `npx`). Stå i projektmappen och kör:

```bash
npx serve -l 5511 .
```

Öppna sedan <http://localhost:5511>. Service workern fungerar på `localhost` utan https.

Alternativ utan Node: `python -m http.server 5511`.

### 3. Skapa hushållet

1. Den ena av er registrerar sig och väljer **Skapa hushåll**.
2. Öppna **Inställningar** (kugghjulet uppe till höger på Idag) och kopiera inbjudningskoden.
3. Den andra registrerar sig, väljer **Gå med med kod** och skriver in koden.

## Lägg ut på GitHub Pages

1. Skapa ett nytt repo på GitHub, t.ex. `hemmet` (det kan vara privat om du har GitHub Pro, annars publikt; nyckeln i `config.js` är publik och datan skyddas av RLS).
2. Pusha mappen:

   ```bash
   git remote add origin https://github.com/DITTNAMN/hemmet.git
   git push -u origin main
   ```

3. På GitHub: **Settings > Pages > Build and deployment > Source: Deploy from a branch**, välj `main` och `/ (root)`, klicka **Save**.
4. Efter någon minut ligger appen på `https://DITTNAMN.github.io/hemmet/`. Alla sökvägar är relativa, så undermappen fungerar.
5. Lägg in den adressen i Supabase under **Authentication > URL Configuration** (se ovan).

Netlify och Cloudflare Pages fungerar likadant: peka på mappen, inget byggkommando, publiceringsmapp `/`.

### Uppdateringar

Service workern hämtar appens filer från nätet i första hand, så en ny version syns vid nästa omladdning. Lägger du till eller tar bort en fil i appen: lägg till den i listan `SHELL` i `sw.js` och höj `VERSION`.

## Lägg på iPhones hemskärm

Öppna adressen i **Safari**, tryck på **Dela** och välj **Lägg till på hemskärmen**. Hemmet öppnas då som en egen app utan adressfält.

## Utgifter

Överst finns flikarna **Gemensamt** och en per person. Namnet på fliken sätts under Inställningar (eller i rutan som visas i Utgifter tills namnet är ifyllt).

- **Gemensamt**: fasta och rörliga utgifter som ni delar, hushållets inkomst och vad som blir kvar.
- **Personlig flik**: inkomst − andel av gemensamt − egna utgifter = kvar. Andelen (50 %) räknas fram från Gemensamt varje gång och sparas aldrig som egna rader, så ändringar i Gemensamt syns direkt. Båda kan läsa varandras flikar, men bara ägaren kan ändra sin inkomst och sina egna utgifter (det skyddas av RLS i databasen).
- **Inkomst**: en återkommande lön följer med varje månad. Ändrar du beloppet väljer du om det gäller bara den månaden eller från och med den.
- **Kategorier**: varje utgift har en kategori. Tryck på kategorin på en rad för att byta, eller på **Kategorier** uppe till höger för att skapa, döpa om eller ta bort. Tas en kategori bort flyttas dess utgifter till Övrigt.
- **Trender**: rörliga utgifter per kategori de senaste 6 eller 12 månaderna, med filter, sortering efter belopp eller förändring och förändring mot föregående månad. I de personliga flikarna finns också "Kvar per månad".

Fördelningen styrs av `members.split_percent` (standard 50). Den går inte att ändra i appen ännu, men beräkningarna använder den redan.

## Teman

Välj tema under Inställningar: **Mörk** (standard), **Ljus**, **Angelica Mode** eller **Följ systemet**. Valet sparas i webbläsaren.
Angelica Mode är ett varmt, beige tema med dammrosa och guld, svagt glitter i bakgrunden en liten katt som då och då promenerar längs flikraden och en pixelkatt som strövar runt på skärmen. Glitter och katter stängs av helt om enheten är inställd på reducerad rörelse.

## Väder

Idag-sidan hämtar prognosen för Bandhagen (lat 59.27, lon 18.05) direkt från SMHI:s öppna API
[SNOW1gv1](https://opendata.smhi.se/metfcst/snow1gv1), som ersatte det äldre PMP3gv2 under 2025:

```
https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/18.05/lat/59.27/data.json
```

API:et skickar `Access-Control-Allow-Origin: *`, så det behövs ingen proxy eller Edge Function. Svaret cachas i minnet i 10 minuter, och service workern sparar det senaste svaret så att vädret syns även offline. Vill du byta ort ändrar du `LAT`, `LON` och `PLACE` i `js/weather.js`.

## Säkerhet

- All data skyddas av Row Level Security i databasen. Bara medlemmar i ett hushåll kan läsa och ändra dess data och bilder.
- Användartext sätts alltid med `textContent`. Länkar tillåts bara med `http:` och `https:`.
- Bilder ligger i den privata bucketen `item-images` och visas via signerade URL:er som gäller en begränsad tid.

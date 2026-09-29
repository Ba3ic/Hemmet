# Uppdrag: bygg "Hemmet", en delad hemapp (PWA) för två personer

Du är min utvecklare. Bygg en PWA för mig och min sambo som vi använder på iPhone och dator för att underlätta vardagen hemma. Allt ska synkas i realtid mellan oss via Supabase. All text i appen ska vara på svenska.

## Arbetssätt
1. Läs först `schema.sql` i projektmappen. Databasen är redan skapad i Supabase med exakt det schemat, och du ska inte ändra befintliga tabeller utan att fråga mig.
2. Skriv en kort plan och bygg sedan i etapperna nedan. Testa varje etapp lokalt (t.ex. `npx serve`) innan du går vidare, och gör en git-commit per etapp.
3. Fråga mig bara när något faktiskt blockerar (t.ex. mina nycklar). Gör annars rimliga val själv och berätta kort vad du valde.
4. Skriv en `README.md` på svenska med hur man kör lokalt och hur man hostar på GitHub Pages.

## Teknik
- Ren HTML, CSS och JavaScript (ES-moduler), utan byggsteg, så att mappen kan läggas direkt på GitHub Pages, Netlify eller Cloudflare Pages. En fil per flik i `js/`.
- Supabase via `@supabase/supabase-js` (ESM från CDN, t.ex. jsdelivr).
- Konfiguration i `js/config.js` med `SUPABASE_URL` och `SUPABASE_KEY` som platshållare. Jag fyller i dem själv. Använd bara publishable/anon-nyckeln. Använd aldrig `service_role` eller `sb_secret_`-nycklar i klientkoden.
- Säkerhet: bygg DOM med `textContent` eller escapa all användartext. Tillåt bara `http:` och `https:` i länkar. Datan skyddas av RLS i databasen, så lita inte på klienten.
- Sökvägar ska vara relativa, så att appen fungerar under en undermapp på GitHub Pages.

## Design
- **Mörkt tema som standard.** Ett ljust tema ska gå att välja i Inställningar (Mörk / Ljus / Följ systemet). Valet sparas i `localStorage` (i `try/catch`). Använd CSS-variabler, och sätt temat på `<html data-theme>` innan sidan ritas så att den inte blinkar.
- Snygg och lugn känsla, inte generisk. Förslag på mörk palett: bakgrund `#0e1413`, yta `#161f1d`, upphöjd yta `#1d2927`, linje `#2a3835`, text `#e7eeec`, dämpad text `#8fa19c`, primär accent teal `#4fb3a9`, sekundär accent varm korall `#e0876a`, negativt `#e5675b`, positivt `#5bbd8a`. Ta fram en väl avvägd ljus palett med samma karaktär.
- Mobil först. Flikrad längst ner (Idag, Kalender, Listor, Anteckningar, Utgifter) med ikoner i SVG och text, som tar hänsyn till `env(safe-area-inset-bottom)`. Alla tryckytor minst 44 px. Fungerar även fint på bred skärm, där innehållet får max ca 720 px bredd och centreras.
- Tydligt fokus för tangentbord, respektera `prefers-reduced-motion`, och håll animationer få och funktionella (t.ex. ett blad som glider upp när man lägger till något).
- Tomma lägen ska säga vad man kan göra ("Lägg till din första händelse"). Fel ska tala om vad som gick fel och hur man rättar det.
- Svenska format: `sv-SE`, veckan börjar på måndag, belopp som "1 234 kr", 24-timmarsklocka.

## Inloggning och hushåll
- Inloggning och registrering med e-post och lösenord (Supabase Auth).
- Om användaren saknar hushåll: visa två val, "Skapa hushåll" (anropar RPC `create_household(hname)`) eller "Gå med med kod" (RPC `join_household(code)`).
- Under Inställningar (kugghjul uppe till höger på Idag-fliken): visa hushållets inbjudningskod med kopieringsknapp, temaval och "Logga ut".

## Flikar

### 1. Idag (startsida, dashboard)
- Hälsning efter tid på dygnet och dagens datum.
- **Väder från SMHI för Bandhagen** (lat 59.27, lon 18.05): nuvarande temperatur, väderikon och beskrivning, nederbörd, samt en liten prognos för de närmaste timmarna och dagarna. Kontrollera SMHI:s aktuella öppna prognos-API i deras dokumentation innan du bygger (de har bytt version tidigare). Kontrollera att anropet fungerar direkt från webbläsaren (CORS). Om det inte gör det, föreslå en liten Supabase Edge Function som mellanlager. Cacha svaret i minnet några minuter och hantera fel snyggt.
- Dagens händelser från `events` och en kort lista över de kommande 7 dagarna.

### 2. Kalender
- Månadsvy med markerade dagar som har händelser, och en lista över vald dag under.
- Snabb "Ny händelse" som blad från botten: titel, datum, start- och sluttid, heldag, anteckning och **notisval** (Ingen, Vid start, 10 min innan, 1 timme innan, 1 dag innan) som sparas i `remind_minutes`. Redigera och ta bort händelser.

### 3. Listor
- Översikt över egna listor. Man skapar listor själv med valfritt namn (föreslå "Köplista" och "Hushållslista" som snabbval), och kan byta namn på och ta bort dem.
- Inne i en lista: poster med **namn, beskrivning, länk och skärmdump** (bild). Bocka av poster, "Rensa klara", redigera och ta bort.
- Bilder: välj eller ta en bild (`<input type="file" accept="image/*">`), förminska i klienten till max ca 1200 px, ladda upp till Supabase Storage-bucketen `item-images` på sökvägen `<household_id>/<uuid>.jpg` och spara sökvägen i `image_path`. Visa bilderna via signerade URL:er. Tryck på en miniatyr för att se den stor.

### 4. Anteckningar
- Fungerar som Anteckningar på iPhone: lista sorterad på senast ändrad med titel och en rad förhandsvisning, sökfält, "Ny anteckning", och en redigeringsvy med titel och fri text som autosparas (debounce) och uppdaterar `updated_at`. Ta bort med bekräftelse. Vid samtidig redigering vinner den senaste ändringen.

### 5. Utgifter
- Månadsväljare med pilar. Totalsumma för månaden överst, uppdelad i fasta och rörliga, med en stapel som visar proportionerna.
- **Fasta utgifter** (`fixed_expenses`) gäller alla månader och hänger alltid med. **Rörliga utgifter** (`variable_expenses`) hör till en månad (`month` = `YYYY-MM`) och fylls i för varje månad.
- Valfri inkomst per månad (`month_income`) och en rad med hur mycket som blir kvar.
- Lägg till, ändra belopp och ta bort direkt i listan.

## Realtid
Prenumerera med Supabase Realtime (`postgres_changes`) på alla tabeller, så att en ändring hos den ena syns direkt hos den andra. Ladda om den aktuella vyn vid ändring, utan att störa den som skriver just nu.

## PWA
- `manifest.webmanifest` (namn "Hemmet", `display: standalone`, teal tema), ikoner 192, 512 och `apple-touch-icon` 180 px (enkel husikon, generera själv), och rätt `<meta>`-taggar för iOS.
- Service worker som cachar appskalet och visar senast hämtade data när nätet saknas. Läsa offline räcker, och skriva offline behöver inte fungera i första versionen.

## Etapper
1. **Skal:** projektstruktur, teman, inloggning, hushåll, flikrad, inställningar, PWA-grunder.
2. **Utgifter och Listor** (inklusive bilder).
3. **Anteckningar och Kalender.**
4. **Idag-sidan** med SMHI-väder.
5. **Notiser för kalendern** (gör detta sist och fråga mig innan du börjar): Web Push med VAPID, en ny tabell `push_subscriptions` (skriv SQL-migrering för mig att köra), en Supabase Edge Function och `pg_cron` som skickar notis vid `starts_at - remind_minutes`. På iPhone fungerar det bara när appen är tillagd på hemskärmen (iOS 16.4 eller senare), och det ska framgå i appen.

## Klart när
- Två olika konton i samma hushåll ser samma data i realtid.
- Appen fungerar och ser bra ut på en smal mobilskärm och på dator, i både mörkt och ljust tema.
- Det går att lägga appen på iPhones hemskärm och öppna den som en egen app.
- README beskriver hur jag lägger ut den på GitHub Pages.

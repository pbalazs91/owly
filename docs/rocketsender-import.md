# RocketSender-válaszimport – első változat

Az integráció alapállapotban kikapcsolt. Az automatikus üzenetküldés és AI-válaszjavaslat ebben a modulban le van tiltva. A 0.4.0-s Owly-bővítmény a már használt WhatsApp Web-lapot figyeli, nem indít új WhatsApp-munkamenetet.

## Események

- Sikeres kiküldés: csak küldési nyilvántartás, ügyfél nélkül.
- Kézbesítés, elolvasás és kimenő értesítés: nincs ügyfélimport.
- Válasz: csak azonos WhatsApp-fiókból származó, az ügyfél eredeti válaszidejét megelőző megkeresésre importálható.
- Ismeretlen szám vagy eltérő fiók: alapból kihagyva. A bővítmény előbb csak a számot/fiókot/időpontot ellenőrizteti; ismeretlen szám üzenetszövegét nem tölti fel.
- Ugyanaz az esemény vagy külső üzenet: nincs új ügyfél vagy üzenet.

Az eredeti üzenetazonosító és időbélyeg megmarad. Az eredeti kiküldött szöveg akkor kerül a beszélgetésbe, ha a küldési napló tartalmazza. A teljes régi WhatsApp-előzmény és az automatikus AI-válasz nem része ennek az első változatnak.

## Kapcsolódás a RocketSenderhez

Ellenőrzött termék: https://rocketsender.co/ ; Chrome Web Store-azonosító: `hmpoalkkjnapmpfgleamekjhhfenpodc`.

A nyilvános termékleírás helyi Excel-eredményexportot dokumentál. Natív RocketSender-webhookot vagy kampányesemény-API-t nem igazoltunk. Ezért az első adapter a sikeres küldések kézzel megfeleltetett CSV/JSON-naplóját és a saját Owly-bővítmény által észlelt WhatsApp-választ kapcsolja össze. Egy tetszőleges kimenő WhatsApp-üzenetet nem címkéz automatikusan RocketSender-kampányküldésnek.

A sablon: `/rocketsender-sent-template.csv`. Kötelező soradat: `phone`, `status=sent`, `sentAt`. A fiók és kampány megadható a feltöltés űrlapján, vagy soronként az `accountId`, `campaignId` mezőkben. A `sourceMessageId` és `content` opcionális; külső üzenetazonosító hiányában külön, determinisztikus nyilvántartási azonosító készül. A feltöltés időpontja soha nem helyettesíti a tényleges küldés idejét. Legfeljebb 100 sor/128 kB tölthető fel egyszerre. Az ismételt feltöltés idempotens; egy részben sikertelen feltöltés javítás után újraküldhető.

## Adatok és konkurencia

A migráció hat új táblát hoz létre; meglévő felhasználót, beállítást és üzenetet nem módosít vagy töröl. Az Owly jelenleg egy szervezetet kezel telepítésenként: a szervezeti kulcs szerveroldali `default`, nem szabadon beküldhető tenantazonosító.

- Kontakt egyedisége: szervezet + normalizált nemzetközi telefonszám.
- Beszélgetés: szervezet + WhatsApp-fiók + telefon + forrás-beszélgetésazonosító.
- Üzenet: szervezet + fiók + forrás + külső üzenetazonosító.
- Esemény: szervezet + fiók + külső eseményazonosító.

Az adatbázis egyedi indexei és `Serializable` tranzakció védi a kontakt-, beszélgetés- és üzenetlétrehozást. Ütközéskor a teljes tranzakció újrapróbálkozik. Meglévő ügyfél egyeztetése normalizált teljes számmal történik; több egyező régi profil esetén nem készül találomra új profil. Az első egyeztetés legfeljebb 5000 régi telefonszámos ügyfelet olvas; nagyobb adatbázishoz előzetes normalizálási migráció kell.

Az esemény a feldolgozás előtt tartós adatbázissorba kerül. Öt sikertelen próbálkozás után hibasorba jut; a Settings → Integrations felület figyelmeztet és kézi újrapróbálást kínál. A megszakadt feldolgozás ötperces zárolása lejár. Újrapróbálást a nyitott bővítmény szívverése vagy az adminisztrátori feldolgozógomb indít. Alvó ingyenes Render vagy bezárt Chrome esetén a feldolgozás a következő elérésig vár; az adatbázisba még be nem érkezett, bezárt böngésző alatt keletkező üzenetek visszaolvasását ez a változat nem garantálja.

## Végpontok

- `POST /api/integrations/rocketsender/outbound`: sikeres küldési napló, Owly-adminhitelesítéssel.
- `POST /api/integrations/rocketsender/check`: jogosultságvizsgálat csak fiók/szám/időpont alapján.
- `POST /api/integrations/rocketsender/inbound`: válaszesemény fogadása, Owly-admin- vagy visszavonható, szerepkörhöz kötött Owly-bővítményhitelesítéssel.
- `GET/POST /api/integrations/rocketsender`: beállítások, napló, ellenőrzés, újrapróbálás.

Az integráció nem fogad be azonosítatlan nyilvános webhookot, és nem kezeli a RocketSender oldalát hiteles eseményküldőként.

## Ellenőrzések és próba

66 célzott teszt, TypeScript-ellenőrzés és teljes Next.js-build lefutott. A `scripts/verify-rocketsender-local.ts` külön memóriában futó PostgreSQL/PGlite-adatbázist készít, alkalmazza a valódi hozzáadó migrációt, megőrzi a korábbi próba-beállítást, majd ellenőrzi a kiküldés/válasz/ismételt válasz/duplikált esemény/időbélyeg eseteket. Eredménye `.local-test/result.json`. A PGlite többkapcsolatos burkolója nem helyettesíti a natív PostgreSQL terheléses vizsgálatát.

Helyi reprodukció: `npm install --prefix .local-test @electric-sql/pglite @electric-sql/pglite-socket --ignore-scripts`, majd `npx tsx scripts/verify-rocketsender-local.ts`. A próbafolyamat kizárólag saját, helyi, kitalált adatbázist hoz létre; nem használ meglévő éles adatbázis-URL-t.

Valódi próba: saját WhatsApp-fiók és külön teszttelefon beállítása → próba mód → RocketSender-küldés → sikeres küldés nyilvántartásba vétele → másik telefon válasza → Customers/Conversations ellenőrzése → duplikációpróba és emberi megerősítés. Az aktív mód addig nem menthető. A valódi RocketSender–WhatsApp-próba még nincs igazolva.

## Nyilvános céges névjavaslat

Az ügyfél adatlapján külön gomb keres a Wikidata nyilvános, vállalkozásként besorolt bejegyzéseinek telefonszámadataiban. Csak pontos számegyezés fogadható el; a névhez forráshivatkozás és külön emberi jóváhagyás tartozik. A javaslat aláírt, ügyfélhez és telefonszámhoz kötött, 15 percig érvényes; a név és a forrás együtt mentődik. Magánszemélyeket nem keres, belső beszélgetést nem küld a keresőnek, és nem talál ki tulajdonosnevet. Ez forrásalapú automatikus lekérdezés, nem LLM-alapú személyazonosítás. A Wikidata lefedettsége korlátozott, így a találat hiánya nem bizonyít semmit a szám tulajdonosáról.

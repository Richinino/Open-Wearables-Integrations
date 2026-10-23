# Android appka Zdravie: redizajn a viac dát

Dátum: 23. 10. 2026. Používateľ: „ten dizajn je hrozný, ukazuje veľmi málo dát… pripravme čo a ako tam, potom to hodíš do Claude Design na dizajn a nakoniec releasneme update“. Otázky vynechal („rovno začni a ty to navrhni“), preto sú všetky rozhodnutia nižšie moje, okrem tých, ktoré sú výslovne jeho (citované alebo z pamäti projektu).

## Prečo

Appka 0.1.x dostáva z `GET /api/data` celý dataset ako web: skóre, fázy spánku, strain, záťaž, zóny tepu, kalórie, tréningy s tepom a VO2max. `Payloads.kt` z neho vyberie len `DaySummary` s ôsmimi číslami a prehľad ich ukáže v štyroch generických Material kartách. Problém teda nie je v serveri, ale v klientovi.

Používateľ chce prémiový pokojný vzhľad „Nočný panel“ a „nechcem skoro nič rozklikávať“ (pamäť projektu, 13. 10.). Ráno chce vidieť pripravenosť, spánok a aktivitu. Večer chce strain dňa a potrebu spánku, ktoré sa mu „veľmi, veľmi“ páčia. Varovanie NightSignal chce vidieť samostatne. Telefón je miesto, kde sa na to pozerá najčastejšie.

## Ciele

1. Prvá obrazovka odpovie na rannú alebo večernú otázku bez ťuknutia a ďalšie podstatné čísla dňa sú o jedno posunutie nižšie.
2. Ukázať väčšinu toho, čo vie web (prehľad, spánok, aktivita, tep, pripravenosť, tréningy, kalendár, rekordy, dlhodobé), v mobilnom usporiadaní.
3. Rovnaké čísla ako web pre ten istý deň. Skóre počíta iba server. Priemery, rekordy, kalendár, súhrnné vety a postrehy, ktoré web dnes počíta v prehliadači, appka prevezme z web `lib/` s rovnakými pravidlami.
4. Vizuálne jednotné s webom A2 „Nočný panel so skóre“: rovnaké farebné tokeny, písma, tvary panelov, svetlý aj tmavý režim.
5. Vydať ako aktualizáciu cez existujúci updater (GitHub Releases), bez preinštalovania.

## Mimo tohto vydania

- Zber z Health Connect, widget na plochu, upozornenie NightSignal na pozadí, offline história. Navrhujem ako fázu 2; upozornenie má najväčšiu prioritu, lebo si ho používateľ výslovne želal.
- Zmeny výpočtov alebo API na serveri. Výnimka: endpointy z Balíka 1, ak budú nasadené (nižšie).
- Admin panel, zápis čísel zo Samsung Health a úprava profilu. Otvárajú sa na webe ako doteraz.

## Čo nesmie nastať (anti-ciele)

- Krikľavé farebné plochy alebo tabuľkový technický vzhľad. Oba smery používateľ odmietol ako „úplne hrozné koncepty“.
- Chýbajúci údaj zobrazený ako 0, odhad bez `≈` alebo približná Readiness bez označenia.
- Iné číslo než na webe pre ten istý deň a metriku.
- Vymyslené čísla alebo text v dizajne aj appke. Ak dáta chýbajú, ukáže sa konkrétny prázdny stav.
- Zhoršenie súčasných záruk: identita účtu, zmazanie dát po odhlásení alebo zmene účtu, heslo len v pamäti, zdravotné dáta nie na disku.

## Navigácia

Spodná lišta so štyrmi kartami: **Dnes · Spánok · Aktivita · Trendy**. Účet sa otvára cez kruh s iniciálami vpravo hore, ako na webe. Detail ľubovoľného dňa je obrazovka Dnes pre zvolený dátum. Otvorí sa z kalendára, histórie alebo šípkami v hlavičke.

## Obrazovky

### Dnes

- **Hlavička:** dátum (napr. „Štvrtok 23. októbra“). Šípky ‹ › prepínajú deň, dopredu najviac po dnešok. Stav dát: bodka a „pred 7 min“, pri starších dátach varovná farba. Kruh účtu.
- **Režim:** ako na webe, `resolveMode`: od 15:00 do 04:00 večer, inak ráno. Prepínač „Ráno | Večer“ režim ručne prebije. Nastavenie účtu `overview_mode` sa rešpektuje rovnako ako na webe.
- **Pruh NightSignal** (iba žltá alebo červená), text z `nightSignalAlert`. Pri ostatných dňoch sa nezobrazuje.
- **Hlavný blok ráno:** kruh Skóre dňa (`day_score`, štítok z `dayScoreLabel`) a pod ním tri riadky s pruhom: Pripravenosť ≈, Spánok (preferované skóre účtu), Aktivita. Ku každému krátke „prečo“ zo `subScores`. Súhrnná veta z `morningSummary`.
- **Hlavný blok večer:** Strain dňa 0–21 ako kruh, Potreba spánku na dnešnú noc (h min), odporúčaný čas zaspávania (`bedtimeFor` + `typicalWake`) a veta z `eveningSummary`.
- **Čo sa zmenilo:** 1–3 postrehy. Zdroj: Balík 1 `/api/insights?day=` ak odpovedá, inak webové `insights()` z `overview.ts` (bez `restingTrend`, ako na webe). Pri postrehu malý pruhový graf a podklad („z 18 nocí za 28 dní“).
- **Spánok:** celkový čas, čas zaspania → prebudenia, pás fáz z `sleep_timeline` a štyri fázy s minútami (hlboký, REM, ľahký, bdenie). Skóre podľa preferencie. Ťuknutie otvorí kartu Spánok pre túto noc.
- **Aktivita:** kroky veľkým číslom s kruhom oproti 30-dňovému priemeru. Aktívny čas, kalórie (aktívne/spolu) a vzdialenosť, každé so 7-dňovými stĺpikmi ako mini dlaždice A2. Zóny tepu dňa ako trojdielny pás.
- **Srdce:** pokojový tep so zdrojom a 30-dňovou krivkou, HRV (RMSSD/SDNN podľa `hrv_kind`), nočný tep oproti základu z `night_signal`.
- **Záťaž:** stav kardio záťaže (`cardio_load.status`, pomer 7 d / 28 d) a VO2max.
- **Tréningy dňa:** typ, čas, trvanie, priemerný/max tep, pás zón, strain, vzdialenosť, kcal.
- **Môj deň:** iba ak odpovedá Balík 1 `/api/journal`. Štyri hodnotenia 1–5 a značky, uloženie jedným tlačidlom, revízie podľa kontraktu (`docs/balik-1-api.md`). Bez API sa blok nezobrazí.
- **Neuzavretý deň:** štítok „Priebežné údaje · deň ešte nie je uzavretý“. Ak dnešok ešte nemá dáta, prehľad ukáže posledný deň s dátami a povie, aký je starý (`latestDay`, ako web).

### Spánok

- Prepínač noci ‹ dátum ›.
- Veľký hypnogram: štyri dráhy (bdenie, REM, ľahký, hlboký) s časovou osou, ako webový `hypnogram.tsx`.
- Čísla: spánok spolu, v posteli, bdenie, zdriemnutie (`nap_minutes`), podiel fáz v %.
- Skóre noci: preferované veľkým písmom, ostatné dve malým. Možnosti sú Samsung Sleep ≈ (aj stav „učí sa“), Apple Sleep so zložkami a Sleep Performance oproti potrebe.
- Potreba oproti skutočnosti: 14 nocí ako stĺpce, čiara potreby z `sleep_need_minutes` predošlého dňa.
- Pravidelnosť: SRI za 14 dní a priemerné zaspávanie a vstávanie s rozptylom (`sleepWindow`), napr. „Zaspávaš okolo 23:24, vstávaš 06:58 · ± 26 min“.

### Aktivita

- Prepínač dňa.
- Kroky dňa s 30-dňovou krivkou a priemerom, zdroj krokov.
- Strain dňa so stĺpcami za 14 dní.
- Stav záťaže: 7-dňový strain oproti 28-dňovej tolerancii za posledných 8 týždňov a slovný stav (`cardioStatusLabel`).
- Zóny tepu dňa.
- Tréningy · 30 dní: zoznam. Ťuknutie otvorí spodný panel s detailom (zóny, tep min/priem/max, strain, kcal, vzdialenosť, pri behu tempo).

### Trendy

- Výber metriky (čipy): Kroky, Spánok, Skóre dňa, Pripravenosť, Strain, Pokojový tep, HRV, Aktívny čas, Kalórie, VO2max.
- Rozsah: 7 / 30 / 90 / 365 dní.
- Veľké číslo je priemer za rozsah a zmena oproti predošlému rovnako dlhému obdobiu. Graf denných hodnôt s čiarou priemeru, medzera znamená chýbajúci deň.
- Týždeň v skratke: sedem kariet ako na webe (`weekCards`), vodorovne posúvateľné.
- Kalendár 12 týždňov pre kroky, spánok, aktívny čas a pokojový tep (`heatmap`). Ťuknutie na deň otvorí Dnes pre ten dátum.
- Rekordy · 90 dní (`records`).
- Dlhodobé: VO2max a vek tela (`whoop_age`) s trendom.

### Účet

Meno, e-mail a stav účtu. Vzhľad: Systém / Tmavý / Svetlý (z účtu, ako doteraz). Preferované skóre spánku. Aktualizácie: verzia a „Skontrolovať aktualizácie“ (existujúce). Odkazy na web: Nastavenia účtu, Zápis zo Samsung Health a Admin panel (iba admin). Odhlásiť.

### Prihlásenie a čakanie na spárovanie

Rovnaké správanie ako dnes, nový vzhľad.

## Dáta

- **Zdroj:** ďalej len `GET /api/data` s overením identity. Parser (`Payloads.kt`) sa rozšíri na celý `Day` podľa `web/src/lib/types.ts`: skóre so zložkami a poznámkami, `sleep_timeline`, zóny, kalórie, tréningy so všetkými poliami, `samsung_auto` a hlavičky datasetu (`latest_measurement_at`, `first_day`, `last_day`). Neznáme polia ignoruje, chýbajúce sú `null`, chybný typ zahodí iba dotknutú hodnotu, nie celý deň.
- **Výpočty v appke:** iba to, čo web robí v prehliadači (`metrics.ts`, `overview.ts`, `scores.ts`, `latest-day.ts`, `dates.ts`, `format.ts`). Prenesie sa do Kotlinu 1:1 a overí rovnakými prípadmi ako webové testy. Ak sa logika líši, platí web.
- **Balík 1** (insights, journal) je zatiaľ len lokálne na notebooku. Appka zistí jeho dostupnosť pri prvom volaní. Pri 404 alebo 501 bloky skryje a postrehy berie z webovej logiky. Po nasadení Balíka 1 sa bloky objavia bez nového vydania.
- **Súkromie:** zdravotné dáta len v pamäti, ako v 0.1.x.

## Vizuál (pre Claude Design aj implementáciu)

Presne tokeny A2 z artboardu `NocnyPanel2.dc.html`:

| Token | Tmavý | Svetlý |
|---|---|---|
| bg | `#08090c` | `#eef0f3` |
| glass (panel) | `rgba(22,24,30,0.66)` | `rgba(255,255,255,0.74)` |
| ink / ink2 / muted | `#f2f1ed` / `#a9a9a4` / `#8b8b86` | `#14161a` / `#565962` / `#6b6e77` |
| line / track | `rgba(255,255,255,0.09)` / `0.08` | `rgba(18,24,38,0.10)` / `0.09` |
| accent | `#e9b44c` | accent zmiešaný 70 % s `#4a3200` |
| sleep / heart / good | `#8f8cf2` / `#f0718f` / `#5fd08a` | `#5b57d6` / `#d6456b` / `#178f4d` |
| deep / rem / light | `#5b57d6` / `#4fc7b8` / `#a9a6f7` | `#2f2c9a` / `#1f9c8d` / `#9a97ee` |

- **Písma:** Urbanist (300–700) na text a čísla, DM Mono na malé štítky a časy. Obe sú OFL, pribalia sa do appky.
- **Čísla:** veľké tenké (300), tesné preloženie (−0,03 až −0,05 em).
- **Štítky sekcií:** DM Mono 11, verzálky, rozpätie 0,1 em, farba ink2.
- **Panely:** sklo s 1 px okrajom `line`, zaoblenie 28 (veľké) alebo 24 (mini). Pozadie má dve jemné radiálne žiary (accent vľavo hore, sleep vpravo) s nízkou opacitou.
- **Grafy:** kreslené natívne (Compose Canvas). Stĺpce majú zvýraznenú poslednú hodnotu a zvyšok farbou `track`, ako mini dlaždice A2.
- **Ovládanie:** dotykové plochy ≥ 48 dp, kontrast textu ≥ 4,5 : 1. Rozloženie od okraja po okraj so systémovými lištami podľa témy.

## Postup

1. **Claude Design:** nová stránka „Android“ na existujúcom plátne „Zdravie – nový dizajn“, kde je webový A2. Artboardy 390 px široké, na výšku celého posúvania: Dnes ráno, Dnes večer, Spánok, Aktivita, Trendy, Účet, Prihlásenie. Čísla v návrhu sú syntetické a zjavne ukážkové. Používateľ ich vidí, môže komentovať a upravovať priamo na plátne.
2. **Implementácia** podľa schváleného dizajnu: parser, prenos webovej logiky s testami, téma a písma, obrazovky, testy obrazoviek so syntetickými dátami a náhľady.
3. **Vydanie:** `version.properties` → `0.2.0` s vyšším `versionCode`, nové `RELEASE_NOTES.md`, push na produkčnú vetvu spustí podpísaný release workflow. Appka 0.1.1 ponúkne aktualizáciu sama.

## Overenie

- JVM testy parsera (celý `Day`, chybné a chýbajúce polia) a prenesenej logiky. Rovnaké vstupy dajú rovnaké výsledky ako webové testy.
- Compose UI testy kľúčových stavov: ráno, večer, NightSignal, chýbajúce dáta, neuzavretý deň, bez Balíka 1, svetlý a tmavý režim.
- Náhľady obrazoviek so syntetickými dátami porovnať s dizajnom.
- Android lint bez nových chýb. Release workflow overí podpis aj verziu.
- Na telefóne: aktualizácia z 0.1.1 cez appku, prihlásenie ostane zachované, čísla dňa sedia s webom.

## Nechané na staviteľa

Rozdelenie do Compose komponentov, animácie, presná podoba grafov v rámci tokenov, poradie implementácie a dostupnosť vrátane popisov grafov.

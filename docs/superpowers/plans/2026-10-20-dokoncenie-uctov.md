# Dokončenie používateľských účtov

Nadväzuje na [návrh](../specs/2026-10-18-viac-pouzivatelov-design.md) a [pôvodný plán](2026-10-18-viac-pouzivatelov.md). Implementácia od 20. 10. 2026 prebieha vo vetve `codex/accounts`, oddelene od bežiacej inštancie. Používateľ schválil pokračovanie a použitie existujúceho e-mailu Open Wearables pre hlavného administrátora.

## Východiskový stav

- [x] Pôvodné úlohy 1–6: účty, priečinky, viacužívateľský sync, API účtov/admina, inbox a namerané hodnoty pred odhadmi.
- [x] Čistý základ overený: 828 Python testov a 472 webových testov.
- [x] Izolovaný worktree a rozdelenie vlastníctva súborov medzi backend, autentifikáciu, admin UI a integráciu.

## Úlohy a kritériá dokončenia

- [x] **A. Zdroje a výpočty:** Apple Health/Suunto, zlučovanie spánku a tréningov, žiadne falošné nuly pri chýbajúcom tepe. HRV prechádza uložením a spätným prepočtom; RMSSD a SDNN majú oddelenú históriu. Bez použiteľnej histórie sa správanie nemení.
- [x] **B. Zavedenie administrátora:** CLI bezpečne vytvorí aktívneho administrátora a jednorazový odkaz na prvé heslo. Odmietne konflikt e-mailu a spárovaného používateľa. Zoznam účtov nezverejňuje heslá ani tokeny.
- [x] **C. Prihlásenie:** registrácia, čakanie na spárovanie, obnova hesla a prihlásenie e-mailom. Relácia 12 hodín alebo 30 dní, overenie aktuálneho stavu a verzie účtu pri každej požiadavke. Zachovať spoločné obmedzenie pokusov a serverové tokeny.
- [x] **D. Profil a nastavenia:** mená, e-mail, dátum narodenia, pohlavie, súhlas s dolaďovaním, heslo, odhlásenie zo všetkých zariadení a potvrdené zmazanie. Téma, predvolené skóre spánku a režim prehľadu sa ukladajú pri účte.
- [x] **E. Admin panel:** inbox, párovanie, zdroje a príchod dát, roly/stavy, reset hesla, registrácie a stav systému. Prezeranie iného účtu má výrazný pruh a je len na čítanie na klientovi aj serveri.
- [x] **F. Zobrazenie a izolácia:** účet určuje server, nie parameter z prehliadača. Cache dát je oddelená podľa účtu; pri prepnutí sa neponechajú cudzie dáta. Prednosť údajov zo zariadenia platí aj v kartách a grafoch. Skryť Samsung zápisy pre ostatné zdroje a počas prezerania.
- [x] **G. Integračné overenie:** oddelené syntetické účty, zmena hesla/pozastavenie so starou reláciou, podvrhnuté ID, zápisy v režime prezerania, obnova hesla, chybné párovanie. Kontrola mobilu a desktopu, svetlý/tmavý režim. Kompletné testy, lint, TypeScript a produkčný build.
- [ ] **H. Prechod:** konzistentná lokálna záloha, skúšobná migrácia kópie dát a porovnanie výsledkov. Až s overeným kandidátom a dostupným nasadením koordinovane prepnúť backend aj web. Overiť existujúce dáta a prvé prihlásenie administrátora; zachovať možnosť návratu.

## Upresnenia oproti starému plánu

- Súčasný Waitress, limity požiadaviek, atomické ukladanie a ochrana loginu zostávajú zachované. Identifikátor klienta je HMAC z dôveryhodnej platformovej hlavičky; surová IP ani ľubovoľné `x-forwarded-for` sa nepovažujú za dôveryhodné.
- Readiness ostáva približným modelom aj s meraným HRV. Zobrazenie uvedie dostupnosť HRV a nikdy ho nebude vydávať za oficiálne skóre výrobcu.
- Na vývoj a vizuálnu kontrolu sa používajú syntetické účty. Samostatný náhľad bez prihlásenia sa nezavádza; na kontrolu slúžia skutočné relácie syntetických účtov.
- Skutočné účty, e-maily, odkazy na nové heslo, zdravotné dáta a lokálne konfigurácie nepatria do Git histórie.


## Overenie 21. 10. 2026

- Finálny kód `6354668`: 925 Python testov, 580 webových testov, ESLint a produkčný Next build vrátane TypeScriptu prešli. Samostatný HTTP scenár prešiel 34 kontrolami.
- Úlohové review a záverečné review sú uzavreté. Opravené sú aj prepínanie identity medzi kartami, profil v ponechanom layoute, odvolanie relácií pri zmene párovania, rešpektovanie vypnutého dolaďovania a agregácia samotnej nameranej vzdialenosti.
- Prehliadač: mobil 390 px, desktop, svetlý/tmavý režim, admin prezeranie a návrat, nameraný pokojový tep aj profil po zmene účtu v druhej karte. Pri čerstvom profile iného účtu sa obnoví aj identita celej stránky.
- Lokálna záloha `snapshot-20261021-082407` má overenú obnovu PostgreSQL. Skúšobná migrácia zachovala 115 dní, štyri pôvodné súbory boli pred upgrade schémy totožné; opakovanie nič neprepísalo. Docker kandidát načítal presunuté dáta ako neprivilegovaný používateľ.
- Živá migrácia zachovala 115 dní a pôvodné súbory. Hlavný admin používa existujúci e-mail z Open Wearables a explicitne pripnuté ID majiteľa. Backend `6354668-e851dad4fdbf` prešiel pripravenosťou, API účtu, prístupom k pôvodným dňom a odmietnutím implicitného spoločného datasetu.
- Dokončenie H zahŕňa ešte potvrdenie prvého prihlásenia majiteľom po samostatnom nastavení hesla. Heslo za majiteľa nenastavuje agent. Obnovovacia kópia dát a pôvodný image zostávajú lokálne zachované.

Skutočné dáta Apple Health/Suunto ďalších ľudí sa overia až po ich pripojení. Readiness s HRV zostáva aproximáciou. E-mailové doručovanie odkazov, audit prístupov a vytváranie zariadení v tomto rozšírení nie sú zahrnuté.


Produkčný web bol 21. 10. 2026 prepnutý na overený kandidát. Prihlásenie e-mailom, registrácia a obnova hesla sú dostupné na pôvodnej doméne. Kontrolný pokus s neexistujúcim syntetickým účtom skončil očakávaným odmietnutím prihlasovacích údajov, čím sa overilo aj spojenie Vercelu s novým backendom. Prvý sync po migrácii prešiel o 08:45 miestneho času. Oba Funnel ciele vracajú cez verejný ingress HTTPS 200; súkromné spojenie notebooku na vlastnú Tailscale adresu je pri aktuálnom VPN nastavení nedostupné. NordVPN zostala podľa želania majiteľa zapnutá.

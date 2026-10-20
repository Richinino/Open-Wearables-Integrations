# Dokončenie používateľských účtov

Nadväzuje na [návrh](../specs/2026-10-18-viac-pouzivatelov-design.md) a [pôvodný plán](2026-10-18-viac-pouzivatelov.md). Implementácia od 20. 10. 2026 prebieha vo vetve `codex/accounts`, oddelene od bežiacej inštancie. Používateľ schválil pokračovanie a použitie existujúceho e-mailu Open Wearables pre hlavného administrátora.

## Východiskový stav

- [x] Pôvodné úlohy 1–6: účty, priečinky, viacužívateľský sync, API účtov/admina, inbox a namerané hodnoty pred odhadmi.
- [x] Čistý základ overený: 828 Python testov a 472 webových testov.
- [x] Izolovaný worktree a rozdelenie vlastníctva súborov medzi backend, autentifikáciu, admin UI a integráciu.

## Úlohy a kritériá dokončenia

- [ ] **A. Zdroje a výpočty:** Apple Health/Suunto, zlučovanie spánku a tréningov, žiadne falošné nuly pri chýbajúcom tepe. HRV prechádza uložením a spätným prepočtom; RMSSD a SDNN majú oddelenú históriu. Bez použiteľnej histórie sa správanie nemení.
- [ ] **B. Zavedenie administrátora:** CLI bezpečne vytvorí aktívneho administrátora a jednorazový odkaz na prvé heslo. Odmietne konflikt e-mailu a spárovaného používateľa. Zoznam účtov nezverejňuje heslá ani tokeny.
- [ ] **C. Prihlásenie:** registrácia, čakanie na spárovanie, obnova hesla a prihlásenie e-mailom. Relácia 12 hodín alebo 30 dní, overenie aktuálneho stavu a verzie účtu pri každej požiadavke. Zachovať spoločné obmedzenie pokusov a serverové tokeny.
- [ ] **D. Profil a nastavenia:** mená, e-mail, dátum narodenia, pohlavie, súhlas s dolaďovaním, heslo, odhlásenie zo všetkých zariadení a potvrdené zmazanie. Téma, predvolené skóre spánku a režim prehľadu sa ukladajú pri účte.
- [ ] **E. Admin panel:** inbox, párovanie, zdroje a príchod dát, roly/stavy, reset hesla, registrácie a stav systému. Prezeranie iného účtu má výrazný pruh a je len na čítanie na klientovi aj serveri.
- [ ] **F. Zobrazenie a izolácia:** účet určuje server, nie parameter z prehliadača. Cache dát je oddelená podľa účtu; pri prepnutí sa neponechajú cudzie dáta. Prednosť údajov zo zariadenia platí aj v kartách a grafoch. Skryť Samsung zápisy pre ostatné zdroje a počas prezerania.
- [ ] **G. Integračné overenie:** oddelené syntetické účty, zmena hesla/pozastavenie so starou reláciou, podvrhnuté ID, zápisy v režime prezerania, obnova hesla, chybné párovanie. Kontrola mobilu a desktopu, svetlý/tmavý režim. Kompletné testy, lint, TypeScript a produkčný build.
- [ ] **H. Prechod:** konzistentná lokálna záloha, skúšobná migrácia kópie dát a porovnanie výsledkov. Až s overeným kandidátom a dostupným nasadením koordinovane prepnúť backend aj web. Overiť existujúce dáta a prvé prihlásenie administrátora; zachovať možnosť návratu.

## Upresnenia oproti starému plánu

- Súčasný Waitress, limity požiadaviek, atomické ukladanie a ochrana loginu zostávajú zachované. Identifikátor klienta je HMAC z dôveryhodnej platformovej hlavičky; surová IP ani ľubovoľné `x-forwarded-for` sa nepovažujú za dôveryhodné.
- Readiness ostáva približným modelom aj s meraným HRV. Zobrazenie uvedie dostupnosť HRV a nikdy ho nebude vydávať za oficiálne skóre výrobcu.
- Na vývoj a vizuálnu kontrolu sa používajú syntetické účty. Prípadný lokálny náhľad musí mať výslovné zapnutie a kontrolu loopback rozhrania; produkčnú autentifikáciu neobchádza.
- Skutočné účty, e-maily, odkazy na nové heslo, zdravotné dáta a lokálne konfigurácie nepatria do Git histórie.

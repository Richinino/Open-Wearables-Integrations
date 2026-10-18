# Viac používateľov na webe Zdravie – návrh

Dátum: 2026-10-18. Stav: na schválenie (otázky kontrolóra zodpovedané). Súvisí: [`2026-10-13-web-design.md`](2026-10-13-web-design.md), [`2026-10-16-zapisy-a-doladovanie-design.md`](2026-10-16-zapisy-a-doladovanie-design.md), [`docs/ako-to-funguje.md`](../../ako-to-funguje.md).

## Prečo

Web dnes slúži jednému človeku (Richard): jedno spoločné heslo `SITE_PASSWORD`, `owi` počíta pre jedného používateľa Open Wearables (`OWI_USER_ID`) a `owi serve` vracia jeden dataset. Richard chce, aby web používali aj rodičia a neskôr kamaráti: každý pod vlastným menom a heslom a každý vidí len svoje dáta. Richard je admin. Keď niekto nahlási, že mu niečo zle ukazuje, Richard (a Claude na jeho pokyn, s ich súhlasom) si otvorí jeho stránku a porovná ju s Open Wearables bez posielania screenshotov.

Prví ďalší používatelia: **otec** (telefón Samsung, hodinky Suunto) a **mama Andrea** (iPhone, Apple Watch).

## Ciele

1. Vlastné účty: registrácia a prihlásenie e-mailom a heslom, „Zostať prihlásený“, zabudnuté heslo.
2. Nový účet je bez dát, kým ho admin nespáruje s používateľom v Open Wearables.
3. Každý vidí len svoje dáta: prehľad, kalendár, detaily, zápisy aj dolaďovanie sú per používateľ.
4. Admin panel: inbox upozornení, zoznam účtov s detailmi a akciami, prezeranie stránky iného používateľa, stav systému.
5. Ikonka účtu vpravo hore s menu a nastavenia účtu.
6. `owi` počíta pre všetkých spárovaných používateľov, aj pre iné zdroje než Samsung (Apple Health, Suunto).

## Mimo rozsahu

- Úprava rozloženia prehľadu (customizácia dashboardu) – samostatný projekt neskôr.
- Klub a cudzí ľudia: návrh s nimi nepočíta (žiadne podmienky použitia, verejná registrácia pre neznámych).
- Záznam prístupov (kto prezeral čí účet) – Richard ho nechce.
- Súhlas pri registrácii – Richard to ľuďom povie osobne.
- Zakladanie používateľov a pripájanie zariadení v Open Wearables – robí Richard ručne v dashboarde OW (`localhost:3000`), web to nerobí.
- E-mailové služby (pozri Zabudnuté heslo).

## Čo by bolo zlyhanie, aj keby to technicky fungovalo

- Ktokoľvek uvidí cudzie dáta bez toho, aby bol admin, alebo admin uvidí heslo.
- Pri prezeraní cudzieho účtu sa dá zameniť, čie dáta vidím, alebo sa omylom zapíše niečo do cudzieho účtu.
- Richardove doterajšie dáta, skóre, zápisy a doladené čísla sa stratia alebo pokazia pri prechode.
- Zdravotné dáta, heslá alebo e-maily sa dostanú do gitu alebo do prehliadača iného používateľa.

## Rozhodnutia používateľa (Richard)

**Prihlásenie a registrácia** (náčrt schválený; finálny vzhľad v štýle Nočného panela, ako celý web):
- Prihlásenie: e-mail, heslo, zaškrtávacie **Zostať prihlásený**, odkazy **Zaregistruj sa** a **Zabudnuté heslo**.
- Registrácia: meno, priezvisko **(nepovinné)**, e-mail, heslo a heslo znova (musia sa zhodovať).
- Po registrácii obrazovka „Účet je vytvorený. Čaká sa na spárovanie účtu“ bez dát a s možnosťou odhlásiť sa.

**Vpravo hore:** prepínač svetlý/tmavý režim a namiesto „Odhlásiť“ **ikonka účtu** (panáčik, môže byť s menom). Menu: Nastavenia účtu, Nastavenia, Prepnúť účet, Odhlásiť sa; pre admina navyše **Admin panel**.

**Admin panel:**
- **Inbox** dôležitých udalostí: niekto čaká na spárovanie, niekto nemá nové dáta dlho, odpojený zdroj, výpadok Funnelu (a oprava), nová verzia Open Wearables, žiadosť o nové heslo.
- **Zoznam účtov.** Pri každom: spárovať / zrušiť spárovanie s Open Wearables, **Zobraziť jeho stránku**, poslať odkaz na nové heslo, zmeniť rolu, pozastaviť alebo zmazať účet, kedy sa naposledy prihlásil a kedy mu prišli dáta, **z čoho mu chodia dáta** (zdroje a zariadenia, spôsob, zoznam typov dát, ktoré chodia a ktoré nie; bez čísel).
- **Stav systému:** či beží Open Wearables, Funnel, owi, kedy bol posledný prepočet.
- Heslo nikto okrem majiteľa nepozná ani nevidí.

**Prezeranie cudzieho účtu:** admin klikne „Zobraziť jeho stránku“ a vidí celý web (prehľad, kalendár, detaily) s dátami toho človeka, presne ako ich vidí on. Stále je prihlásený sám za seba, nie pod ním.

**Nastavenia účtu:** meno, priezvisko, e-mail, zmena hesla, dátum narodenia a pohlavie (pre vzorce), odhlásenie zo všetkých zariadení, zmazanie účtu, a prepínač **„Súhlasím s trénovaním na mojich údajoch“** – predvolene zapnutý, dá sa vypnúť.

**Claude ako admin:** Claude smie otvoriť cudzí účet len vtedy, keď ho o to Richard požiada; Richard tým potvrdzuje, že má súhlas toho človeka.

**Čísla z hodiniek majú prednosť (odpoveď na otázku kontrolóra):** kde zariadenie samo zmeria hodnotu (kroky, vzdialenosť, aktívne a celkové kalórie, pokojový tep, HRV), web ukáže ju; owi dopočíta len to, čo neprišlo, a len to označí ≈.

**Registrácia je zatiaľ otvorená:** web ešte nemá každý a kto sa zaregistruje, dá Richardovi vedieť, že čaká.

**Rodičia ešte nie sú v Open Wearables:** podpora Apple Health a Suunto sa postaví podľa dokumentácie Open Wearables a syntetických dát; po ich pripojení nasleduje kontrola a oprava na skutočných dátach (s ich súhlasom, na Richardov pokyn).

## Ako sa to postaví (rozhodnutia Claude; Richard ich nekomentoval)

### Kde sú účty
- **Účty sú doma v owi**, v novej SQLite databáze `data/accounts.db` (mimo gitu), nie v cloudovej službe. Dôvod: všetko citlivé ostáva doma ako doteraz, žiadna nová služba ani poplatok. Dôsledok: keď je notebook vypnutý, nedá sa ani prihlásiť – dáta by aj tak neboli dostupné.
- Tabuľka účtov: id, e-mail (jedinečný, malými písmenami), meno, priezvisko, rola (`admin` | `user`), stav (`pending` | `active` | `suspended`), `ow_user_id` (spárovanie, jedinečné), dátum narodenia, pohlavie, súhlas s trénovaním (bool, predvolene true), hash hesla, čas registrácie, posledné prihlásenie, `session_version` (zvýši sa pri zmene hesla a „odhlásení všade“).
- Heslá: **scrypt** zo štandardnej knižnice Pythonu (soľ na účet, parametre uložené pri hashi). Minimálne 10 znakov. Heslo nikdy neopustí server webu v inej podobe než v tele požiadavky na owi a nikde sa neloguje.
- `owi serve` dostane endpointy pre účty volané **len serverom webu** so zapisovacím tokenom (rovnaký princíp ako zápisy). Prehliadač s owi nehovorí nikdy.

### Prihlásenie a relácia
- Web overí heslo cez owi a vydá podpísané cookie (existujúci `SESSION_SECRET`) s id účtu, rolou, `session_version` a prípadne „prezerám účet X“. Bez „Zostať prihlásený“ cookie platí do zatvorenia prehliadača (najviac 12 h), so zaškrtnutím 30 dní.
- Pri každej požiadavke na dáta server webu overí v owi, že účet je aktívny a `session_version` sedí (zmena hesla alebo pozastavenie odhlási hneď).
- Obmedzenie pokusov: po 5 zlých heslách na e-mail 15 minút pauza (počíta owi).
- Doterajšie `SITE_PASSWORD` sa zruší. Pri prechode sa vytvorí Richardov účet ako admin, spáruje sa s jeho doterajším `OWI_USER_ID` a heslo si nastaví cez jednorazový odkaz z príkazu `owi accounts create-admin`.

### Zabudnuté heslo bez e-mailu
- Web nebude posielať e-maily (bez vlastnej domény by doručovanie nebolo spoľahlivé). „Zabudnuté heslo“ vytvorí v inboxe admina žiadosť „Andrea žiada nové heslo“; admin klikne „Poslať odkaz na nové heslo“, dostane **jednorazový odkaz** (platný 24 h) a pošle ho človeku sám, napr. cez WhatsApp. Ten istý odkaz vie admin vytvoriť kedykoľvek z detailu účtu. Neskôr sa dá doplniť e-mail.

### Prezeranie cudzieho účtu
- Relácia admina nesie „prezerám účet X“; všetky dátové požiadavky webu sa vtedy pýtajú na dáta X. Navrchu každej stránky je výrazný pruh „Prezeráš účet Andrea · Späť na môj účet“.
- Počas prezerania je web **len na čítanie**: zápis zo Samsungu, nastavenia a akcie sa nedajú (tlačidlá skryté, server to odmietne). Admin môže upravovať cudzí účet len cez admin panel.
- „Prepnúť účet“ v menu je pre admina skratka na rovnaké prezeranie (zoznam aktívnych účtov). Bežný používateľ túto položku nevidí.

### owi pre viac používateľov
- **Každý spárovaný používateľ má vlastný priečinok** `data/users/<ow_user_id>/` s vlastným `owi.db`, `params.json`, `score_weights.json` a `zapisy/zapisy.db`. Existujúca logika ostáva per priečinok; `owi sync` v slučke prejde všetkých spárovaných aktívnych používateľov.
- Prechod Richardových dát: súčasné `data/owi.db`, `params.json`, `score_weights.json` a `data/zapisy/` sa presunú do jeho priečinka bez zmeny obsahu (najprv záloha celého `data/`).
- Profil pre vzorce (vek z dátumu narodenia, pohlavie) sa berie z účtu; `.env` `OWI_AGE`/`OWI_SEX` ostanú len ako záloha pre Richarda.
- `owi serve`: `/v1/days` dostane používateľa z požiadavky (server webu posiela id účtu, owi si nájde `ow_user_id`); bez spárovania 404 „pending“.
- **Súhlas s trénovaním vypnutý:** owi pre toho používateľa nedolaďuje (používa predvolené čísla vo vzorcoch) a jeho dáta sa nepoužijú na zlepšovanie vzorcov pre iných. Jeho skóre a zobrazenie fungujú ďalej.
- **Spoločné učenie naprieč používateľmi teraz nie je** (rozhodnutie Claude): dolaďovanie ostáva per používateľ a nový používateľ začína z predvolených čísel, nie z Richardových. Prepínač súhlasu ho vylúči aj zo spoločného učenia, keby sa neskôr pridalo.
- **Zmazanie, zrušenie spárovania** (rozhodnutie Claude): zrušenie spárovania priečinok ponechá (patrí používateľovi Open Wearables) a účet prejde do stavu „čaká na spárovanie“. Zmazanie účtu zmaže účet aj priečinok owi toho používateľa (zápisy, doladené čísla, vypočítané dni); surové dáta ostávajú v Open Wearables a ak ich treba zmazať, urobí to Richard tam. Pred zmazaním web vypýta potvrdenie. Posledný admin nemôže zmazať, pozastaviť ani znížiť rolu sám sebe.

### Iné zdroje než Samsung
- Dnes má owi pravidlá pre Samsung a Health Connect (výber krokov, zlučovanie spánku a tréningov, automatické zápisy zo Samsungu). Pre Apple Health (iOS appka Open Wearables) a Suunto (cloudové pripojenie v OW) sa pravidlá zovšeobecnia: zdroje sa zoradia podľa priorít z Open Wearables, Samsung-špecifické pravidlá platia len pre Samsung zdroje, automatické zápisy zo Samsungu len pre používateľov so Samsung zdrojom.
- **Namerané pred odhadom:** pre každý deň owi najprv vezme hodnotu, ktorú zariadenie poslalo (kroky, vzdialenosť, aktívne a celkové kalórie, pokojový tep, HRV), a vlastný odhad z tepu použije len tam, kde chýba. API pri každej takej hodnote povie, či je nameraná alebo odhadnutá, a web dá ≈ len k odhadom. Pre Richarda sa nič nemení tam, kde Samsung hodnotu neposiela.
- **HRV v Readiness:** keď používateľ má HRV (Apple Watch), Readiness použije aj zložku HRV podľa Oura (odchýlka od osobného priemeru) a prestane byť „odhad bez HRV“; bez HRV ostáva ako dnes.
- Ak Suunto neposiela minútový tep, owi nepočíta zóny, strain ani Activity z tepu pre tie dni a ukáže len to, čo prišlo (žiadne nuly).
- Formulár zápisov je pre Samsung. Stránka Zápis sa v menu zobrazí, keď má používateľ akýkoľvek zdroj Samsung Health (aj samotný telefón Samsung); inak nie (dolaďovanie z iných aplikácií je samostatná téma).
- Overenie: testy so syntetickými dátami pre Apple a Suunto; po pripojení rodičov kontrola na ich skutočných dátach (s ich súhlasom, na Richardov pokyn).

### Admin panel – zdroje dát a inbox
- Zdroje dát z Open Wearables API: `GET /api/v1/users/{id}/connections` (provider, stav, posledná synchronizácia) a `GET /api/v1/users/{id}/summaries/data` (typy dát podľa providera). Web ukáže zoznam zdrojov a typy dát „chodia / nechodia za posledných 7 dní“.
- Inbox počíta owi pri každom behu a ukladá do `accounts.db`: čaká na spárovanie; žiadne nové dáta 24 h (z posledného času dát používateľa); odpojený zdroj (stav pripojenia iný než `active`); záznam z `data/funnel-watchdog.log`; nová verzia Open Wearables (raz denne GitHub releases API upstreamu oproti bežiacej verzii); žiadosť o nové heslo. Položka sa dá označiť ako vybavená; tá istá udalosť sa nezopakuje, kým trvá.
- Stav systému: dostupnosť Open Wearables API, posledný beh owi, posledný záznam watchdogu Funnelu.

### Registrácia a párovanie
- Registrácia je otvorená (rozhodnutie Richarda). Ochrana (rozhodnutie Claude): najviac 5 registrácií za hodinu z jednej IP adresy; pri párovaní admin vidí meno, e-mail a čas registrácie a upozornenie „Spáruj len účet, o ktorom vieš, že patrí tomuto človeku“. V admin paneli sa dá registrácia vypnúť (napr. keby sa začali registrovať cudzí).

### Prístup Claude
- Claude nemá vlastné heslo ani účet (rozhodnutie Claude). Na kontrolu cudzieho účtu používa lokálne nástroje na notebooku: čítacie API owi na `127.0.0.1` s čítacím tokenom a lokálny vývojový server webu, ktorý v režime vývoja na `localhost` vie zobraziť ľubovoľného spárovaného používateľa bez prihlásenia (v produkcii táto možnosť neexistuje). Pravidlo „len na Richardov pokyn“ je záväzok správania, nie technická zábrana; Claude technicky vie čítať súbory owi na notebooku.

### Nastavenia (oddelené od Nastavení účtu)
- Rozhodnutie Claude: vzhľad (svetlý, tmavý, podľa systému), predvolené skóre spánku (Sleep Performance, Sleep Score Apple, Samsung) a režim prehľadu (ráno/večer automaticky alebo stále ranný). Ukladá sa k účtu, takže platí na každom zariadení.

### Web
- Nové stránky: `/login` (prerobená), `/registracia`, `/cakanie`, `/zabudnute-heslo`, `/nove-heslo/[token]`, `/ucet` (nastavenia účtu), `/admin` (inbox, účty, detail účtu, stav). Všetko v štýle Nočného panela, svetlý aj tmavý režim, mobil aj desktop.
- Ikonka účtu nahradí tlačidlo Odhlásiť vo všetkých rozloženiach (desktop hlavička aj mobil).
- Bezpečnosť ako doteraz: tokeny len na serveri, kontrola pôvodu pri zápisoch, žiadne tajomstvá ani skutočné dáta v repe.

## Na staviteľa
- Presné rozloženie a texty obrazoviek v rámci štýlu webu.
- Rozdelenie endpointov owi pre účty, tvar JSON, migrácia schém (s testami).
- Ako owi zistí bežiacu verziu Open Wearables.
- Poradie práce, testy (TDD, syntetické dáta), screenshoty.

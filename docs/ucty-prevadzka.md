# Prevádzka používateľských účtov

Účty sú v `data/accounts/accounts.db`. Výsledky patria používateľovi Open Wearables v `data/users/<ow_user_id>/`; jeho Samsung zápisy sú v `data/zapisy/<ow_user_id>/zapisy.db`. E-mail, heslá, tokeny, zálohy ani zdravotné dáta sa neukladajú do Gitu.

## Zavedenie existujúcej inštancie

1. Over testy, produkčný build webu a lokálne prihlasovanie na syntetických účtoch. Kandidát backendu musí byť postavený pred odstavením služieb.
2. Spusť `scripts/backup.ps1 -VerifyRestore`. Záloha obsahuje aj konfigurácie, SQLite snímky a obnovou overené PostgreSQL exporty. Zálohu chráni Windows ACL. Neprenáša sa mimo počítača.
3. Na kópii snímky vyskúšaj `owi users migrate --ow-user <id>`. Porovnaj databázy, zápisy a doladené nastavenia pred migráciou a po nej. Existujúci cieľ sa nesmie prepísať.
4. Priprav web príkazom `scripts/deploy-web.ps1 -SkipDomain`. Kandidát používa produkčné nastavenia, ale automaticky neprepne produkčnú doménu. Počkaj na stav `READY`; prihlasovací formulár sa dá overiť bez vytvárania účtov.
5. Zastav iba služby `owi` a `api`; Open Wearables môže ďalej prijímať údaje z telefónu. Vytvor poslednú konzistentnú snímku dát, aby sa medzi snímkou a presunom nič nezapisovalo.
6. Zisti existujúce ID a e-mail majiteľa v Open Wearables. Ak sa ID doteraz vyberalo automaticky z jediného používateľa, nastav explicitne `OWI_USER_ID` v lokálnom `.env`. Tým sa zachová aj záložný profil majiteľa z konfigurácie pri neskoršom pridaní ďalších ľudí.
7. Presuň pôvodné súbory cez `owi users migrate --ow-user <id> --backup-dir <lokálny priečinok>`. Potom spusti `owi accounts create-admin --email <existujúci e-mail> --first-name <meno> --ow-user <id>` v overenom kandidátovi. Vznik `accounts.db` prepína sync do režimu účtov, preto ho nevytváraj počas bežiacej pôvodnej inštancie.
8. Príkaz vráti jednorazový token na prvé heslo. Odkaz má tvar `/nove-heslo/<token>`, platí 24 hodín a majiteľ si cezň nastaví heslo sám. Token neukladaj do protokolov, Git histórie ani monitoringu.
9. Spusti overený image backendu, skontroluj `/ready`, `/version`, prístup k presunutým výsledkom a úspešný sync. Až potom povýš pripravený web na produkciu, napr. cez `vercel promote <deployment-url>`.
10. Over prihlasovanie, dostupnosť pôvodných dní a zápisov, administráciu a ďalší príjem dát. Staré spoločné heslo už web nepoužíva; staré relácie sa zneplatnia.

Pri presune SQLite nestačí presunúť hlavný `.db` súbor, ak vedľa neho zostal obsah WAL, ktorý sa ešte nezapísal do hlavného súboru. Migračný príkaz pred presunom zapíše potvrdené stránky WAL do databázy a pri blokovaní odmietne pokračovať. Aj tak musí počas presunu zostať sync a API zastavené.

## Návrat pri probléme

Zastav nové služby, obnov predošlý webový deployment a predošlý tag image. Aktuálny adresár dát odlož bokom a obnov overenú snímku do pôvodného umiestnenia; nemiešaj súbory z dvoch rozložení. Obnov aj pôvodnú konfiguráciu. Potom spusti služby a over pôvodný sync aj API. Pôvodné zálohy a image nemaž, kým nie je prechod overený.

## Bežná správa

- Registrácia vytvorí čakajúci účet. Admin ho spáruje len s overenou identitou Open Wearables. Zariadenia sa stále pripájajú v Open Wearables.
- Obnova hesla vytvorí žiadosť v inboxe. Admin odovzdá jednorazový odkaz súkromne; aplikácia neposiela e-maily. Nový odkaz nahradí starý.
- Prezeranie iného účtu je len na čítanie. Zmenu profilu, roly alebo párovania rob cez admin panel po návrate na svoj účet.
- Pozastavený účet sa s existujúcou reláciou nedostane k dátam. Zmena hesla a odhlásenie zo všetkých zariadení zneplatňujú aj predchádzajúce relácie. Posledný aktívny admin musí zostať zachovaný.
- Lokálne príkazy `day`, `rescore`, `calibrate`, `check` a `entries import` predvolene vyberajú aktívny spárovaný účet majiteľa podľa `OWI_USER_ID`. Iný účet sa vyberá výslovne pomocou `--account <id účtu>`. Neznáma alebo neaktívna identita skončí chybou; nevytvorí sa prázdna pôvodná databáza. Kalibrácia vyžaduje aktuálny súhlas daného účtu.
- Apple Health a Suunto sú pokryté syntetickými testami. Kontrola skutočných údajov ďalšieho človeka nasleduje až po jeho pripojení a na výslovný pokyn majiteľa so súhlasom dotknutého človeka.
- Pri prenose na ďalší počítač prenes celé `data/`, lokálnu konfiguráciu a overenú zálohu. Samotný klon repozitára účty ani históriu neobsahuje.

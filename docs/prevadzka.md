**Prevádzka a nasadenie**

Systém má dva Docker Compose projekty: upstream Open Wearables a tento repozitár. Verejná adresa telefónu aj cesta /owi zostávajú na Tailscale Funneli. Zmena hesiel databáz nemení prihlasovanie telefónu ani heslo webu.

**Lokálna záloha pred zmenou**

Z koreňa tohto repozitára v PowerShelli:

~~~powershell
.\scripts\backup.ps1 -VerifyRestore
~~~

Vytvorí lokálny priečinok open-wearables-backups/snapshot-DÁTUM-ČAS v používateľskom profile. Uloží konzistentné SQLite snapshoty, samostatné dumpy databáz Open Wearables a Svix, konfiguráciu, aktuálne zdroje tohto repozitára vrátane necommitovaných úprav a kontrolné súčty. Parameter VerifyRestore obnoví oba dumpy do dočasných skúšobných databáz a následne ich odstráni. Produkčné databázy pri overení neprepisuje.

Úspech označuje manifest.json s complete=true a restore_verified=true. Prístup k priečinku má príslušný používateľ Windows a SYSTEM. Sú tam aj prihlasovacie údaje: priečinok nepatrí do Gitu ani do verejného zdieľania.

Automatické zálohovanie mimo notebooku nebolo nastavené, podľa dohody pred plánovaným presunom na druhý PC.

**Ochrana upstream služieb**

Prenositeľná konfigurácia je docker/open-wearables.override.yml. Na existujúcej bežiacej inštancii ju po zálohe aplikuje:

~~~powershell
.\scripts\apply-server-hardening.ps1
~~~

Postgres a Redis nemajú publikované hostiteľské porty. API, portál, Flower a Svix sú dostupné lokálne. Redis vyžaduje heslo a používa protected-mode. Flower má HTTP Basic autentifikáciu; prihlasovanie je uložené ako FLOWER_BASIC_AUTH v lokálnom .env upstream projektu. Tento súbor spolu s backend/config/.env treba zachovať pri presune.

Skript mení aj heslo existujúcej databázovej roly. Samotná úprava POSTGRES_PASSWORD pri existujúcom volume nestačí. Pri úplne novej inštancii najprv obnov konfiguráciu a priprav Postgres; skript predpokladá, že existujúci kontajner Postgresu už beží.

**Nasadenie aktuálneho kódu owi**

~~~powershell
uv sync --locked
uv run ruff check .
uv run pytest -q
.\scripts\deploy.ps1
~~~

Deploy vytvorí zálohu, spočíta revíziu zo zdrojových súborov a vstupov zostavenia, zostaví image, overí prístup k dátam pod neprivilegovaným používateľom a spustí služby. Nakoniec overí /ready a /version. Identifikátor nasadenia je v data/deployment.json; rovnakú revíziu vráti GET /version. Existujúci image danej revízie sa znovu používa.

Ak už bola záloha v rovnakom servisnom okne vykonaná, možno použiť -SkipBackup. Parameter -BuildOnly iba pripraví image. Celú sadu testov v konkrétnom Linux image spustí:

~~~powershell
.\scripts\test-container.ps1 -Image owi:REVIZIA
~~~

Testovací kontajner nemá pripojené produkčné dáta ani tajomstvá. Kontajnery používajú používateľa 10001:10001. Pri presune na Linux treba tomuto používateľovi umožniť zápis do dátových priečinkov; priečinok výsledkov má API stále pripojený len na čítanie.

**Web na Verceli**

~~~powershell
Set-Location web
npm ci
npm test
npm run lint
npm run build
Set-Location ..
.\scripts\deploy-web.ps1
~~~

Skript používa existujúce prihlásenie Vercel CLI, vyberie existujúci projekt zdravie a nahrá iba povolené zdroje webu. Neposiela .env súbory, zdravotné dáta ani node_modules. Nasadzuje do produkcie. Predchádzajúce nasadenie zaznamená v data/web-deployment-before.json a nové v data/web-deployment.json.

Web potrebuje aj OWI_WRITE_TOKEN na atomickú rezerváciu prihlasovacieho pokusu. Po desať pokusoch za pätnásť minút z jednej adresy sa ďalšie pokusy odmietajú; existuje aj celkový limit. Pri nedostupnosti tejto ochrany login nepokračuje. Prístup už prihláseného používateľa k dátam je nezávislý.

Relácie sú naviazané aj na SITE_PASSWORD. Zmena hesla odvolá existujúce relácie. Prvé nasadenie tejto zmeny preto vyžaduje nové prihlásenie.

**Dostupnosť a čerstvosť**

| Kontrola | Čo znamená |
| --- | --- |
| GET /health | API proces odpovedá |
| GET /ready | Výsledkové úložisko je čitateľné; ide o malú kontrolu bez celej histórie |
| GET /version | Revízia image |
| data/sync-status.json | Posledný dokončený beh, výsledok a čas posledného úspechu |
| latest_measurement_at v datasete | Čas najnovšieho vstupného merania |
| last_compute_success_at v datasete | Dokončenie publikovania výsledkov |
| synced_at | Pôvodný čas prepočtu, zachovaný pre kompatibilitu |
| data/funnel-health.json | Lokálne služby, verejný vstup a privátna Tailscale cesta osobitne |

Web rozlišuje chybu načítania, zastavený prepočet a neprichádzajúce merania. Pri chybe spojenia ponechá posledné načítané dáta a upozorní aj vtedy, keď sú ešte nedávne.

Healthcheck Dockeru sám automaticky neopraví nezdravý proces. Restart policy rieši ukončenie procesu. Pri chybe treba pozrieť stav a logy zodpovedajúcej služby.

**Watchdog a Windows**

Existujúca úloha beží každých päť minút. Kontroluje lokálne API aj verejný Funnel; HTTP 502 alebo 503 nepovažuje za zdravú aplikáciu. Privátnu cestu hodnotí samostatne a pri jej chybe nereštartuje fungujúci verejný Funnel. Po opravnom reconnecte overí výsledok.

Pri obnove spojenia spúšťa samotné tailscale up bez parametrov, aby zachoval existujúce nastavenia vrátane unattended režimu. Čakanie obmedzuje nadradený proces na 20 sekúnd; nepridávaj samotný --timeout, ktorý vyžaduje opakovať všetky nepredvolené nastavenia. Zastavený uzol obnoví aj počas ochranného intervalu bez ďalšieho down. Verejné DNS overuje cez Google s náhradným resolverom Cloudflare, pretože po dlhšom odpojení môže prvý resolver dočasne vracať uložené NXDOMAIN.

Pre beh aj pred prihlásením používateľa je pripravený tento príkaz, ktorý vyžaduje PowerShell spustený ako Administrátor:

~~~powershell
.\scripts\install-watchdog.ps1
~~~

Požiadavku na zmenu existujúcej úlohy Windows počas opráv odmietol chybou Access is denied. Pôvodná úloha zostala zachovaná. Tailscale Run unattended sa podarilo zapnúť a overiť cez ForceDaemon=true; samotnú neinteraktívnu úlohu treba nastaviť uvedeným administrátorským príkazom. Inštalátor nastavuje aj Run unattended na ďalšom PC. Osobitne over spúšťanie Docker Desktop a celý stav po reštarte.

**Návrat pri probléme**

Predchádzajúci owi image je zachovaný ako owi:before-hardening-20261019. Lokálna záloha obsahuje dáta a pôvodnú upstream konfiguráciu. Nový web používa nový endpoint obmedzenia loginu: prípadný návrat na starý API image preto treba koordinovať s návratom webu na jeho predošlé nasadenie.

Pri probléme po migrácii databáz obnov najprv zálohu do oddeleného prostredia a over ju. Výpočtová databáza owi je obnoviteľná z raw dát, ručné zápisy a konfigurácia však musia zostať zachované.

**Presun na druhý PC**

Pred presunom urob novú zálohu. Prenes oba repozitáre, ich lokálne konfigurácie a konzistentné dáta cez súkromnú cestu. Zachovaj databázových používateľov a API kľúče. Na novom PC najprv over lokálny backend, Celery, prepočet a API; až potom presmeruj telefón a OWI_API_URL na Verceli.

Nové zariadenie v Tailscale môže mať inú HTTPS doménu. Pôvodná verejná adresa sa automaticky nepresunie skopírovaním priečinka. Pri zmene adresy uprav konfiguráciu telefónu aj serverové prostredie webu a znovu nasaď web. Počas prechodu neposielaj dáta striedavo do dvoch nezávislých databáz.

Účty pre viacerých používateľov zatiaľ nezapínaj vytvorením accounts.db: súčasný web používa jeden SITE_PASSWORD. Migrácia účtov musí zahŕňať webové prihlasovanie a výber dát podľa overenej relácie.

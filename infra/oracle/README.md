# Open Wearables na Oracle Cloud – návod

Výsledok: Open Wearables beží nonstop na bezplatnom serveri v Oracle Cloud. Telefón doň posiela dáta zo Samsung Health a Claude Desktop sa k nim dostane cez MCP. Notebook nemusí byť zapnutý.

**Ako to funguje**

- **Server:** Oracle Always Free VM (ARM, Ubuntu 24.04).
- **Verejná adresa** je odvodená z verejnej IP, ktorú dá Oracle. Ak má server IP `141.147.12.34`, adresy budú:
  - `https://141-147-12-34.sslip.io`: API pre mobilnú appku, Claude Desktop a neskôr web na Verceli
  - `https://admin.141-147-12-34.sslip.io`: admin portál
- **HTTPS certifikát** vybaví program Caddy na serveri. [sslip.io](https://sslip.io) je bezplatná služba, ktorá takéto meno preloží na IP adresu.
- **Všetko na serveri nastaví sám skript [`user-data.sh`](user-data.sh)**:
  - firewall (porty 80 a 443)
  - Docker, Caddy a Open Wearables `0.9.0`
  - denná záloha databázy

  Do Oracle stačí vložiť krátky [`bootstrap.sh`](bootstrap.sh), ktorý si skript stiahne z GitHubu.

Celkový čas: asi 30 minút, z toho 10 minút len čakanie.

---

## 1. Otvor porty 80 a 443 v Oracle

Oracle predvolene púšťa zvonku len SSH. Caddy potrebuje porty 80 a 443, aby získal certifikát a obsluhoval HTTPS.

1. **☰ → Networking → Virtual cloud networks.**
2. Ak tam žiadna VCN nie je, vytvor ju: **Start VCN Wizard → Create VCN with Internet Connectivity**, meno napr. `open-wearables-vcn`, ostatné nechaj predvolené.
3. Otvor VCN → **Security** (alebo **Security Lists**) → **Default Security List for …** → **Add Ingress Rules**. Pridaj dve pravidlá:

   | Source CIDR | IP Protocol | Destination Port Range |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

## 2. Priprav skript

Skopíruj obsah [`bootstrap.sh`](bootstrap.sh) a doplň dve hodnoty. Nechaj ich v jednoduchých úvodzovkách `'...'`:

| Premenná | Čo tam patrí |
|---|---|
| `OW_ADMIN_EMAIL` | tvoj e-mail: prihlásenie do admin portálu a kontakt pre vydavateľa HTTPS certifikátu |
| `OW_ADMIN_PASSWORD` | aspoň 12 znakov, bez medzier a bez znaku `'` |

Heslo ostane uložené v nastaveniach VM v Oracle, preto ho po prvom prihlásení zmeň (krok 5). Ostatné tajomstvá (heslo databázy, `SECRET_KEY`) si skript vygeneruje sám na serveri.

## 3. Vytvor VM

**☰ → Compute → Instances → Create instance:**

1. **Name:** `open-wearables`
2. **Image:** Change image → **Ubuntu** → **Canonical Ubuntu 24.04**. Nie verziu „Minimal“.
3. **Shape:** Change shape → **Ampere** → **VM.Standard.A1.Flex** → **1 OCPU, 4 GB memory**. Malo by tam byť označenie „Always Free-eligible“.
   - Stack zaberie okolo 1,4 GB, takže 4 GB stačí.
   - Pri menšej RAM sa VM nebude javiť ako nečinná, takže je menšia šanca, že ju Oracle vypne.
4. **Networking:** VCN z kroku 1, jej **public subnet**, zapnuté **Automatically assign public IPv4 address**.
5. **SSH keys:** **Generate a key pair for me** → **Download private key**. Kľúč si odlož, je to jediný spôsob, ako sa dostať do servera cez príkazový riadok.
6. **Advanced options → Management → Initialization script → Paste cloud-init script.** Vlož upravený `bootstrap.sh`.
7. **Create.**

Ak Oracle hlási **Out of capacity**, v časti Placement zmeň **Availability domain** a skús znova. Ak to nepomôže, skús to o pár hodín, často to ide večer alebo v noci.

## 4. Počkaj asi 10 minút a skontroluj

1. V detaile inštancie nájdeš **Public IP address**, napr. `141.147.12.34`.
2. Otvor `https://141-147-12-34.sslip.io/docs` (bodky v IP nahraď pomlčkami). Má sa ukázať dokumentácia API.
3. Otvor `https://admin.141-147-12-34.sslip.io`. Má sa ukázať prihlásenie do admin portálu.

Ak niečo nejde ani po 15 minútach, pozri [Riešenie problémov](#riešenie-problémov).

## 5. Admin portál

1. Prihlás sa e-mailom a heslom z kroku 2 a **hneď si zmeň heslo** v nastaveniach profilu.
2. **Settings → API Keys → vytvor kľúč.** Ukáže sa len raz, ulož si ho do password managera. Potrebuješ ho pre Claude Desktop.
3. **Users → pridaj používateľa** (seba).
4. V detaile používateľa klikni **Connect Mobile App**. Dostaneš **API URL** a jednorazový **invitation code**.

## 6. Telefón so Samsung Health

1. Nainštaluj appku **Open Wearables** pre Android. Je v bete, APK dostaneš na [Discorde Open Wearables](https://discord.gg/qrcfFnNE6H). Ak ju už máš spárovanú s notebookom, v appke sa odhlás alebo ju preinštaluj.
2. V Samsung Health zapni **Developer Mode** podľa [návodu Samsungu](https://developer.samsung.com/health/data/guide/developer-mode.html). Bez neho Samsung Health dáta appke nepustí.
3. V appke zadaj **API URL** a **invitation code**, vyber **Samsung Health** a povoľ prístup k dátam.
4. V nastaveniach Androidu vypni pre appku **optimalizáciu batérie**, inak Samsung zastaví synchronizáciu na pozadí.
5. V admin portáli by sa mali pri používateľovi objaviť prvé dáta.

## 7. Claude Desktop (MCP)

MCP server Open Wearables beží u teba, keď je zapnutý Claude Desktop, a len sa pýta servera v cloude.

1. Potrebuješ [`uv`](https://docs.astral.sh/uv/getting-started/installation/). Stiahni MCP server vo verzii zhodnej so serverom:
   ```bash
   git clone --branch 0.9.0 --depth 1 https://github.com/the-momentum/open-wearables.git open-wearables-0.9.0
   ```
2. Uprav konfiguráciu Claude Desktop:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

   ```json
   {
     "mcpServers": {
       "open-wearables": {
         "command": "uv",
         "args": ["run", "--frozen", "--directory", "/CESTA/K/open-wearables-0.9.0/mcp", "start"],
         "env": {
           "OPEN_WEARABLES_API_URL": "https://141-147-12-34.sslip.io",
           "OPEN_WEARABLES_API_KEY": "sk-..."
         }
       }
     }
   }
   ```
   Ak `uv` nenájde, daj do `command` plnú cestu (`which uv`, na Windows `where uv`).
3. Reštartuj Claude Desktop a opýtaj sa: *„Pre ktorých používateľov vidíš zdravotné dáta?“*

## 8. Vypni starý stack na notebooku

V priečinku, kde ti Open Wearables bežal doteraz:

```bash
docker compose down
```

Bez `-v` ostanú staré dáta na disku, keby si ich ešte potreboval.

---

## Čo je verejné a čo nie

- Zvonku sú otvorené len porty 80 a 443 (Caddy) a SSH, ktoré je predvolené a dostaneš sa naň len s kľúčom.
- Cez HTTPS je dostupné API a prihlasovacia stránka admin portálu. Dáta chráni heslo, API kľúč a tokeny mobilnej appky.
- Databáza a Redis sú len vo vnútri servera.

## Na čo si dať pozor

- **Adresa závisí od verejnej IP.** Tá ostáva aj po reštarte či vypnutí VM. Zmení sa, len keď VM zmažeš a vytvoríš novú. Vtedy treba novú adresu nastaviť v telefóne aj v MCP.
- **sslip.io je bezplatná služba tretej strany.** Keby nefungovala, telefón ani Claude server nenájdu. Certifikáty pre sslip.io občas narazia na limity Let's Encrypt. Caddy to vtedy skúša znova sám.
- Ak si neskôr kúpiš doménu, stačí v `.env` na serveri zmeniť `API_HOST` a `ADMIN_HOST` a stack reštartovať.

## Zálohy

- Každý deň o 3:30 (UTC) sa databáza uloží do `/opt/open-wearables/backups/` a drží sa 14 dní.
- Táto záloha chráni pred chybným upgradom, **nie pred stratou celej VM**. Záloha mimo Oracle je ďalší krok.
- Ručne: `sudo /opt/open-wearables/backup.sh`

## Upgrade na novú verziu

1. Prečítaj [release notes](https://github.com/the-momentum/open-wearables/releases), hlavne breaking changes.
2. Spusti `sudo /opt/open-wearables/backup.sh`.
3. V `/opt/open-wearables/.env` zmeň `OW_VERSION`.
4. Spusti `cd /opt/open-wearables && sudo docker compose pull && sudo docker compose up -d`.
5. Na notebooku aktualizuj MCP na rovnakú verziu (krok 7.1 s novým tagom).

## Riešenie problémov

**Pripojenie na server (SSH)** kľúčom z kroku 3.5:

```bash
ssh -i /cesta/ku/kluc.key ubuntu@<verejná IP>
```

Na macOS a Linuxe najprv spusti `chmod 600 /cesta/ku/kluc.key`.

**Užitočné príkazy na serveri:**

```bash
sudo cat /opt/open-wearables/INFO.txt                 # adresy a stav
sudo tail -50 /var/log/open-wearables-setup.log       # priebeh inštalácie
cd /opt/open-wearables && sudo docker compose ps      # bežia všetky služby?
cd /opt/open-wearables && sudo docker compose logs --tail 100 app
cd /opt/open-wearables && sudo docker compose logs --tail 100 caddy   # certifikáty
```

**Prehliadač hlási chybu certifikátu alebo sa stránka nenačíta.**

1. Over krok 1: Security List musí povoľovať TCP 80 a 443 zo zdroja `0.0.0.0/0`.
2. Potom VM v Oracle konzole reštartuj (**Reboot**). Caddy po štarte skúsi certifikát získať hneď.

**Oracle VM vypol pre nečinnosť.** V konzole ju znova spusti (Start). Ak sa to opakuje, prepni účet na Pay As You Go: Always Free zdroje ostanú zadarmo a toto pravidlo sa naň nevzťahuje.

# Open Wearables na Oracle Cloud – návod

Výsledok: Open Wearables beží nonstop na bezplatnom serveri v Oracle Cloud. Telefón doň posiela dáta zo Samsung Health a Claude Desktop sa k nim dostane cez MCP. Notebook nemusí byť zapnutý.

**Ako to funguje**

- **Server:** Oracle Always Free VM (ARM, Ubuntu 24.04).
- **Verejná HTTPS adresa** ide cez **Tailscale Funnel**. Netreba vlastnú doménu ani otvárať porty v Oracle. Adresa bude v tvare `https://ow.<tvoj-tailnet>.ts.net`:
  - `https://ow.<tailnet>.ts.net`: API pre mobilnú appku, Claude Desktop a neskôr web na Verceli
  - `https://ow.<tailnet>.ts.net:8443`: admin portál
- **Všetko na serveri nastaví sám skript [`user-data.sh`](user-data.sh)**, ktorý vložíš do Oracle pri vytváraní VM:
  - Docker
  - Tailscale
  - Open Wearables `0.9.0`
  - denná záloha databázy na disk VM

Celkový čas: asi 30 minút, z toho 10 minút len čakanie.

---

## 1. Tailscale (5 min)

1. Choď na <https://login.tailscale.com/start> a prihlás sa Google účtom. Ak ťa sprievodca bude nútiť pridať zariadenie, môžeš to preskočiť.
2. **DNS** (<https://login.tailscale.com/admin/dns>): MagicDNS nechaj zapnuté. Nižšie v sekcii **HTTPS Certificates** klikni **Enable HTTPS**.
3. **Access controls** (<https://login.tailscale.com/admin/acls>): skontroluj, že policy obsahuje blok s `"attr": ["funnel"]`. V nových účtoch tam je automaticky. Ak chýba, pridaj ho:
   ```json
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ]
   ```
4. **Keys** (<https://login.tailscale.com/admin/settings/keys>): klikni **Generate auth key**.
   - Reusable: vypnuté
   - Expiration: 1 day
   - Ephemeral: vypnuté
   - Tags: žiadne

   Skopíruj kľúč `tskey-auth-...`.

## 2. Priprav skript

Otvor [`user-data.sh`](user-data.sh) a skopíruj si celý obsah. V bloku `VYPLŇ` hore doplň tri hodnoty a nechaj ich v jednoduchých úvodzovkách `'...'`:

| Premenná | Čo tam patrí |
|---|---|
| `TS_AUTHKEY` | kľúč z Tailscale, krok 1.4 |
| `ADMIN_EMAIL` | tvoj e-mail na prihlásenie do admin portálu |
| `ADMIN_PASSWORD` | aspoň 12 znakov, bez medzier a bez znaku `'` |

Heslo ostane uložené v nastaveniach VM v Oracle, preto ho po prvom prihlásení zmeň (krok 5). Ostatné tajomstvá (heslo databázy, `SECRET_KEY`) si skript vygeneruje sám na serveri a nikam ich neposiela.

## 3. Vytvor VM v Oracle

V Oracle konzole: **☰ → Compute → Instances → Create instance**.

1. **Name:** `open-wearables`
2. **Image:** Change image → **Ubuntu** → **Canonical Ubuntu 24.04**. Nie verziu „Minimal“.
3. **Shape:** Change shape → **Ampere** → **VM.Standard.A1.Flex** → **1 OCPU, 4 GB memory**. Malo by tam byť označenie „Always Free-eligible“.
   - 4 GB stačí. Stack v teste zabral okolo 1,4 GB.
   - Pri menšej RAM sa VM nebude javiť ako nečinná, takže je menšia šanca, že ju Oracle vypne.
4. **Networking:** nechaj predvolené (nová VCN, verejná podsieť, verejná IPv4 adresa).
5. **SSH keys:** **Generate a key pair for me** → **Download private key**. Kľúč si odlož, slúži ako núdzový prístup.
6. **Advanced options → Management → Initialization script → Paste cloud-init script.** Vlož upravený obsah `user-data.sh`.
7. **Create.**

Ak Oracle hlási **Out of capacity**, v časti Placement zmeň **Availability domain** a skús znova. Ak to nepomôže, skús to o pár hodín, často to ide večer alebo v noci.

## 4. Počkaj asi 10 minút a skontroluj

1. V Tailscale → **Machines** sa objaví zariadenie `ow`. Klikni na **⋯ → Disable key expiry**. Inak sa server po 180 dňoch odpojí.
2. V detaile zariadenia nájdeš jeho meno, napr. `ow.tail1234.ts.net`.
3. Otvor `https://ow.<tailnet>.ts.net/docs`. Má sa ukázať dokumentácia API. Prvé otvorenie môže trvať asi minútu, kým sa vystaví certifikát.
4. Otvor `https://ow.<tailnet>.ts.net:8443`. Má sa ukázať prihlásenie do admin portálu.

Ak niečo nejde ani po 15 minútach, pozri [Riešenie problémov](#riešenie-problémov).

## 5. Admin portál

1. Prihlás sa `ADMIN_EMAIL` / `ADMIN_PASSWORD` a **hneď si zmeň heslo** v nastaveniach profilu.
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

MCP server Open Wearables beží u teba, keď je zapnutý Claude Desktop, a len sa pýta servera v cloude. Na notebooku nič nehostíš.

1. Potrebuješ [`uv`](https://docs.astral.sh/uv/getting-started/installation/), pravdepodobne ho už máš. Stiahni MCP server vo verzii zhodnej so serverom:
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
           "OPEN_WEARABLES_API_URL": "https://ow.<tailnet>.ts.net",
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

- Z internetu je dostupné API a prihlasovacia stránka admin portálu, oboje cez HTTPS. Dáta chráni heslo, API kľúč a tokeny mobilnej appky.
- Databáza a Redis sú len vo vnútri servera. Porty 8000 a 3000 počúvajú len na `127.0.0.1` a von ich pustí iba Tailscale.
- V Oracle nie je otvorený žiadny port okrem predvoleného SSH.

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

**Pripojenie na server (SSH)** – jedna z možností:

- **Cez Tailscale:** nainštaluj Tailscale na notebook a prihlás sa rovnakým účtom. Potom spusti `ssh ubuntu@ow`. Prihlásenie potvrdíš v prehliadači.
- **Cez kľúč z Oracle:** spusti `ssh -i /cesta/ku/kluc.key ubuntu@<verejná IP z detailu inštancie>`. Na macOS a Linuxe najprv `chmod 600 /cesta/ku/kluc.key`.

**Užitočné príkazy na serveri:**

```bash
sudo cat /opt/open-wearables/INFO.txt                 # adresy a stav
sudo tail -50 /var/log/open-wearables-setup.log       # priebeh inštalácie
cd /opt/open-wearables && sudo docker compose ps      # bežia všetky služby?
cd /opt/open-wearables && sudo docker compose logs --tail 100 app
sudo tailscale funnel status                          # verejné adresy
```

**Funnel sa nezapol.** V Tailscale over kroky 1.2 a 1.3, potom na serveri spusti:

```bash
sudo tailscale funnel --bg 8000
sudo tailscale funnel --bg --https=8443 3000
```

**Oracle VM vypol pre nečinnosť.** V konzole ju znova spusti (Start). Ak sa to opakuje, prepni účet na Pay As You Go: Always Free zdroje ostanú zadarmo a toto pravidlo sa naň nevzťahuje.

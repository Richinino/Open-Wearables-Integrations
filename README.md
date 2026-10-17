# Open Wearables – vlastná inštancia

Moja inštancia [Open Wearables](https://github.com/the-momentum/open-wearables): dáta zo Samsung Health (telefón a hodinky) sa zbierajú v Dockeri a Claude sa k nim dostane cez MCP.

| Časť | Kde | Stav |
|---|---|---|
| Backend (API, Postgres, Redis, Celery, admin portál) | Docker na notebooku, neskôr na domácom PC | beží lokálne, presun na PC sa pripravuje |
| Spojenie telefón → backend | Tailscale Funnel (stála HTTPS adresa) | beží |
| MCP pre Claude | lokálne, volá API backendu | beží |
| Denné metriky (`owi`) | toto repo | beží |
| API pre web (`owi serve`): čítanie a zápisy zo Samsungu | toto repo, Docker | beží |
| Web so súhrnmi | `web/`, Vercel | nasadený, s prihlásením |

Tajomstvá (API kľúče, heslá, `.env`) ani zdravotné dáta do tohto repa nepatria. Priečinok `data/` je v `.gitignore`.

## owi – denné metriky

Open Wearables zbiera surové dáta, ale jeho denné súhrny pre dáta zo Samsungu nesedia: dni delí podľa UTC, kroky berie z krokomera telefónu a aktívny čas ani kalórie nepozná. `owi` číta surové dáta cez API a pre každý deň podľa lokálneho času vypočíta:

| Údaj | Ako | Presnosť |
|---|---|---|
| Kroky | denný súčet zo Samsung Health; inak hodinové dáta zo Samsungu; inak krokomer telefónu | presné, keď súčet v dátach je |
| Tep | pokojový, priemer, maximum, minúty v zónach | presné |
| Tréningy | čas, typ, tep, zóny, vzdialenosť ak je, odhad kalórií | tep presný, kalórie odhad |
| Spánok | hlavný spánok dňa bez duplicít medzi zdrojmi | presné |
| Vzdialenosť | kroky × dĺžka kroku | odhad |
| Aktívny čas | minúty s tepom nad prahom a minúty tréningov | odhad |
| Kalórie | z rezervy tepu, váhy a VO2max; spolu = bazál + aktivita | odhad |

Odhady majú v databáze stĺpce s príponou `_est`. Samsung Health si tieto hodnoty ráta sám a nikam ich neposiela, preto sa dajú len priblížiť.

Návrh je v [`docs/superpowers/specs/2026-10-13-denne-metriky-design.md`](docs/superpowers/specs/2026-10-13-denne-metriky-design.md).

### Spustenie

Potrebuješ [`uv`](https://docs.astral.sh/uv/) a bežiaci Open Wearables.

```bash
cp .env.example .env        # doplň OWI_API_KEY
uv sync
uv run owi sync             # prepočíta posledné 3 dni
uv run owi sync --from 2026-07-01 --to 2026-07-31
uv run owi day 2026-07-15 --json
```

Výsledky sú v `data/owi.db` (SQLite), tabuľky `daily` a `workouts`; skóre pozri nižšie.

### Skóre

Z uložených dní `owi` počíta aj skóre: Readiness (Oura bez HRV, odhad), Sleep Performance a potrebu spánku (WHOOP), Sleep Score (Apple), pravidelnosť spánku (SRI), Activity (Oura), strain dňa a tréningov (WHOOP, 0–21), stav záťaže (Polar), NightSignal, skóre dňa, VO2max a WHOOP Age. Vzorce sú v [`docs/skore.md`](docs/skore.md), návrh v [`docs/superpowers/specs/2026-10-14-skore-design.md`](docs/superpowers/specs/2026-10-14-skore-design.md).

Vzorce potrebujú v `.env` vek a pohlavie (`OWI_AGE`, `OWI_SEX` = `male` alebo `female`).

```bash
uv run owi sync             # uloží dni, ich znaky a prepočíta skóre od prvého zmeneného dňa
uv run owi rescore          # prepočíta len skóre z uložených znakov, nič nesťahuje
uv run owi rescore --from 2026-10-01 --to 2026-10-14
```

| Tabuľka | Obsah |
|---|---|
| `day_features` | znaky dňa (`DayFeatures`) ako JSON: tep v spánku, záťaž, MET, spánok s fázami |
| `day_scores` | skóre dňa (`DayScores`) ako JSON s ich zložkami a poznámkou, prečo hodnota chýba |

Kým nie je dosť histórie, skóre je `null` s poznámkou (napr. Readiness po 14 nociach, stav záťaže po 28 dňoch). Dni s menej ako 1 000 minútami tepu sa nerátajú do základov a ukončený taký deň nemá strain ani Activity.

### Dolaďovanie odhadov

Čísla zo Samsung Health (kroky, vzdialenosť, aktívny čas, aktívne kalórie, kalórie spolu, Sleep Score, Energy Score) sa zapisujú na webe na stránke Zápis, kedykoľvek a za viac dní naraz. `owi serve` ich uloží do `data/zapisy/zapisy.db` (priečinok vytvorí `owi sync` aj `owi serve`, ak chýba).

`owi sync` potom sám doladí dĺžku kroku, prah tepu pre aktívnu minútu, koeficient kalórií a náhradný bazál: po každom uložení či zmazaní zápisu, inak raz denne. Novšie dni vážia viac, pri málo dňoch ostávajú hodnoty blízko predvolených a nová hodnota sa prijme, len ak na najnovších dňoch netrafí horšie. Pri zmene parametrov prepočíta všetky uložené dni, najviac raz za 24 h. Zo Sleep Score a Energy Score sa učí váhy dvoch nových odhadov; ukážu sa od 10 zápisov daného skóre. Postup je v [`docs/skore.md`](docs/skore.md) §7, návrh v [`docs/superpowers/specs/2026-10-16-zapisy-a-doladovanie-design.md`](docs/superpowers/specs/2026-10-16-zapisy-a-doladovanie-design.md).

```bash
uv run owi entries import   # jednorazovo prenesie starý data/truth.csv do zápisov
uv run owi calibrate        # doladí hneď a prepočíta uložené dni
uv run owi check            # porovná odhady so zápismi
```

| Súbor alebo tabuľka | Obsah |
|---|---|
| `data/params.json` | parametre odhadov a maximálny tep |
| `data/score_weights.json` | váhy odhadov Samsung Sleep Score a Energy Score |
| `params_history` v `owi.db` | každé doladenie: čas, počet zápisov, hodnoty, odchýlky od Samsungu |
| `recompute_state` v `owi.db` | s akými parametrami boli dni naposledy prepočítané a kedy |

### API pre web

Web si výsledky číta a zápisy posiela cez `owi serve`. Výsledky (`owi.db`) server len číta, s tokenom z `OWI_SERVE_TOKEN`. Zápisy prijíma s druhým tokenom `OWI_WRITE_TOKEN`; čítací token zapisovať nemôže a zapisovací nečíta. Oba majú aspoň 32 znakov a sú v `.env`; bez `OWI_WRITE_TOKEN` je API len na čítanie a zápis vráti 503.

```bash
uv run owi serve            # http://127.0.0.1:8787
curl -H "Authorization: Bearer $OWI_SERVE_TOKEN" "http://127.0.0.1:8787/v1/days?from=2026-07-01&to=2026-07-31"
```

| Cesta | Čo robí |
|---|---|
| `GET /health` | `{"status": "ok"}`, bez tokenu |
| `GET /v1/days` | posledných najviac 400 dní aj s tréningmi |
| `GET /v1/days?from=…&to=…` | dni v rozsahu vrátane okrajov |
| `PUT /v1/entries/{deň}` | uloží zápis dňa (JSON so siedmimi poľami, chýbajúce = `null`); všetky `null` zápis zmažú |

Každý deň má navyše `scores` (skóre dňa, `null` kým nie je spočítané, vrátane odhadov `samsung_sleep` a `energy_score`), `sleep_timeline` (fázy hlavného spánku a zdriemnutí, `[]` bez spánku) a `samsung` (zápis dňa alebo `null`); každý tréning má `strain` (0–21 alebo `null`). Na najvyššej úrovni je `calibration`: kedy a podľa koľkých zápisov sa dolaďovalo, aktuálne a predvolené parametre a odchýlky od Samsungu. Zápis prijme deň od prvého uloženého po dnešok; zlé hodnoty vrátia 400 s krátkymi správami po slovensky pri poliach. Typy sú v [`web/src/lib/types.ts`](web/src/lib/types.ts).

Presný tvar odpovedí je v [`docs/superpowers/specs/2026-10-13-web-design.md`](docs/superpowers/specs/2026-10-13-web-design.md) a [`docs/superpowers/specs/2026-10-16-zapisy-a-doladovanie-design.md`](docs/superpowers/specs/2026-10-16-zapisy-a-doladovanie-design.md).

### Docker

Dva kontajnery z jedného image: `owi` prepočítava posledných 14 dní každých 10 minút (telefón niekedy pošle dáta až o pár dní) a dolaďuje odhady, `api` sprístupňuje výsledky na `127.0.0.1:8787` a prijíma zápisy. Kontajner `api` má `data/` pripojené len na čítanie, navyše `data/zapisy/` na zápis, a nedostane kľúč k Open Wearables. Zápisy (SQLite) zdieľajú oba kontajnery cez priečinok z Windows, preto majú obyčajný žurnál (nie WAL) a pri zamknutí sa krátko opakujú.

```bash
docker compose --env-file .env -f docker/compose.yml up -d --build
docker compose --env-file .env -f docker/compose.yml logs --tail 20
```

Predvolene sa `owi` pripája na sieť `open-wearables_default` a adresu `http://app:8000`. Iné hodnoty nastav v `.env` ako `OW_NETWORK` a `OWI_DOCKER_API_URL`, port API ako `OWI_SERVE_PORT`.

Na internet sa API dostane cez Tailscale Funnel pod cestou `/owi` (v PowerShelli; Git Bash cestu `/owi` prepíše):

```powershell
tailscale funnel --bg --set-path /owi 8787
```

### Vývoj

```bash
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Testy bežia na umelých dátach z `tests/factories.py`.

## Web

Stránka v [`web/`](web/) (Next.js) ukazuje výsledky `owi`: dnešok, posledné obdobie, spánok, tréningy a detail dňa. Dáta ostávajú doma; web si ich pri každom načítaní číta cez `owi serve` a otvorená stránka sa obnovuje každú minútu.

- Prihlásenie jedným heslom (`SITE_PASSWORD`). Bez prihlásenia sa nezobrazí stránka ani `/api/*`.
- Token k dátam (`OWI_API_TOKEN`) pozná len server na Verceli, do prehliadača sa nedostane; rovnako zapisovací `OWI_WRITE_TOKEN`, cez ktorý stránka Zápis posiela čísla zo Samsung Health.
- Odhady sú označené znakom ≈.
- Bez `OWI_API_URL` beží lokálny vývoj na umelých dátach.

```bash
cd web
npm install
npm run dev -- -p 3100
npm test
```

Premenné prostredia sú v [`web/.env.example`](web/.env.example), návrh v [`docs/superpowers/specs/2026-10-13-web-design.md`](docs/superpowers/specs/2026-10-13-web-design.md).

# Open Wearables – vlastná inštancia

Moja inštancia [Open Wearables](https://github.com/the-momentum/open-wearables): dáta zo Samsung Health (telefón a hodinky) sa zbierajú v Dockeri a Claude sa k nim dostane cez MCP.

| Časť | Kde | Stav |
|---|---|---|
| Backend (API, Postgres, Redis, Celery, admin portál) | Docker na notebooku, neskôr na domácom PC | beží lokálne, presun na PC sa pripravuje |
| Spojenie telefón → backend | Tailscale Funnel (stála HTTPS adresa) | beží |
| MCP pre Claude | lokálne, volá API backendu | beží |
| Denné metriky (`owi`) | toto repo | beží |
| Web so súhrnmi | toto repo | neskôr |

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

Výsledky sú v `data/owi.db` (SQLite), tabuľky `daily` a `workouts`.

### Ladenie odhadov

Do `data/truth.csv` zapíš hodnoty, ktoré pre daný deň ukazuje Samsung Health. Prázdne pole znamená, že hodnotu nepoznáš:

```csv
date,steps,active_minutes,activity_kcal,total_kcal,distance_km
2026-07-15,12000,95,480,2150,8.9
```

```bash
uv run owi calibrate        # naladí parametre a uloží ich do data/params.json
uv run owi check            # porovná odhady s referenčnými hodnotami
uv run owi sync --from 2026-07-01   # prepočíta dni s novými parametrami
```

Ladí sa dĺžka kroku, prah tepu pre aktívnu minútu a koeficient kalórií. Čím viac dní, tým lepšie; s jedným či dvoma dňami sedí odhad len na ne.

### Docker

Kontajner prepočítava posledné 3 dni každých 30 minút a na API sa pripája cez sieť Open Wearables.

```bash
docker compose -f docker/compose.yml up -d --build
docker compose -f docker/compose.yml logs --tail 20 owi
```

Predvolene sa pripája na sieť `open-wearables_default` a adresu `http://app:8000`. Iné hodnoty nastav ako premenné prostredia `OW_NETWORK` a `OWI_DOCKER_API_URL` pred spustením príkazu; z koreňového `.env` ich Compose nečíta.

### Vývoj

```bash
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Testy bežia na umelých dátach z `tests/factories.py`.

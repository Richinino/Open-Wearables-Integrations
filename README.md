# Open Wearables – vlastná inštancia

Moja inštancia [Open Wearables](https://github.com/the-momentum/open-wearables): dáta zo Samsung Health (telefón a hodinky) sa zbierajú v Dockeri a Claude sa k nim dostane cez MCP.

| Časť | Kde | Stav |
|---|---|---|
| Backend (API, Postgres, Redis, Celery, admin portál) | Docker na notebooku, neskôr na domácom PC | beží lokálne, presun na PC sa pripravuje |
| Spojenie telefón → backend | Tailscale (stála HTTPS adresa) | beží |
| MCP pre Claude | lokálne, volá API backendu | beží |
| Web so súhrnmi a spracovanie dát | toto repo | neskôr |

Tajomstvá (API kľúče, heslá, `.env`) do tohto repa nepatria.

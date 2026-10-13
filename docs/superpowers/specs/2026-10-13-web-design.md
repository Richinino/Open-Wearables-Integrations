# Web so súhrnom dát – návrh

Dátum: 2026-10-13. Stav: schválené.

## Cieľ

Web na Verceli, ktorý po prihlásení ukáže výsledky programu `owi`: dnešok, posledných 7 a 30 dní, spánok, tréningy a detail dňa. Dáta ostávajú na notebooku (neskôr na PC); web si ich číta cez HTTPS.

Mimo rozsahu: úprava dát z webu, viac používateľov, MCP nad výsledkami, natívna appka.

## Kritériá úspechu

- Bez prihlásenia sa nezobrazí žiadny údaj; ani stránka, ani `/api/*`.
- Token k dátam a heslo sú len v env premenných Vercelu, nikdy v prehliadači ani v gite.
- Čísla na webe sa zhodujú s `owi day <dátum> --json`.
- Odhady sú viditeľne označené znakom ≈.
- Keď je notebook vypnutý, web ukáže posledné načítané dáta a kedy boli aktualizované.
- V repe nie sú reálne zdravotné dáta; vývoj a testy bežia na umelých.

## Tok dát

```
data/owi.db ──► owi serve (kontajner, len čítanie) ──► Tailscale Funnel /owi
                                                            │  Bearer token
                              prehliadač ──► Vercel /api/data (kontrola session, cache 5 min)
```

Zamietnuté: posielanie výsledkov do úložiska Vercelu (zdravotné dáta natrvalo u tretej strany, viac nastavovania) a web priamo z notebooku (nedostupný, keď notebook nebeží).

## Čítacie API: `owi serve`

Nový príkaz `owi serve [--host H] [--port P]` (predvolene `127.0.0.1:8787`). Používa len štandardnú knižnicu, databázu otvára v režime read-only a nič nezapisuje.

Nastavenie: `OWI_SERVE_TOKEN`, aspoň 32 znakov. Bez neho sa server nespustí.

| Požiadavka | Odpoveď |
|---|---|
| `GET /health` | `200 {"status": "ok"}`, bez tokenu |
| `GET /v1/days` | posledných najviac 400 dní |
| `GET /v1/days?from=YYYY-MM-DD&to=YYYY-MM-DD` | dni v rozsahu vrátane okrajov, najviac 400 |

`/v1/days` vyžaduje hlavičku `Authorization: Bearer <token>`; porovnáva sa v konštantnom čase.

```json
{
  "timezone": "Europe/Bratislava",
  "first_day": "2026-07-01",
  "last_day": "2026-07-31",
  "synced_at": "2026-07-31T10:02:11+00:00",
  "days": [
    {
      "day": "2026-07-15", "timezone": "Europe/Bratislava", "complete": true,
      "steps": 12000, "steps_source": "samsung_health_total",
      "distance_m_est": 8900.0, "active_minutes_est": 95,
      "activity_kcal_est": 480.0, "basal_kcal": 1650.0, "total_kcal_est": 2130.0,
      "hr_resting": 52.0, "hr_avg": 71.0, "hr_max": 168.0, "hr_min": 47.0,
      "zone_light_min": 80, "zone_moderate_min": 30, "zone_vigorous_min": 12,
      "sleep_start": "2026-07-14T21:10:00+00:00", "sleep_end": "2026-07-15T04:55:00+00:00",
      "sleep_minutes": 440.0, "sleep_deep_min": 85.0, "sleep_rem_min": 95.0,
      "sleep_light_min": 260.0, "sleep_awake_min": 25.0, "nap_minutes": 0.0,
      "workouts": [
        {
          "id": "w1", "day": "2026-07-15", "type": "running",
          "start": "2026-07-15T16:00:00+00:00", "end": "2026-07-15T16:45:00+00:00",
          "duration_s": 2700, "source": "google",
          "hr_avg": 148.0, "hr_max": 168.0, "hr_min": 96.0,
          "zone_light_min": 5, "zone_moderate_min": 28, "zone_vigorous_min": 12,
          "distance_m": 7500.0, "kcal_est": 520.0
        }
      ]
    }
  ]
}
```

- `first_day`, `last_day` a `synced_at` opisujú celú databázu, nie vrátený rozsah. `synced_at` je čas posledného prepočtu. V prázdnej databáze sú `null` a `days` je prázdne pole.
- Dni idú vzostupne. Chýbajúca hodnota je `null`. Časy sú ISO 8601 v UTC, `day` je lokálny dátum.
- Chyby majú tvar `{"error": "<text>"}`: `400` zlý dátum, `from` po `to` alebo rozsah nad 400 dní; `401` chýbajúci či nesprávny token; `404` neznáma cesta; `503` databáza ešte neexistuje alebo je práve zamknutá.
- Odpovede majú `Cache-Control: no-store`.

Beh: druhá služba `api` v `docker/compose.yml` z toho istého image, `data/` pripojené read-only, port zverejnený len na `127.0.0.1`. Funnel ju pridá pod cestu `/owi` na existujúcej adrese; Open Wearables API ostáva na `/`.

## Web

Next.js (App Router, TypeScript) v priečinku `web/`, texty po slovensky.

**Prihlásenie.** Jedno heslo v `SITE_PASSWORD`. Po zadaní sa nastaví cookie `owi_session` (HttpOnly, Secure, SameSite=Lax, 30 dní) s časom vypršania podpísaným cez HMAC-SHA256 kľúčom `SESSION_SECRET`. Nesprávne heslo: odpoveď s oneskorením a rovnaká hláška bez ohľadu na dôvod. Bez nastaveného hesla alebo kľúča sa prihlásiť nedá.

**Ochrana.** Každá stránka okrem `/login` aj každý route handler okrem prihlásenia overuje session: stránky presmerujú na `/login`, `/api/*` vráti `401`. Vyhľadávače majú zákaz indexovania.

**Dáta.** Server volá `GET {OWI_API_URL}/v1/days` s tokenom `OWI_API_TOKEN` a výsledok drží v cache 5 minút; pri výpadku ďalej vracia posledný úspešný. Prehliadač volá len `/api/data` a obnovuje ho každých 5 minút. Keď je `synced_at` staršie než 90 minút, web ukáže, že zdroj je offline.

| Stránka | Obsah |
|---|---|
| `/` Prehľad | dnešok; priemery za 7 a 30 dní s porovnaním s predošlým obdobím; grafy krokov, aktívneho času, kalórií, pokojového tepu a spánku |
| `/spanok` | trvanie a fázy po nociach, časy zaspatia a zobudenia, zdriemnutia |
| `/treningy` | zoznam: typ, trvanie, tep, zóny, vzdialenosť, odhad kalórií |
| `/den/[datum]` | všetky údaje jedného dňa a jeho tréningy |
| `/login` | heslo |

Env premenné na Verceli: `SITE_PASSWORD`, `SESSION_SECRET`, `OWI_API_URL`, `OWI_API_TOKEN`. Pri lokálnom vývoji bez `OWI_API_URL` web použije umelé dáta; v produkcii nikdy.

## Testy

- `owi serve`: jednotkové testy spracovania požiadavky (autorizácia, rozsahy, chyby, tvar odpovede) a test cez skutočný socket.
- Web: testy podpisu session a funkcií, ktoré z dní rátajú priemery, trendy a rady pre grafy; overenie v prehliadači na umelých aj skutočných dátach.

## Poradie

1. `owi serve`, služba v Dockeri, cesta `/owi` vo Funneli.
2. Základ webu: prihlásenie, dátová vrstva, výpočty.
3. Vzhľad a stránky.
4. Nasadenie na Vercel.

# Zápisy zo Samsungu a dolaďovanie odhadov – návrh

Dátum: 2026-10-16. Stav: schválené používateľom v rozhovore (časti 1–4). Súvisí: [`docs/skore.md`](../../skore.md), [`docs/ako-to-funguje.md`](../../ako-to-funguje.md), [`2026-10-13-web-design.md`](2026-10-13-web-design.md).

## Cieľ

Odhady `owi` sa časom spresňujú podľa čísel, ktoré používateľ občas (raz za týždeň) doplní zo Samsung Health. **Vzorce sa neprepisujú**; dolaďujú sa len čísla, ktoré v nich už sú. Skóre podľa WHOOP/Oura/Apple/Polar ostávajú bez zmeny. Pribudnú dva nové odhady vedľa: Samsung Sleep Score a Energy Score.

## Rozhodnutia používateľa

- Zdroj pravdy: čísla zo Samsung Health zapísané cez formulár na webe, plus to, čo sa owi naučí samo z dát.
- Formulár: dopĺňanie viacerých dní naraz, keď je čas; žiadne denné výzvy.
- Polia: kroky, vzdialenosť, aktívny čas, aktívne kalórie, kalórie spolu, Sleep Score, Energy Score.
- Samsung Sleep Score a Energy Score: nové odhady vedľa, existujúce skóre sa nemenia.
- Spôsob: doladiť pár čísel vo vzorcoch, pri málo dňoch blízko pôvodných hodnôt.

## Čo sa dolaďuje

| Výpočet | Parameter (`Params`) | Predvolené | Hranice | Pravda zo zápisov |
|---|---|---|---|---|
| Vzdialenosť | `stride_m` | 0,74 | 0,50–1,10 m | `distance_km` / `steps` |
| Aktívny čas | `active_hr_delta` | 30 | 5–60 bpm | `active_minutes` |
| Kalórie z aktivity | `kcal_scale` | 1,0 | 0,5–1,5 | `active_kcal` |
| Kalórie spolu | `basal_kcal` (nový, `None` = ako doteraz) | `None` | 1 200–2 500 kcal | `total_kcal − active_kcal`; používa sa len pre dni bez záznamu bazálneho výdaja zo Samsungu |
| Samsung Sleep Score (nový odhad) | váhy častí | rovnaké váhy | každá váha 0–1, súčet 1 | `sleep_score` |
| Energy Score (nový odhad) | váhy častí | rovnaké váhy | každá váha 0–1, súčet 1 | `energy_score` |

Samo z dát, bez zápisov: dĺžka kroku z tréningov chôdze a behu, ktoré majú vzdialenosť **a zároveň** kroky krokomera v čase tréningu; ak taký tréning nie je, táto časť sa nepoužije. Maximálny tep, pokojové hodnoty a normál spánku sa už berú z dát a ostávajú bez zmeny.

### Postup dolaďovania (A)

1. **Váha dňa** podľa veku zápisu: polčas 60 dní (rastie, novšie dni viac).
2. **Doladenie** jedného parametra: existujúce funkcie v `calibration.py` (`_fit_stride`, `_fit_delta`, `_fit_scale`) rozšírené o váhy dní; `basal_kcal` = vážený medián `total_kcal − active_kcal`. Výsledok sa oreže na hranice.
3. **Stiahnutie k predvolenej hodnote:** `θ = θ₀ + n/(n + 7) · (θ_fit − θ₀)`, kde `n` je súčet váh dní, ktoré parameter informujú. Pri 7 dňoch je to polovica cesty.
4. **Kontrola na nevidených dňoch:** ak má parameter aspoň 6 dní, doladí sa na staršie dni bez najnovšej štvrtiny (aspoň 2) a porovná sa chyba na tej štvrtine s doterajšou hodnotou. Ak je nová chyba väčšia, ostáva doterajšia hodnota. Prijatá hodnota sa potom doladí na všetkých dňoch (krok 2–3).
5. **Samsung skóre:** časti skóre (každá 0–100) z `DayFeatures`, výsledok `clamp(Σ wᵢ·cᵢ)`. Váhy: vážená ridge regresia stiahnutá k rovnakým váham, orezaná a znormovaná na súčet 1. Odhad sa ukazuje až od 10 zápisov daného skóre; dovtedy `Score(None, {"entries": n, "needed": 10}, "learning")`.
   - Sleep Score – časti podľa toho, ako Samsung skóre popisuje: celkový čas spánku oproti potrebe (tínedžer 8 h), hlboký spánok (fyzická regenerácia), REM (psychická regenerácia), efektivita (spánok / čas v posteli), prerušenia (bdenie po zaspaní), čas zaspávania.
   - Energy Score – vstupy podľa [`skore.md`](../../skore.md): spánok (7-dňový priemer oproti potrebe), pravidelnosť (SRI), načasovanie (stred spánku oproti 14-dňovému), včerajšia záťaž oproti 28 dňom (pomer ako ACWR), nočný tep oproti normálu. HRV nemáme.
6. **Kvalita** (čo ukazuje web): chyba na nevidenej štvrtine (alebo na všetkých dňoch pri menej ako 6), pre odhady ako priemerná percentuálna odchýlka, pre skóre ako priemerná odchýlka v bodoch; `previous_error` je chyba predošlej verzie na tých istých dňoch.

### Kedy beží

- V každom behu `owi sync` (každých 10 minút): ak pribudol alebo sa zmenil zápis od posledného doladenia, owi doladí parametre; inak raz denne.
- Zmena parametrov `stride_m`, `active_hr_delta`, `kcal_scale` alebo `basal_kcal` → prepočet všetkých uložených dní (ako `owi sync --from <prvý deň>`), najviac raz za 24 h; inak len nasledujúce behy.
- Zmena váh Samsung skóre alebo nový zápis → `rescore` všetkých dní (bez sťahovania).
- Parametre sa ukladajú do `data/params.json` ako doteraz (`load_params`/`save_params`), história do tabuľky `params_history` v `owi.db` (čas, parametre, kvalita).

## Ukladanie a bezpečnosť

- Zápisy: `data/zapisy/zapisy.db` (SQLite), tabuľka `entries(day TEXT PRIMARY KEY, steps, distance_km, active_minutes, active_kcal, total_kcal, sleep_score, energy_score, saved_at TEXT)`. `data/` je mimo gitu.
- `zapisy.db` zdieľajú dva kontajnery cez priečinok z Windows: režim žurnálu `DELETE` (nie WAL), krátke transakcie, pri `database is locked` krátko opakovať.
- Kontajner `api` (`owi serve`): `../data:/data:ro` a navyše `../data/zapisy:/data/zapisy` na zápis. Výsledky (`owi.db`) ostávajú preň len na čítanie. Kontajner `owi` číta zápisy zo zdieľaného `data/`.
- Nový token `OWI_WRITE_TOKEN` (aspoň 32 znakov): v koreňovom `.env` (pre `api`) a vo Verceli (Production, sensitive). Čítací `OWI_SERVE_TOKEN` zapisovať nemôže a zapisovací nečíta. Bez `OWI_WRITE_TOKEN` zápis vracia 503.
- Jednorazový import `data/truth.csv` do `zapisy.db` (`owi entries import`); `owi calibrate` číta zo `zapisy.db`.

## Rozhranie `owi serve`

### `PUT /v1/entries/{day}`

`Authorization: Bearer <OWI_WRITE_TOKEN>`, telo JSON so siedmimi poľami; chýbajúce pole = `null`.

```json
{"steps": 23588, "distance_km": 17.9, "active_minutes": 210, "active_kcal": 980,
 "total_kcal": 2610, "sleep_score": 82, "energy_score": 76}
```

| Pole | Typ | Rozsah |
|---|---|---|
| `steps` | celé číslo | 0–100 000 |
| `distance_km` | číslo | 0–150 |
| `active_minutes` | číslo | 0–1 440 |
| `active_kcal` | číslo | 0–10 000 |
| `total_kcal` | číslo | 500–15 000 |
| `sleep_score` | číslo | 0–100 |
| `energy_score` | číslo | 0–100 |
| `{day}` | `YYYY-MM-DD` | od prvého uloženého dňa po dnešok (časové pásmo owi) |

- 200: uložený zápis (tvar `Entry` nižšie). Všetky polia `null` → zápis sa zmaže a vráti sa `Entry` s `null` poľami a `saved_at: null`.
- 400: `{"error": "invalid", "fields": {"sleep_score": "0–100", "day": "mimo rozsahu"}}` (správy po slovensky, krátke).
- 401: chýbajúci alebo zlý token; 503: `OWI_WRITE_TOKEN` nie je nastavený.

### `GET /v1/days` (doplnky)

- `days[].samsung`: `Entry | null`, kde `Entry = {"day", "steps", "distance_km", "active_minutes", "active_kcal", "total_kcal", "sleep_score", "energy_score", "saved_at"}`.
- `days[].scores.samsung_sleep` a `days[].scores.energy_score`: `Score` (`{"value", "components", "note"}`), nové polia v `DayScores`.
- Nové pole na najvyššej úrovni:

```json
"calibration": {
  "fitted_at": "2026-10-16T09:30:00+00:00",
  "entries": 12,
  "params":   {"stride_m": 0.76, "active_hr_delta": 27.0, "kcal_scale": 0.91, "basal_kcal": null},
  "defaults": {"stride_m": 0.74, "active_hr_delta": 30.0, "kcal_scale": 1.0, "basal_kcal": null},
  "quality": {
    "distance_km":    {"n": 10, "error": 4.1, "previous_error": 6.0, "unit": "%"},
    "active_minutes": {"n": 9,  "error": 12.0, "previous_error": 18.5, "unit": "%"},
    "active_kcal":    {"n": 9,  "error": 8.2, "previous_error": 9.0, "unit": "%"},
    "total_kcal":     {"n": 9,  "error": 3.0, "previous_error": 3.4, "unit": "%"},
    "sleep_score":    {"n": 12, "error": 5.5, "previous_error": null, "unit": "body"},
    "energy_score":   {"n": 12, "error": 7.0, "previous_error": null, "unit": "body"}
  }
}
```

Bez zápisov: `"calibration": {"fitted_at": null, "entries": 0, "params": <aktuálne>, "defaults": <...>, "quality": {}}`. Starý klient tieto polia ignoruje.

## Web

- Premenná `OWI_WRITE_TOKEN` len na serveri. Route handler `PUT /api/entries/[date]`: overí reláciu (401), pôvod požiadavky (rovnaký host, inak 403), rozsahy ako owi (400 s rovnakým tvarom `fields`), pošle ďalej do owi so zapisovacím tokenom a vráti jeho odpoveď. Token, URL ani telo odpovede owi sa nikdy nelogujú.
- Stránka **Zápis zo Samsungu** (`/zapis`, položka v menu Detaily „Zápis“): karta „Ako presne owi trafí Samsung“ z `calibration.quality` (odchýlka, počet zápisov, šípka zlepšenia), pod ňou zoznam ukončených dní za posledných 30 bez zápisu (od najnovšieho), každý ako rozbaľovacia kartička so siedmimi poľami (číselná klávesnica), vedľa poľa odhad owi; „Uložiť deň“ uloží, zbalí na „uložené ✓“ a otvorí ďalší. Uložené dni sa dajú otvoriť a opraviť, cez dátum sa dá skočiť na starší deň. Sleep Score patrí k noci, ktorá skončila v ten deň.
- Prehľad: nenápadný odkaz „N dní bez zápisu“ (posledných 30 ukončených dní), keď N > 0.
- Detaily: pri odhadoch vzdialenosti, aktívneho času a kalórií poznámka „doladené podľa N zápisov · odchýlka ± X %“, keď `calibration.entries > 0`.
- Spánok: prepínač skóre má tretiu možnosť **Samsung (odhad)** zo `scores.samsung_sleep`; pri `note == "learning"` text „učí sa, chýba ešte K zápisov“.
- Pripravenosť: karta **Energy Score (odhad)** vedľa Readiness, rovnako s „učí sa“.
- Detail dňa: ak má deň `samsung`, blok „Samsung a owi“ s číslami vedľa seba.
- Umelé dáta (`demo-data.ts`) dostanú `samsung`, nové skóre a `calibration`, aby web fungoval aj bez API.

## Testy a overenie

- owi: TDD, umelé dáta (`tests/factories.py`); zápis (rozsahy, tokeny, zmazanie), doladenie (stiahnutie, hranice, kontrola na nevidených dňoch, váhy dní), Samsung skóre (od 10 zápisov), prepočet po zmene parametrov.
- Web: unit testy validácie a route handlera (relácia, pôvod, chyby owi), logiky zoznamu chýbajúcich dní a kvality; build, lint; screenshoty s umelými dátami.
- Po integrácii: import `truth.csv`, skúšobný zápis cez API na skutočných dátach a jeho zmazanie, kontrola, že web po nasadení zapisuje.
- Žiadne skutočné zdravotné dáta, tokeny ani adresy v repe.

## Doplnok 2026-10-17: automatické zápisy zo Samsungu

Open Wearables 0.10.0 s priamym napojením na Samsung Health (provider `samsung`) posiela tri čísla samo. owi ich berie ako **automatické zápisy** (auto entries), aby používateľ menej písal.

| Pole zápisu | Odkiaľ | `DayFeatures` |
|---|---|---|
| `sleep_score` | `GET /api/v1/users/{id}/health-scores?category=sleep&provider=samsung`, stránkovanie `limit`/`offset` | `samsung_sleep_score` |
| `steps` | súčet série `steps` zo zdrojov s providerom `samsung` za lokálny deň | `samsung_steps` |
| `active_kcal` | súčet série `active_energy` zo zdrojov s providerom `samsung` za lokálny deň | `samsung_active_kcal` |

- Sleep Score patrí ku dňu, keď sa spánok skončil; `recorded_at` je jeho začiatok. Ak `event_record_id` zodpovedá spánku, ktorý owi stiahlo, rozhoduje koniec toho spánku, inak lokálny dátum `recorded_at + 12 h`. Skóre zdriemnutí sa vynechá. Ak na deň pripadnú dve, vyhráva skóre hlavného spánku (aj jeho kópie z iného zdroja, ktorú dedupe zahodil), inak najnovšie.
- Hodnota mimo rozsahov zápisu (napr. vzdialenosť uložená ako kalórie pri prvom sync) sa ignoruje.
- Polia sa plnia pri `owi sync`. Staršie uložené dni ich nemajú, kým sa neprepočítajú (`owi sync --from D`); starý JSON v `day_features` sa načíta s `null`.

**Zlúčenie** (`tuning.merge`), po dňoch: pole z ručného zápisu vyhráva; inak automatická hodnota doplní `sleep_score` v každý deň a `steps`, `active_kcal` len za ukončené dni. `distance_km`, `active_minutes`, `total_kcal` a `energy_score` ostávajú len ručné. Dolaďovanie aj odhad Samsung Sleep Score čítajú zlúčené zápisy; prah 10 zápisov počíta zlúčené.

- **Kedy:** podpis (`tuning.signature`) je počet zlúčených dní a hash ich hodnôt, uložený v novom stĺpci `signature` tabuľky `params_history`. Doladí sa pri zmene podpisu (uložený či zmazaný zápis, zmenená automatická hodnota), inak raz denne. Uloženie rovnakých čísel doladenie nespustí. Bez úložiska zápisov a zároveň bez automatických hodnôt sa nedolaďuje.
- **Referenčné dni** (znova stiahnutý minútový tep pre `kcal_scale`): ručné zápisy s aktívnym časom alebo kalóriami ako doteraz, automatické aktívne kalórie **len za posledných 28 dní** **[A]**. Má ich každý ukončený deň a stiahnuť rok dní pri každom doladení by trvalo minúty; 28 dní posunie koeficient asi o tri štvrtiny cesty k fitu (`n/(n+7)`). Staršie automatické kalórie sa pre `kcal_scale` nepoužijú; pre `basal_kcal` áno (bez sťahovania).

**API** `GET /v1/days`:
- `days[].samsung_auto`: `{"steps": int|null, "active_kcal": float|null, "sleep_score": float|null}`, alebo `null`, keď sú všetky `null`. `days[].samsung` (ručný zápis) sa nemení.
- `calibration.entries`: počet dní, ktoré posledné doladenie čítalo, teda s ručným zápisom alebo s automatickou hodnotou podľa pravidiel zlúčenia.

**Web:**
- `/zapis`: kroky, aktívne kalórie a Sleep Score s automatickou hodnotou sú vyplnené, len na čítanie, s poznámkou „automaticky zo Samsungu“, a v `PUT` idú ako `null` (owi ich dopĺňa samo). Deň bez ručného zápisu sa stále počíta medzi chýbajúce. Karta kvality ostáva.
- Spánok: tretia možnosť **Samsung**. Noc ukazuje skutočné `samsung_auto.sleep_score`, inak odhad `scores.samsung_sleep` so znakom ≈, inak „učí sa“. V grafe histórie sú odhady duté stĺpce s legendou, v tabuľkách majú ≈.
- Detail dňa: blok „Samsung a owi“ aj pre dni len s automatickými hodnotami, označenými „automaticky“; ručný zápis má prednosť.
- Umelé dáta: `samsung_auto` od 4. 10. 2026, zápisy v tie dni bez polí, ktoré Samsung poslal.

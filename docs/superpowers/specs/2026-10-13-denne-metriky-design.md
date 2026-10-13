# Denné metriky z Open Wearables – návrh

Dátum: 2026-10-13. Stav: schválené.

## Problém

Open Wearables zbiera surové dáta zo Samsung Health cez Health Connect a z priameho Samsung SDK. Jeho denné súhrny ale pre tieto dáta nesedia:

- dni delí podľa UTC, nie podľa lokálneho času,
- kroky berie z krokomera telefónu, hoci Samsung Health posiela presný denný súčet (telefón + hodinky),
- „aktívny čas“ ráta z počtu záznamov krokov, takže je nepoužiteľný,
- kalórie z aktivity, celkový výdaj a denná vzdialenosť neprichádzajú vôbec,
- tréningy z Health Connect nemajú tep ani kalórie, hoci surový tep počas nich je v dátach po sekundách.

## Cieľ

Samostatný program `owi`, ktorý zo surových dát cez API Open Wearables vypočíta denné hodnoty podľa lokálneho času a uloží ich do vlastnej databázy. Výsledky neskôr číta web a MCP.

Mimo rozsahu tejto fázy: web, MCP nad výsledkami, presun na PC, upgrade Open Wearables.

## Kritériá úspechu

- Kroky za deň sa rovnajú dennému súčtu zo Samsung Health, keď ho dáta obsahujú.
- Tréningy majú priemerný a maximálny tep z dát.
- Odhady (vzdialenosť, aktívny čas, kalórie) sú označené ako odhad a po kalibrácii na 7–10 dňoch sú typicky do 15 % od hodnôt v Samsung Health. Bez kalibrácie sa presnosť negarantuje.
- V repe nie sú žiadne osobné zdravotné dáta ani tajomstvá; testy bežia na umelých dátach.

## Zvolený prístup

Program stojí vedľa Open Wearables a číta len jeho verejné API. Zamietnuté alternatívy:

- úprava kódu Open Wearables: každý upgrade by znamenal prenášať vlastné zmeny,
- výpočet až vo webe: pomalé (tisíce vzoriek tepu na deň), bez histórie, nedostupné pre MCP.

## Architektúra

```
Open Wearables API ──► client ──► pipeline ──► store (SQLite) ──► web / MCP (neskôr)
                                    │
               days · steps · heart · estimates · workouts · sleep
                                    ▲
                              calibration (parametre odhadov)
```

Python 3.12+, správa cez `uv`, balík v `src/owi/`. Závislosti: `httpx`, `tzdata`. Ostatné zo štandardnej knižnice (`sqlite3`, `argparse`, `zoneinfo`, `dataclasses`).

### Moduly

| Modul | Zodpovednosť | Závisí od |
|---|---|---|
| `models` | dátové triedy: `Sample`, `SourceRef`, `Workout`, `SleepSession`, `DayInputs`, `DayResult`, `WorkoutResult`, `Params` | – |
| `config` | nastavenia z prostredia a `.env` | – |
| `client` | čítanie z API so stránkovaním; normalizácia názvov medzi verziami Open Wearables | `models`, `config` |
| `days` | okno lokálneho dňa v UTC, priradenie času k lokálnemu dňu (vrátane zmeny času) | – |
| `steps` | výber krokov z najlepšieho zdroja | `models`, `days` |
| `heart` | minútový rad tepu, pokojový tep, štatistiky, zóny | `models` |
| `estimates` | vzdialenosť, aktívny čas, kalórie; čisté funkcie nad `DayInputs` a `Params` | `models`, `heart` |
| `calibration` | načítanie referenčných hodnôt, ladenie `Params`, výpis chýb | `estimates` |
| `workouts` | deduplikácia a obohatenie tréningov o tep, zóny, vzdialenosť, odhad kalórií | `models`, `heart`, `estimates` |
| `sleep` | výber hlavného spánku dňa, deduplikácia medzi zdrojmi | `models`, `days` |
| `pipeline` | zloženie: stiahni → vypočítaj → `DayResult` | všetky vyššie |
| `store` | SQLite: tabuľky `daily` a `workouts`, zápis typu upsert | `models` |
| `cli` | príkazy `sync`, `day`, `calibrate`, `check` | `pipeline`, `store`, `calibration` |

Výpočtové moduly (`steps`, `heart`, `estimates`, `workouts`, `sleep`) sú čisté funkcie bez siete a bez databázy. Sieť je len v `client`, disk len v `store` a `calibration`.

## Výpočty

### Lokálny deň

Deň `D` v zóne `OWI_TIMEZONE` (predvolene `Europe/Bratislava`) je interval od lokálnej polnoci `D` po lokálnu polnoc `D+1`, prevedený do UTC. Pri zmene času má 23 alebo 25 hodín.

### Kroky

Kandidáti pre deň `D`:

1. **Denný súčet Samsung Health** – vzorka `steps` zo zdroja `com.sec.android.app.shealth` (provider `google` alebo `health_connect`) s lokálnym dátumom `D`. Samsung Health ju zapisuje s časom lokálnej polnoci začiatku dňa. Ak je ich viac, berie sa najvyššia.
2. **Samsung po hodinách** – súčet vzoriek `steps` providera `samsung` v okne dňa.
3. **Krokomer telefónu** – súčet ostatných vzoriek `steps` providera `google`/`health_connect` v okne dňa.

Použije sa kandidát s najvyššou hodnotou; pri zhode v poradí 1, 2, 3. Výsledok nesie označenie zdroja. Maximum chráni pred čiastočne zosynchronizovaným súčtom.

### Tep

- Minútový rad: priemer všetkých vzoriek `heart_rate` v danej minúte.
- Pokojový tep: najnižší 30-minútový kĺzavý priemer minútového radu; ak deň nemá 30 súvislých minút, 5. percentil; ak má menej než 60 minút dát, `None`.
- Priemer a minimum z minútového radu, maximum zo surových vzoriek.
- Maximálny tep používateľa: `OWI_MAX_HR`, inak najvyššie denné maximum z uložených dní za posledných 180 dní (najviac 210), inak 190.
- Zóny podľa podielu z maximálneho tepu: ľahká 50–70 %, stredná 70–85 %, vysoká od 85 %. Výsledok v minútach.

### Odhady

Parametre (`Params`) majú predvolené hodnoty a dajú sa naladiť kalibráciou.

- **Vzdialenosť** = kroky × `stride_m` (predvolene 0,74 m).
- **Aktívna minúta**: minúta v intervale tréningu, alebo minúta s tepom aspoň `pokojový tep + active_hr_delta` (predvolene 30).
- **Kalórie z aktivity**: súčet cez aktívne minúty podľa rezervy tepu:
  - `podiel = (tep − pokojový) / (maximálny − pokojový)`, orezané na 0–1,
  - `VO2 = 3,5 + podiel × (VO2max − 3,5)` ml/kg/min,
  - `kcal za minútu = (VO2 − 3,5) × váha / 1000 × 5`,
  - výsledok × `kcal_scale` (predvolene 1,0).
- **Bazálny výdaj**: posledná vzorka `basal_energy` (kcal/deň) do daného dňa; inak `OWI_BASAL_KCAL`; inak `None`. Pre neúplný deň pomerná časť podľa uplynutého času.
- **Spálené spolu** = bazálny výdaj + kalórie z aktivity.

Váha a VO2max sú posledné vzorky `weight` a `vo2_max` do daného dňa; inak `OWI_WEIGHT_KG` a `OWI_VO2MAX`. Ak chýba tep, váha alebo VO2max, kalórie sú `None`. Ak nie je známy pokojový tep, aktívne sú len minúty tréningov a kalórie sú `None`.

### Kalibrácia

Referenčné hodnoty zo Samsung Health sú v CSV mimo gitu (`data/truth.csv`): `date,steps,active_minutes,activity_kcal,total_kcal,distance_km`. Prázdne pole znamená neznámu hodnotu.

Ladenie nad dňami, ktoré majú referenciu aj dáta:

1. `stride_m` = súčet referenčných vzdialeností / súčet referenčných krokov.
2. `active_hr_delta` = hodnota z rozsahu 5–60, ktorá minimalizuje súčet absolútnych odchýlok aktívneho času.
3. `kcal_scale` = súčet referenčných kalórií z aktivity / súčet odhadov pri `kcal_scale = 1`.

Parametre sa uložia do `data/params.json`. Príkaz `check` vypíše pre každý referenčný deň odhad, referenciu a odchýlku v percentách.

### Tréningy

- Patria ku dňu podľa lokálneho času začiatku.
- Deduplikácia: rovnaký typ a začiatok do 2 minút sa považuje za ten istý tréning; prednosť má `google`/`health_connect` pred `samsung`.
- Tep (priemer, maximum, minimum) a zóny zo surových vzoriek v intervale tréningu.
- Vzdialenosť: z API, ak je; inak vzorka `distance_walking_running` zo zdroja Samsung Health s časom do 60 sekúnd od začiatku tréningu.
- Odhad kalórií rovnakým vzorcom ako pri dennej aktivite.

### Spánok

- Spánok patrí ku dňu podľa lokálneho času prebudenia.
- Deduplikácia prekrývajúcich sa záznamov: prednosť má `google`/`health_connect`, potom dlhší.
- Hlavný spánok je najdlhší; ukladá sa začiatok, koniec, trvanie a fázy. Ostatné sa sčítajú do `nap_minutes`.

## Úložisko

SQLite súbor `data/owi.db`.

- `daily`: jeden riadok na lokálny deň – kroky a ich zdroj, vzdialenosť, aktívny čas, kalórie, tep, zóny, spánok, príznak `complete`, čas výpočtu.
- `workouts`: jeden riadok na tréning (kľúč je ID z Open Wearables).

Zápis prepisuje existujúci riadok. Odhadované stĺpce majú v názve príponu `_est`: `distance_m_est`, `active_minutes_est`, `activity_kcal_est`, `total_kcal_est` a pri tréningoch `kcal_est`.

## Príkazy

| Príkaz | Čo robí |
|---|---|
| `owi sync [--days N] [--from D --to D] [--loop SEKUNDY]` | prepočíta dni a uloží ich; predvolene posledné 3 dni |
| `owi day D [--json]` | vypíše uložený deň |
| `owi calibrate` | naladí parametre podľa `data/truth.csv` |
| `owi check` | porovná odhady s referenčnými hodnotami |

## Nastavenie

Premenné prostredia alebo `.env` (v gite je len `.env.example`):

`OWI_API_URL`, `OWI_API_KEY`, `OWI_USER_ID` (voliteľné; ak má inštancia jedného používateľa, zistí sa sám), `OWI_TIMEZONE`, `OWI_DATA_DIR`, `OWI_MAX_HR`, `OWI_WEIGHT_KG`, `OWI_VO2MAX`, `OWI_BASAL_KCAL`.

## Chyby

- API neodpovedá alebo vráti chybu: beh skončí s chybovým kódom a nič neprepíše.
- Deň bez dát: uloží sa riadok s prázdnymi hodnotami a `complete = false` len pre dnešok; staršie prázdne dni sa neukladajú.
- Dnešný deň má vždy `complete = false`.
- Posledné tri dni sa prepočítajú pri každom behu, lebo telefón dáta dosiela.

## Kompatibilita verzií Open Wearables

`client` prijíma oba názvy providera (`google`, `health_connect`) aj série (`energy`, `active_energy`). Stránkovanie ide cez `cursor` s limitom 100.

## Beh

Docker kontajner `owi` v samostatnom compose súbore v tomto repe. Beží `owi sync --loop 1800`, dáta má vo zväzku, na API sa pripája cez sieť Open Wearables.

## Testy

- Každý výpočtový modul má jednotkové testy na umelých dátach.
- `client` sa testuje proti falošnému HTTP transportu.
- `store` proti dočasnému súboru.
- `pipeline` má jeden test od falošného API po `DayResult`.
- Kontrola voči skutočným dátam je príkaz `check`, nie test.

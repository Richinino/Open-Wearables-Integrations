# Skóre v owi – návrh

Dátum: 2026-10-14. Stav: schválené. Vzorce a zdroje: [`docs/skore.md`](../../skore.md); prehľad dát: [`docs/ako-to-funguje.md`](../../ako-to-funguje.md).

## Cieľ

`owi` k denným hodnotám dopočíta skóre a sprístupní ich cez `owi serve`, aby ich web mohol zobraziť. Web sa rieši v samostatnom kroku.

## Rozhodnutia používateľa

- **Spánok:** hlavné číslo **Sleep Performance** (WHOOP), na karte prepínač na **Sleep Score** (Apple). **Potreba spánku** (WHOOP) je samostatný údaj.
- **Pripravenosť (Readiness):** Oura bez HRV a teploty, označená ako odhad.
- **Aktivita:** Oura Activity.
- **Strain dňa:** WHOOP, 0–21.
- **Stav záťaže:** Polar Cardio Load.
- **Varovanie:** NightSignal, neskôr aj ako upozornenie do telefónu.
- **Dlhodobé:** VO2max (z hodiniek a Uth–Sørensen) a WHOOP Age.
- **Skóre dňa** = priemer Readiness, Sleep Performance a Activity; pri červenom varovaní najviac 50.
- Na hlavných kartách len názvy („Sleep Performance“, „Readiness“), výrobca až v detaile.

## Odchýlky od výrobcov (A = naša voľba)

- **Deň** je lokálny kalendárny deň, nie WHOOP cyklus od zaspatia po zaspatie (A: zhodné so zvyškom owi).
- **Vek pod 18:** potreba spánku 8–10 h namiesto 7–9 h (NSF 14–17 rokov, AASM 13–18 rokov). Týka sa WHOOP potreby spánku a Oura bilancie spánku.
- **Zóny pre WHOOP Age:** podiel rezervy tepu, 50–80 % = zóny 1–3, ≥ 80 % = zóny 4–5 (A, WHOOP zóny sú na rezerve tepu).
- **Pohlavie** určuje konštanty TRIMP a strainu; bez neho sa použijú mužské (A).

## Architektúra

Dva stupne. Dátové štruktúry sú v `src/owi/score_models.py` a sú záväzné pre všetky moduly.

1. **Znaky dňa** (`features.py`): z `DayInputs` a `DayResult` jedného dňa vznikne `DayFeatures`. Potrebuje referenčný pokojový tep (14-dňový priemer `sleep_rhr` z uložených dní; bez histórie `hr_resting` dňa).
2. **Skóre** (`scoring.py`): z uložených `DayFeatures` (najstaršie prvé, posledný = počítaný deň) a skóre predošlého dňa vznikne `DayScores`.

| Modul | Funkcie | Vlastník |
|---|---|---|
| `load.py` | `hr_reserve`, `trimp`, `strain_load`, `strain_from_load`, `cardio_load` | agent A |
| `features.py` | `extract(inputs, result, person, rest_hr) -> DayFeatures` | agent A |
| `client.py`, `models.py` | čítanie `sleep_stage_intervals` z API do `SleepSession.intervals` | agent A |
| `sleep_scores.py` | `sleep_need_minutes`, `sleep_performance`, `apple_sleep_score`, `sleep_regularity_index` | agent B |
| `readiness.py` | `readiness`, `night_signal` | agent C |
| `activity_score.py` | `activity_score` | agent C |
| `longterm.py` | `vo2max_uth`, `whoop_age` | agent C |
| `store.py`, `scoring.py`, `pipeline.py`, `cli.py`, `serve.py` | uloženie znakov a skóre, výpočet po synchronizácii, príkaz `owi rescore`, skóre v `/v1/days` | integrácia po A–C |

**Potreba spánku** sa ukladá ku dňu ako potreba na nasledujúcu noc. Sleep Performance dňa D = spánok, ktorý skončil v deň D, oproti potrebe uloženej pri dni D−1.

## Uloženie a API

- SQLite: nové tabuľky `day_features` a `day_scores` (deň, JSON, čas výpočtu). Existujúce tabuľky ostávajú.
- `GET /v1/days`: každý deň dostane objekt `scores` (tvar `DayScores`, dátumy a časy ako ISO). Ostatné polia sa nemenia.
- `owi rescore [--from D --to D]` prepočíta znaky aj skóre z uložených dát bez sťahovania; `owi sync` po uložení dní prepočíta ich skóre.

## Testy a overenie

- Každý modul má vlastný testovací súbor, len umelé dáta (`tests/factories.py`), postup TDD.
- Žiadne reálne zdravotné dáta, kľúče ani adresy v repe.
- Po integrácii beh na skutočných dátach: skóre v rozumných rozsahoch, chýbajúca história vráti `None` s poznámkou, nie nulu.

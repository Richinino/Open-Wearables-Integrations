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
- **Neodmerané dni:** deň s menej ako 1 000 minútami tepu sa nepočíta do stavu záťaže (nie je to deň bez záťaže) a ukončený taký deň nemá strain ani Activity. Stav záťaže potrebuje aspoň 4 odmerané dni zo 7 a 14 z 28 (A).
- **Bdelý pokojový tep pre MET a Uth VO2max:** medián 10. percentilu tepu v bdelých minútach mimo tréningov za deň a 14 dní pred ním, bez neho nočný základ (A; rezerva tepu zodpovedá rezerve VO2 len od bdelého pokojového tepu, nočné minimum nafukovalo MET). Uložený ako `awake_hr_p10` a `awake_rest_hr` v `DayFeatures`. Strain a TRIMP ostávajú na nočnom základe ako WHOOP.
- **NightSignal:** nočný tep z minút spánku v 00:00–07:00 (aspoň 60) namiesto minút bez krokov, ktoré nemáme po minútach; bdenie pri neskorom zaspávaní ho už nezvyšuje (A).
- **WHOOP Age:** súčet dopadov metrík sa násobí faktorom prekryvov 0,45 (A, nafitované na štyri typické profily z tabuľky 2 white paperu; WHOOP svoju úpravu nezverejňuje).

## Architektúra

Dva stupne. Dátové štruktúry sú v `src/owi/score_models.py` a sú záväzné pre všetky moduly.

1. **Znaky dňa** (`features.py`): z `DayInputs` a `DayResult` jedného dňa vznikne `DayFeatures`. Potrebuje referenčný pokojový tep (14-dňový priemer `sleep_rhr` z uložených dní; bez histórie `hr_resting` dňa). `DayInputs` nesie navyše tep od začiatku nočného spánku pred polnocou (pre `sleep_rhr`) a dnešný večerný spánok, ktorý končí až zajtra (minúty v ňom nie sú bdenie). `DayResult` z nich nečerpá a ostáva bez zmeny.
2. **Skóre** (`scoring.py`): z uložených `DayFeatures` posledných 180 dní (najstaršie prvé, posledný = počítaný deň) a uložených skóre predošlých 14 dní vznikne `DayScores`. Medián „všetkých predošlých nocí“ pre NightSignal a základ potreby spánku tak siahajú najviac 180 dní dozadu.

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

- SQLite: nové tabuľky `day_features` a `day_scores` (deň, JSON, čas výpočtu). Existujúce tabuľky ostávajú; starú databázu `owi serve` číta ďalej, len bez skóre.
- `GET /v1/days`: každý deň dostane objekt `scores` (tvar `DayScores`, dátumy a časy ako ISO; `null`, kým deň nemá skóre) a `sleep_timeline` (fázy hlavného spánku a zdriemnutí, `[]` bez spánku). Každý tréning dostane `strain` (`null`, ak chýba). Ostatné polia sa nemenia.
- `owi sync` po uložení dní uloží ich znaky a prepočíta skóre od najskoršieho zmeneného dňa po posledný uložený deň (skóre na seba nadväzujú), aj keď neskoršia dávka zlyhá.
- `owi rescore [--from D --to D]` prepočíta len skóre z uložených znakov, nič nesťahuje. Nové znaky dá len `owi sync`.
- Profil pre skóre: vek a pohlavie z `.env` (`OWI_AGE`, `OWI_SEX`), maximálny tep podľa rovnakého pravidla ako zvyšok owi (nastavený, z kalibrácie, inak najvyšší uložený), váha a telesný tuk posledné známe zo znakov. Výšku žiadny vzorec nepoužíva, preto sa neukladá.

## Testy a overenie

- Každý modul má vlastný testovací súbor, len umelé dáta (`tests/factories.py`), postup TDD.
- Žiadne reálne zdravotné dáta, kľúče ani adresy v repe.
- Po integrácii beh na skutočných dátach: skóre v rozumných rozsahoch, chýbajúca história vráti `None` s poznámkou, nie nulu.

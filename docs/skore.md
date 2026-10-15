# Skóre – vzorce a zdroje

Dátum: 2026-10-14. Podklad pre výpočet skóre v `owi` a pre web. Zhrnutie rešerše vedeckých zdrojov a postupov veľkých výrobcov (WHOOP, Oura, Apple, Garmin/Firstbeat, Polar, Fitbit/Google, Coros, Samsung).

## Ako čítať značky

| Značka | Pôvod konštanty |
|---|---|
| **V** | uvádza výrobca (návod, blog, oznámenie) |
| **P** | z patentu výrobcu |
| **WP** | z white paperu výrobcu |
| **RE** | spätne odvodené tretími stranami (meranie proti aplikácii) |
| **PUB** | vedecká publikácia alebo oficiálne odporúčanie |
| **A** | naša voľba, s dôvodom |

Žiadny výrobca nezverejňuje úplný vzorec. Pri každom skóre preto platí: zložky s V/P/WP sú najvernejšie, výsledné váhy sú väčšinou A alebo RE. Na webe preto vždy ukazujeme aj zložky, nielen súčet.

## Dáta

| Máme | Nemáme |
|---|---|
| tep cca raz za minútu, počas tréningu po sekundách; pokojový tep; max. tep | HRV (variabilita tepu) |
| kroky po hodinách a za deň, vzdialenosť | dýchaciu frekvenciu |
| tréningy (typ, čas, tep, niekedy vzdialenosť) | teplotu kože |
| spánok s úplným priebehom fáz, zdriemnutia | výkon (watty), tempo |
| váha, výška, telesný tuk, VO2max z hodiniek, občas SpO2 | vek a pohlavie (treba doplniť do `.env`) |

Kvôli chýbajúcemu HRV sú skóre regenerácie (WHOOP Recovery, Oura Readiness, Garmin Body Battery) len odhady; HRV v nich nahrádza nočný pokojový tep. Na webe ich označujeme ako odhad.

## 1. Spoločné základy

**Rezerva tepu** (Karvonen): `r = clamp((HR − HRrest) / (HRmax − HRrest), 0, 1)`.

- `HRrest` pre záťaž: priemer nočného pokojového tepu za 14 dní **[V, WHOOP]**.
- `HRmax`: najvyšší pozorovaný tep z tréningov bez ojedinelých výkyvov **[RE]**; kým nie je, Tanaka `208 − 0,7·vek` **[PUB, Tanaka 2001, SEE ≈ 10 bpm]**.

**Nočný pokojový tep** (pre regeneráciu): najnižší 5-min kĺzavý priemer tepu počas hlavného spánku **[A, podľa Oura/WHOOP]**; minúty s krokmi v predošlých 12 min sa vynechajú **[PUB, Mishra 2020]**.

**Banister TRIMP** za minútu: `Δt·r·k·e^(c·r)`, muži `k = 0,64, c = 1,92`, ženy `k = 0,86, c = 1,67` **[PUB; Polar a Google ho používajú, V]**. 60 min pri r = 0,6 ≈ 73, pri r = 0,75 ≈ 122; Polar uvádza 70–130 za hodinu **[V]**.

**Kĺzavý priemer (EWMA)** s časovou konštantou τ dní: `X_d = X_{d−1} + (1 − e^(−1/τ))·(L_d − X_{d−1})` **[PUB, Banister; GoldenCheetah]**.

**Odhad MET z tepu**: `MET = 1 + r·(VO2max/3,5 − 1)` **[A, %HRR ≈ %VO2R, Swain]**. `HRrest` je tu **bdelý** pokojový tep: medián 10. percentilu tepu v bdelých minútach mimo tréningov (deň aspoň 300 takých minút) za počítaný deň a 14 dní pred ním; bez neho nočný základ **[A]**. Swainov vzťah platí len od pokojového tepu v bdelom stave; nočné minimum robilo z bežného sedenia strednú aktivitu.

**Pravidelnosť spánku (SRI)**: minútový vektor spánok/bdenie; `SRI = 200·(zhodné páry 24 h od seba / platné páry) − 100`; zdriemnutia sa rátajú ako spánok; čas bez nameraného tepu je chýbajúci, nie bdenie **[PUB, Phillips 2017; Fischer 2021]**. UK Biobank: medián 81, kvintily 71,7 / 78,6 / 83,2 / 87,3 **[PUB, Windred 2024]**.

## 2. Záťaž a aktivita

### WHOOP Strain (0–21) – rekonštrukcia

- Stupnica 0–21 podľa Borga; pásma 0–9 ľahký, 10–13 stredný, 14–17 vysoký, 18–21 maximálny **[V]**. Strainy sa nesčítavajú **[V]**. Deň trvá od zaspatia po ďalšie zaspatie **[V]**.
- Kotvy: hodina chôdze ≈ 6,5, hodina behu ≈ 12,0, bežný deň člena ≈ 11 **[V]**.

Výpočet:

1. Za každú bdelú minútu `v = r` (rezerva tepu) **[P, US9750415B2]**.
2. Váha `w = 0` pre `v < 0,25`, inak `v·e^(b·v)`, `b = 1,92` muži / `1,67` ženy **[A, tvar Banistera, patent povoľuje „piecewise-exponential“]**.
3. Svalová záťaž bez tepu: `+ k·trvanie`, `k = 0,6/min` silový, funkčný, HIIT; `0,3/min` joga, pilates **[A, WHOOP odhaduje „podľa typu a trvania“, V]**.
4. `L = Σ w·Δt_min + svalová záťaž`.
5. `Strain = min(21, A·ln(1 + L/L0))`, muži `A = 4,05, L0 = 10,3`; ženy `A = 4,45, L0 = 11,4` **[A, nafitované na kotvy V]**.

Overenie: deň so štyrmi jazdami predpovedá 19,5–20,1, namerané 20,1; dodatočná prechádzka +0,07, namerané +0,1 **[RE, the5krunner 2025]**. Dôvera: stredná pre poradie a tvar, ±1,5–2 body v absolútnej hodnote.

### Polar Cardio Load a stav záťaže – presne podľa výrobcu

- Záťaž tréningu = Banister TRIMP **[V/WP]**.
- `strain = priemer dennej záťaže za 7 dní`, `tolerance = priemer za 28 dní` **[V]**.
- `pomer = strain / tolerance`: < 0,8 detréning (alebo zotavovanie, ak bol v posledných 14 dňoch preťažený), 0,8–1,0 udržiavanie, 1,0–1,3 produktívny, > 1,3 preťaženie **[V]**. Potrebuje 3 tréningy za 28 dní **[V]**.
- Deň s menej ako 1 000 minútami tepu je neodmeraný, nie deň bez záťaže: do priemerov sa nepočíta; treba aspoň 4 odmerané dni zo 7 a 14 z 28 **[A]**.
- Úroveň tréningu oproti priemernému tréningu za 90 dní: < 0,5 veľmi nízka, 0,5–0,75 nízka, 0,75–1,25 stredná, 1,25–2 vysoká, ≥ 2 veľmi vysoká **[V]**.

Dôvera: vysoká.

### Apple Training Load

- `námaha` 1–10 z priemernej rezervy tepu tréningu, po častiach lineárne cez body (0,20 → 1), (0,40 → 3,5), (0,60 → 6,5), (0,85 → 8,5), (0,95 → 10) **[A; DC Rainmaker zistil, že námaha závisí len od priemerného tepu, RE]**.
- `záťaž tréningu = námaha × minúty` **[RE]**.
- `odchýlka = (súčet 7 dní / 7) / (súčet 28 dní / 28) − 1`; pásma: ≤ −50 % výrazne pod, −49 až −21 % pod, ±20 % stabilne, +21 až +49 % nad, ≥ +50 % výrazne nad **[V/RE]**.

### Garmin Load Ratio, Coros Intensity Trend

- Garmin: akútna = `7·EWMA(τ = 7)`, chronická = `7·EWMA(τ = 28)`; pomer < 0,8 nízky, 0,8–1,4 optimálny, 1,5–1,9 vysoký, ≥ 2 veľmi vysoký **[V pásma, A konštanty]**.
- Coros: Base Fitness = `EWMA(τ = 42)`, Load Impact = `EWMA(τ = 7)`, Intensity Trend = pomer; ≥ 150 % nadmerný, 100–149 % optimalizovaný, 80–99 % udržiavanie, 50–79 % návrat, < 50 % pokles **[V]**. Coros TRIMP: `minúty·r·0,2445·e^(3,411·r)` **[RE, DC Rainmaker]**.
- Klasický ekvivalent: CTL = `EWMA(τ = 42)`, ATL = `EWMA(τ = 7)`, forma TSB = CTL − ATL **[PUB, Coggan/TrainingPeaks]**.

### Minúty v zónach a odporúčania

- Fitbit Active Zone Minutes: stredná 40–59 % rezervy, intenzívna 60–84 %, špička ≥ 85 %; stredná minúta = 1, intenzívna a špička = 2; cieľ 150 za týždeň **[V]**.
- WHO 2020: 150–300 min stredne alebo 75–150 min intenzívne týždenne **[PUB]**.
- AHA Life's Essential 8, body za minúty aspoň stredne intenzívnej aktivity týždenne: 0 → 0, 1–29 → 20, 30–59 → 40, 60–89 → 60, 90–119 → 80, 120–149 → 90, ≥ 150 → 100 **[PUB, Lloyd-Jones 2022]**.
- Kroky (Tudor-Locke): < 5 000 sedavý, 5 000–7 499 málo aktívny, 7 500–9 999 čiastočne aktívny, 10 000–12 499 aktívny, ≥ 12 500 veľmi aktívny **[PUB]**. Prínos k úmrtnosti sa vyrovnáva okolo 8 000–10 000 krokov pod 60 rokov **[PUB, Paluch 2022]**.

### Oura Activity (0–100) – rekonštrukcia

Zložky a prahy **[V]**: neaktívny čas (≤ 5–8 h dobré, > 12 h zlé), pohyb každú hodinu (upozornenie po 50 min nečinnosti), plnenie denného cieľa 6–7 dní z 7, tréningová frekvencia 3–4 dni so ≥ 100 MET-min strednej a vyššej intenzity, objem 2 000 MET-min týždenne (pod 750 klesá), 1–2 ľahké dni týždenne (≤ 15 min vysokej a ≤ 85 min strednej+vysokej intenzity).

Bodovanie zložiek a váhy sú **[A]**: cieľ 0,25, neaktívny čas 0,20, objem 0,15, frekvencia 0,15, pohyb každú hodinu 0,10, odpočinok 0,15. Dôvera: nízka až stredná.

### Kalórie

- Keytel 2005 (kJ/min, platí pre tréning, nie pre pokoj) **[PUB]**:
  - s VO2max: `−59,3954 + muž·(−36,3781 + 0,271·vek + 0,394·kg + 0,404·VO2max + 0,634·HR) + žena·(0,274·vek + 0,103·kg + 0,380·VO2max + 0,450·HR)`;
  - kcal = kJ / 4,184.
- Bazálny výdaj Mifflin-St Jeor: `10·kg + 6,25·cm − 5·vek + 5` (muži), `− 161` (ženy); z beztukovej hmoty `19,7·FFM + 413` **[PUB]**.

## 3. Spánok

### Apple Sleep Score (0–100) – odporúčané

- Rozdelenie **[V]**: dĺžka 50 b, pravidelnosť zaspávania 30 b (posledných 13 nocí), prerušenia 20 b. Pásma 0–40 veľmi nízke, 41–60 nízke, 61–80 v poriadku, 81–95 vysoké, 96+ veľmi vysoké **[V]**.
- Dĺžka: `d = max(0, 470 − TST_min)`; `50 − min(50, 13·(d/120)^2,4) − 5·[hlboký < 10 %] − 5·[REM < 15 %]` **[RE the5krunner, exponent a prahy A]**.
- Pravidelnosť: `Δ = zaspatie − kruhový medián 13 predošlých`; `30 − [Δ > 15]·min(30, (Δ − 15)/4,5) − [Δ < −60]·min(6, (−Δ − 60)/30)` **[RE]**.
- Prerušenia: `20 − min(20, max(0, WASO − 11)/4 + max(0, prebudenia − 2)/2)` **[RE]**; prebudenie = úsek bdenia ≥ 1 min **[A]**.

Dôvera: stredná až vysoká.

### WHOOP Sleep Performance a potreba spánku

- `Potreba = B + 60·1,7/(1 + e^((17 − Strain_včera)/3,5)) min + D − zdriemnutia` **[P, US12318226B2; overené na ukážke z WHOOP API: 7,62 h / 7,76 h = 98 %, V]**.
  - `B` = základ 7,5 h; po 60 nociach 75. percentil spánku po dňoch so strainom < 10, obmedzené na 7–9 h **[A, WHOOP ráta základ z dní s nízkou záťažou, P]**.
  - `D = min(120, 0,5·max(0, potreba_včera − TST_včera))` min **[A]**.
  - Strain 10 → +12 min, 14 → +30 min, 18 → +58 min.
- `Sleep Performance = 100·min(1, TST / potreba)` **[V/P]**.
- Pásma: ≥ 85 optimálne, 70–85 dostačujúce, < 70 slabé; pravidelnosť ≥ 80; efektivita ≥ 90 % **[V]**.

Použitie: číslo „potrebuješ dnes X h Y min“ na webe.

### Ostatné skóre spánku (porovnanie)

| Skóre | Zloženie | Dôvera |
|---|---|---|
| Open Wearables (už počíta) | dĺžka 40 % (7–9 h = 100, sigmoid pod a nad), fázy 20 % (hlboký a REM, cieľ 90 min), pravidelnosť 20 % (medián zaspatia za 14 nocí, tolerancia 15 min), prerušenia 20 % (WASO nad 20 min, prebudenia > 5 min) **[zdrojový kód]** | presné |
| Polar Sleep Score | priemer 6 zložiek; maximum pri ≥ 8 h, 0 min dlhých prerušení, súvislosti 5/5, ~100 % spánku, REM 25 %, hlboký ~17 % **[WP]** | stredná |
| Oura Sleep | 7 zložiek; 7–9 h, efektivita 85 %, REM ≥ 90 min, hlboký 15–20 %, zaspávanie 15–20 min, stred spánku 00:00–03:00 **[V]**; krivky a váhy **[A]** | stredná až nízka |
| Fitbit/Google | 6 metrík, prebudenia > 5 min (0 ideál, < 2 dobré) **[V]**; váhy neznáme | nízka |
| Samsung | fázy, pohyb, prebudenia; váhy neznáme | dá sa nafitovať z exportu Samsung Health |

### Vedecké referenčné hodnoty

- Dĺžka (AHA LE8, body za priemer na noc): < 4 h → 0, 4–5 → 20, 5–6 → 40, 6–7 → 70, 7–9 → 100, 9–10 → 90, ≥ 10 → 40 **[PUB]**.
- Kvalita (NSF, Ohayon 2017, dospelí 26–64): efektivita ≥ 85 % dobrá, ≤ 74 % zlá; WASO ≤ 20 min dobré, ≥ 41 min zlé; prebudenia > 5 min 0–1 dobré, ≥ 4 zlé **[PUB]**.
- Nepravidelnosť (Huang 2020): SD dĺžky > 120 min → riziko KVO 2,14×; SD zaspávania > 90 min → 2,11× **[PUB]**.
- Hodinky Galaxy Watch 5 zachytia len 48 % bdenia v noci, takže WASO a prebudenia podhodnocujú; efektivita je takmer bez chyby **[PUB, Lee 2023]**.

## 4. Regenerácia

### Oura Readiness bez HRV a teploty – odporúčané

Zložky (každá 0–100, krivky z patentu US10842429B2 **[P]**):

| Zložka | Výpočet | Váha **[RE]** |
|---|---|---|
| Spánok | `Z = (100·TST_24h/9h − 85)/7,5`; `85 + 12,5·Z` | 0,25 |
| Pokojový tep | `Z = (RHR − μ60)/max(σ60, 2)`; `87,5 − 30·Z` pre `Z > −1`, inak `116 + 16·Z` | 0,20 |
| Bilancia aktivity | `100 − 60·|0,25 + AB/AD|` (14-dňový vážený priemer aktívnych kcal − 60-dňový, deleno σ) | 0,15 |
| Bilancia spánku | `85 + 30·SB/SD` (vážený deficit za 14 nocí, váhy `0,9^i` **[A]**) | 0,11 |
| Včerajšia aktivita | `85 − 6·(Z_kcal + Z_vysoká intenzita + Z_neaktívne hodiny)` | 0,11 |
| Index zotavenia | `Z = (hodiny spánku po nočnom minime tepu − 5)/1`; `85 + 15·Z` | 0,10 |
| Pravidelnosť spánku | SRI za 14 dní; `100` pri SRI ≥ 85, inak `100 − 2·(85 − SRI)` **[A]** | 0,05 |

Výsledok = vážený priemer, každá zložka orezaná na 0–100. Pásma 85+ optimálne, 70–84 dobré, 60–69 slabšie, < 60 pozor **[V]**. Oura: pokojový tep o 3–5 bpm vyšší alebo o 10–15 bpm nižší než zvyčajne znižuje skóre **[V]** – krivka to spĺňa. Dôvera: stredná; chýbajúce HRV a teplota tvoria asi 17 % váhy.

### WHOOP Recovery – odhad

`z = 0,65·zRHR + 0,25·zSpánok + 0,10·zStrain`; `Recovery = 100/(1 + e^−(1,06·z + 0,32))`; z = 0 → 58 % (priemer členov), ±1 → 80 % / 32 % **[A, pásma 67/34 V]**. Dôvera: nízka až stredná; WHOOP sám uvádza, že väčšinu výpovede nesie HRV.

### Varovanie pred chorobou alebo preťažením (NightSignal)

Nočný tep `A` = priemer tepu 00:00–07:00 z minút bez krokov **[PUB]**; owi berie minúty spánku (fázy okrem bdenia, záznam bez fáz celý), aspoň 60, lebo kroky po minútach nemáme a bdenie pri neskorom zaspávaní by tep zvyšovalo **[A]**; základ `M` = medián všetkých predošlých nocí. Zelená `A < M + 3`, žltá `A = M + 3`, červená `A ≥ M + 4` bpm dve noci po sebe **[PUB, Alavi 2022, Nature Medicine]**. Bežné kolísanie pokojového tepu je ±3 bpm (SD 3,0) **[PUB, Quer 2020, 92 457 ľudí]**.

### Ďalšie (len pre porovnanie)

- **Garmin Body Battery** (0–100, nabíja spánok a pokoj, vybíja námaha a stres): rýchlosti nabíjania nikde nezverejnené; naša verzia je celá **[A]**, cieľ +45 až +65 za noc. Dôvera: nízka.
- **Polar Nightly Recharge**: `ANS = clamp(2·z, −10, 10)` z priemerného tepu prvých 4 h spánku oproti 28 dňom **[V štruktúra, A konštanty]**; tep má v ňom najväčšiu váhu **[V]**.
- **Samsung Energy Score**: vstupy spánok (7-dňový priemer, pravidelnosť, načasovanie), včerajšia aktivita (koncept ACWR), nočný tep a HRV **[V]**; váhy personalizované AI. Dá sa nafitovať, ak si zapíšeš skóre z aplikácie aspoň 30 dní.

## 5. Dlhodobé ukazovatele

- **VO2max podľa Uth–Sørensena**: `15,3·HRmax/HRrest` **[PUB, chyba 4,5 % pri nameranom HRmax]** – kontrola odhadu z hodiniek. `HRrest` = bdelý pokojový tep ako pri MET **[A]**; nočné minimum ho nadhodnocovalo.
- **WHOOP Age / Healthspan**: 9 metrík za 6 mesiacov (dĺžka a pravidelnosť spánku, kroky, minúty v zónach 1–3 a 4–5, silový tréning, VO2max, pokojový tep, podiel svalovej hmoty); dopad metriky `10·ln(HR)` rokov, kde HR je pomer rizika **[WP]**; úprava prekryvov nezverejnená, owi násobí súčet dopadov faktorom 0,45 nafitovaným na štyri typické profily z tabuľky 2 **[A]**. Ciele pre 30-ročného: 7–9 h, pravidelnosť ≥ 70 %, 8 000 krokov, zóny 1–3 ≥ 100 min a 4–5 ≥ 10 min týždenne, sila ≥ 40 min, VO2max muži > 44, pokojový tep muži < 60 **[WP]**. Dôvera: nízka.

## 6. Návrh pre web

| Na webe | Výpočet | Dôvera |
|---|---|---|
| **Skóre dňa** (0–100) | priemer troch častí nižšie, rovnaké váhy **[PUB: tak to robia LE8 aj väčšina kompozitných indexov podľa OECD/JRC]**; pri červenom NightSignal najviac 50 **[A]** | podľa častí |
| **Spánok** (0–100) | Apple Sleep Score | stredná až vysoká |
| **Regenerácia** (0–100) | Oura Readiness bez HRV a teploty, označená ako odhad | stredná |
| **Aktivita** (0–100) | Oura Activity | nízka až stredná |
| **Strain dňa** (0–21) | WHOOP Strain | stredná |
| **Potreba spánku** | WHOOP | stredná až vysoká |
| **Stav záťaže** (týždeň) | Polar Cardio Load status | vysoká |
| **Varovanie** | NightSignal | publikované |

Skóre regenerácie sa ukazuje až po 14 nociach, porovnania s priemerom po 7 dňoch **[A, výrobcovia 7–14]**. Dni s menej ako 1 000 minútami nameraného tepu sa do základov nerátajú **[PUB, Radin 2020]**.

## Zdroje

**Patenty a white papers výrobcov**
- WHOOP: US9750415B2, US11574722B2, US20220108782A1 (strain), US12318226B2 (potreba spánku), WO2024129679A2 (stres); white paper Healthspan 2025; developer.whoop.com
- Oura: US10842429B2 (readiness); support.ouraring.com (readiness, sleep, activity)
- Firstbeat/Garmin: US10674959B2 (training status), US7192401 (EPOC); white papers EPOC, Training Effect, Stress and Recovery
- Polar: white papers Training Load Pro, Nightly Recharge, Sleep Plus Stages, Recovery Pro
- Apple: support.apple.com/128112, sprievodca Apple Watch (Sleep Score, Training Load)
- Google/Fitbit: support.google.com/fitbit/answer/14237938, 15402655, 14236513, 14236710
- Coros: support.coros.com, coros.com/stories (recovery metrics)

**Spätné odvodenie a testy**
- the5krunner (WHOOP strain 2022 a 2025, Apple Sleep Score 2025, Garmin body battery, recovery time, sleep score)
- DC Rainmaker (Apple Training Load, Garmin Forerunner, Coros, Fitbit Readiness)
- SciTePress 2025 (váhy Oura Readiness z regresie na 12 používateľoch)

**Vedecké**
- Phillips 2017 (SRI), Fischer 2021, Windred 2024; Huang 2020 (JACC); Ohayon 2017 (NSF); Lloyd-Jones 2022 (Life's Essential 8)
- Alavi 2022 (Nature Medicine, NightSignal); Mishra 2020; Quer 2020; Radin 2020
- Banister TRIMP (Morton 1990), Coggan (PMC), Williams 2017 (EWMA ACWR) a kritika Impellizzeri 2020
- Tanaka 2001; Uth 2004; Keytel 2005; Mifflin 1990; Tudor-Locke 2008; Paluch 2022; WHO 2020; Lee 2023 (presnosť Galaxy Watch)

# Ako to funguje

Stav k 2026-10-15. Čo zbierame, z akých zdrojov, čo z toho presne počítame a čo len odhadujeme. Vzorce skóre sú zvlášť v [`skore.md`](skore.md).

Konkrétne počty záznamov a dátumy pre tvoj účet sú len lokálne v `data/prehlad-dat.md` (mimo gitu).

## Cesta dát

```
hodinky a telefón Samsung
   │  Samsung Health zapisuje do Health Connect
   ▼
appka Open Wearables v telefóne ──► Tailscale Funnel (HTTPS) ──► Open Wearables v Dockeri (notebook, neskôr PC)
                                                                      │  surové dáta v Postgrese
                                                                      ▼
                                                     owi (každých 30 min prepočíta posledné 3 dni)
                                                                      │  denné výsledky v data/owi.db
                                                                      ▼
                                       owi serve (len čítanie, token) ──► Funnel /owi ──► web (Vercel) ──► prehliadač
```

- **Open Wearables** prijíma dáta z telefónu, ukladá ich a ponúka ich cez API aj MCP (pre Claude).
- **owi** z nich ráta denné hodnoty podľa slovenského času.
- **Web** zobrazuje výsledky `owi`; heslo a token má len server, prehliadač nie.

## Zdroje

| Zdroj | Čo to je | Čo z neho máme |
|---|---|---|
| **Samsung Health cez Health Connect** (`com.sec.android.app.shealth`) | Samsung Health zapisuje dáta z hodiniek do Health Connect, appka OW ich odtiaľ číta | tep (hustý), spánok s fázami, tréningy, denný súčet krokov, vzdialenosť tréningov, SpO2, VO2max, váha, výška, telesný tuk, bazálny výdaj |
| **Krokomer telefónu cez Health Connect** (`com.android.healthconnect.phone…`) | Health Connect sám počíta kroky telefónu | kroky v intervaloch, vzdialenosť, kalórie |
| **Samsung Health priamo** (provider `samsung`) | priame napojenie appky OW na Samsung Health | dlhá história spánku a riedkeho tepu z hodiniek, hodinové kroky, váha, výška; tréningy neposlal |
| **Iné appky cez Health Connect** | napr. appka na stravu | občas váha a telesný tuk |

**Poradie zdrojov v Open Wearables:** Health Connect = 1, Samsung priamo = 2. Pri prekryve vyhráva Health Connect, lebo má hustejší tep.

**Odporúčanie:** v appke nechať zapnutý hlavne Health Connect. Priame napojenie na Samsung pri prvej synchronizácii uložilo vzdialenosť ako kalórie (opravené ručne v databáze), čo by sa mohlo zopakovať.

## Aké dáta máme

| Údaj | Odkiaľ | Hustota | Na čo ho používame |
|---|---|---|---|
| Tep | Health Connect | cca raz za minútu, v tréningu po sekundách | pokojový tep, zóny, aktívny čas, kalórie, tep tréningov, záťaž a regenerácia |
| Kroky | Samsung Health (denný súčet), Samsung priamo (po hodinách), telefón | denne / po hodinách | kroky dňa, vzdialenosť |
| Spánok | Health Connect (od začiatku používania OW), Samsung priamo (staršia história) | každá noc, s fázami | dĺžka, fázy, časy, zdriemnutia, pravidelnosť |
| Tréningy | Health Connect | každý tréning | typ, čas, tep, zóny, vzdialenosť |
| Vzdialenosť | Samsung Health (pri tréningu), telefón | pri tréningoch / v intervaloch | vzdialenosť tréningov |
| VO2max | Samsung Health | občas | odhad kalórií, kondícia |
| Váha, výška, telesný tuk | Samsung Health, iné appky | zriedka (pri meraní) | kalórie, bazálny výdaj, neskôr zloženie tela |
| SpO2 | Samsung Health | občas | zatiaľ nepoužívame |

**Nemáme:** HRV (variabilitu tepu), dýchaciu frekvenciu, teplotu kože, svalovú hmotu. Open Wearables by ich vedel prijať (pozná napr. `HEART_RATE_VARIABILITY`, `RESPIRATORY_RATE`, `SKELETAL_MUSCLE_MASS`, `BODY_TEMPERATURE`), ale Samsung Health ich do Health Connect neposiela. Či by ich priniesol Samsung Health SDK, treba overiť.

## Čo počítame presne

Pre každý deň podľa slovenského času (polnoc–polnoc, `Europe/Bratislava`):

| Údaj | Ako |
|---|---|
| **Kroky** | Najvyššia z troch hodnôt: denný súčet zo Samsung Health (záznam o lokálnej polnoci), súčet hodinových krokov zo Samsungu, súčet krokomera telefónu. Pri čísle je uvedený zdroj. |
| **Tep** | Priemer za každú minútu. Pokojový tep = najnižší 30-minútový kĺzavý priemer dňa (bez súvislej polhodiny 5. percentil, pod hodinu dát nič). K tomu minimum, priemer, maximum. |
| **Zóny** | Minúty podľa % maximálneho tepu: ľahká 50–70 %, stredná 70–85 %, vysoká ≥ 85 %. Maximálny tep = nastavený, inak z kalibrácie, inak najvyšší pozorovaný (strop 210). |
| **Spánok** | Prekrývajúce sa záznamy z dvoch zdrojov sa zlúčia (vyhráva Health Connect, potom dlhší). Hlavný spánok dňa + zdriemnutia. Minúty v hlbokom, REM, ľahkom spánku a bdení. |
| **Tréningy** | Rovnaký typ so začiatkom do 2 min = jeden tréning (vyhráva Health Connect). Tep a zóny z minútového tepu počas tréningu. Vzdialenosť zo záznamu Samsung Health v čase začiatku. |

## Čo odhadujeme

Samsung Health tieto hodnoty počíta sám a nikam ich neposiela, takže ich len približujeme. V databáze majú stĺpce s príponou `_est`, na webe znak ≈.

| Údaj | Ako |
|---|---|
| **Vzdialenosť** | kroky × dĺžka kroku |
| **Aktívny čas** | minúty v tréningu + minúty s tepom aspoň o *prah* nad pokojovým |
| **Kalórie z aktivity** | za každú aktívnu minútu: podiel rezervy tepu × (VO2max − 3,5) × váha × 5 kcal na liter O₂, vynásobené *koeficientom* |
| **Kalórie spolu** | bazálny výdaj + kalórie z aktivity (bazál zo Samsung Health, alebo z nastavenia) |
| **Kalórie tréningu** | to isté len za minúty tréningu |

**Kalibrácia:** dĺžka kroku, prah tepu a koeficient kalórií sa ladia príkazom `owi calibrate` podľa hodnôt, ktoré pre konkrétne dni ukazuje Samsung Health (súbor `data/truth.csv`). Čím viac dní, tým presnejšie; zatiaľ sú naladené dva dni.

## Skóre

Vzorce v [`skore.md`](skore.md), návrh v [`superpowers/specs/2026-10-14-skore-design.md`](superpowers/specs/2026-10-14-skore-design.md). Počítajú sa v dvoch krokoch: `owi sync` z každého dňa uloží **znaky dňa** (tabuľka `day_features`) a z nich prepočíta **skóre** (tabuľka `day_scores`) od prvého zmeneného dňa dopredu, lebo skóre na seba nadväzujú. `owi rescore` prepočíta skóre zo znakov bez sťahovania.

| Kedy | Čo | Podľa |
|---|---|---|
| ráno | **Readiness** (regenerácia) | Oura Readiness bez HRV a teploty, ako odhad; po 14 nociach a len po zaznamenanej noci |
| ráno | **Sleep Performance** (hlavné číslo), **Sleep Score** (prepínač) | WHOOP, Apple |
| ráno | **Pravidelnosť spánku** | Sleep Regularity Index za 14 dní |
| ráno | **Activity** (včerajšok a týždeň) | Oura Activity |
| večer | **Strain dňa** aj tréningov (0–21) | WHOOP |
| večer | **Potreba spánku na nasledujúcu noc** | WHOOP |
| týždeň | **Stav záťaže** | Polar Cardio Load; po 28 dňoch |
| kedykoľvek | **Varovanie pred chorobou alebo preťažením** | NightSignal (nočný tep o ≥ 4 bpm nad normálom dve noci po sebe) |
| denne | **Skóre dňa** | priemer Readiness, Sleep Performance a Activity (aspoň dvoch z nich); pri červenom varovaní najviac 50 |
| dlhodobo | **VO2max** (hodinky a Uth–Sørensen), **WHOOP Age** | Samsung, WHOOP white paper |

Web ich dostane cez `owi serve` ako `scores` pri každom dni, k tomu `sleep_timeline` (fázy spánku) a `strain` pri tréningoch.

**Vek 17 rokov:** odporúčania pre spánok sú pre tínedžerov iné ako pre dospelých, 8–10 h (National Sleep Foundation pre 14–17 rokov, AASM pre 13–18 rokov). Výrobcovia pracujú s dospelými hodnotami okolo 7–9 h, preto je spodná hranica potreby spánku 8 h.

**Dni bez dát:** deň s menej ako 1 000 minútami tepu (hodinky neboli nosené alebo sa tep neprenášal) sa nerátá do základov ani do stavu záťaže a ukončený taký deň nemá strain ani Activity. Chýbajúca hodnota je vždy `null` s poznámkou, nikdy nula.

## Kde čo beží

| Čo | Kde |
|---|---|
| Open Wearables (API, databáza, admin portál) | Docker na notebooku, `localhost:8000` a `:3000` |
| owi (prepočet) a owi serve (API pre web) | Docker, kontajnery `owi-owi-1` a `owi-api-1`, API na `127.0.0.1:8787` |
| Verejná adresa | Tailscale Funnel: `/` pre telefón, `/owi` pre web |
| Web | priečinok `web/`, lokálne `npm run dev -- -p 3100`; na Vercel zatiaľ nenasadený |

Po reštarte notebooku treba spustiť Docker Desktop a appku Tailscale; kontajnery potom nabehnú samy.

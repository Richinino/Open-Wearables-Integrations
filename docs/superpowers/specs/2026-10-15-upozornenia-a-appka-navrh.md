# Upozornenia do telefónu a vlastná appka – návrh

Dátum: 2026-10-15. Stav: **návrh, čaká na schválenie**.

## Čo chceme

- Upozornenie, ktoré sa ozve samo, keď NightSignal hlási červenú (nočný tep o ≥ 4 bpm nad normálom dve noci po sebe).
- Neskôr aj ranné zhrnutie (Readiness, Sleep Performance) a večerné (Strain dňa, potreba spánku).
- Vlastná appka pre Samsung (APK), nahraná z Android Studia cez USB.

## Možnosti

| | Ako | Výhody | Nevýhody |
|---|---|---|---|
| **A – vlastná appka (odporúčam)** | Android appka v Kotline: hore web v okne appky, na pozadí každých 15–60 min stiahne `owi` API a pri červenej pošle upozornenie priamo v telefóne | žiadna tretia strana ani Firebase; dáta idú len medzi telefónom a domácim serverom; z tej istej appky časom vyrastie plnohodnotná appka | treba ju postaviť a udržiavať; Android môže kontroly na pozadí odkladať (šetrenie batérie) |
| B – ntfy | malý server ntfy v Dockeri, `owi` naň pošle správu, appka ntfy z obchodu ju zobrazí | rýchle, bez vlastnej appky | ďalšia verejná adresa a ďalšia appka; nie je to „tvoja“ appka |
| C – web push | web na Verceli ako PWA s push notifikáciami | bez appky | najviac pohyblivých častí; funguje až po nasadení na Vercel |

## Návrh A podrobnejšie

1. **Obsah appky:** prvá verzia zobrazí web v okne appky (WebView), takže všetko, čo je na webe, je hneď aj v appke. Neskôr sa dajú pridať natívne obrazovky alebo widget na plochu.
2. **Kontrola na pozadí:** WorkManager raz za 15–60 min zavolá `GET /owi/v1/days?from=<včera>` s tokenom. Ak má dnešok `scores.night_signal.level == "red"` a pre tento deň ešte upozornenie nebolo, ukáže upozornenie „Zvýšený nočný tep dve noci po sebe – zváž oddych“.
3. **Token:** zadáš ho raz v nastaveniach appky; uloží sa šifrovane v telefóne (EncryptedSharedPreferences). V kóde ani v gite nebude.
4. **Ranné a večerné zhrnutie:** voliteľné upozornenia o zvolenom čase.
5. **Zdrojový kód:** priečinok `android/` v repe, bez tajomstiev. Ladiaca verzia sa nahrá cez USB z Android Studia.

## Riziká

- **NordVPN:** telefón zatiaľ preloží adresu `ts.net` len so zapnutým NordVPN. Kontroly na pozadí by bez neho zlyhali. Treba to vyriešiť (napr. nastavením DNS) ešte pred appkou.
- **Šetrenie batérie:** Samsung niekedy uspí appky na pozadí. Appku treba v nastaveniach batérie vyňať z optimalizácie.

## Na rozhodnutie

1. Ideme cestou A (vlastná appka)?
2. Má appka v prvej verzii len zobrazovať web, alebo chceš rovno natívne obrazovky?
3. Ktoré upozornenia okrem varovania chceš (ranné, večerné, iné)?

# Overenie Android v0.1.0 — 21. 10. 2026

## Výsledky

- Android: zostavenie hlavného a testovacieho APK úspešné, 38 JVM testov bez zlyhania.
- Emulátor Android 16 / API 36.1: 15 testov obrazoviek, tém a Keystore bez zlyhania. Použité iba syntetické účty a merania.
- Android lint: 0 chýb, 10 upozornení a 1 odporúčanie. Zostávajú odporúčania aktualizovať závislosti/target API a upraviť štýl Kotlin/Compose kódu.
- Web: 653 testov, ESLint, TypeScript a produkčné zostavenie úspešné.
- Skutočný HTTP test s izolovaným Python backendom a zostaveným Next serverom: 94 kontrol bez zlyhania. Zahŕňa oddelenie účtov, zneplatnenie relácie, čakajúci účet, kontrolu Origin a odhlásenie.
- Mobilné API nasadené na `https://zdravie-rho.vercel.app`. Overené HTTP 405 pre GET prihlasovacej route, HTTP 401 pre neprihlásenú reláciu a odmietnutie syntetických neplatných prihlasovacích údajov v kandidátnom nasadení. Skutočné používateľské heslo sa pri testoch nepoužilo.
- Samostatné review a následné overenie opráv: tolerancia odchýlky hodín, označovanie odhadov, časové pásmo tréningov, systémové lišty podľa témy a konfigurácia záloh.

Plná sada v emulátore prešla pred posledným doplnením deklaratívnych pravidiel záloh. Následné zostavenie, JVM testy a lint overili aj finálny manifest a XML pravidlá.

## Limity a ďalší krok

APK je vývojová verzia podpísaná lokálnym Android debug kľúčom. Pre bežné vydávanie a stabilné aktualizácie treba samostatný trvalý podpisový kľúč. Kľúče nie sú súčasťou Git repozitára. Balíček a jeho SHA-256 sa lokálne ukladajú do ignorovaného `artifacts/android/`.

Fyzický telefón zatiaľ nebol pripojený. Prvé overenie na vlastnom telefóne: nainštalovať APK, prihlásiť sa existujúcim účtom, porovnať najnovší deň s webom, obnoviť dáta, prepnúť históriu a odhlásiť sa. Zapamätané prihlásenie sa dá overiť po zatvorení a opätovnom otvorení aplikácie. Obrazovky čakajúceho účtu, chyby a zmeny identity sú pokryté automatizovane.

Podporované minimum je API 26. Vetva farby navigačnej lišty pre API 26–28 má JVM kontrolu kontrastu a podmienené instrumentované overenie; na staršom emulátore zatiaľ nebola spustená.

Health Connect zber, offline história, upozornenia a widgety sú mimo prvej verzie. Dáta naďalej zbiera existujúci Open Wearables klient. Profil, registrácia a obnova hesla sa otvárajú vo webovom prehliadači, ktorý používa vlastnú prihlasovaciu reláciu.

# Zdravie pre Android

Natívny klient v Kotline a Jetpack Compose. Prihlasuje sa existujúcim účtom Zdravie cez `https://zdravie-rho.vercel.app`; spoločné serverové tokeny a podpisové kľúče zostávajú na serveri.

Na bežnú inštaláciu použi [najnovšie podpísané vydanie](https://github.com/Richinino/Open-Wearables-Integrations/releases/latest). Od verzie 0.1.1 appka ponúka nové verzie priamo v aplikácii: stiahnuť, odložiť a potvrdiť inštaláciu cez Android. Pôvodnú 0.1.0 treba raz aktualizovať týmto APK cez existujúcu appku, bez odinštalovania. Postup a automatické vydávanie sú v [príručke aktualizácií](../docs/mobile/android-releases.md).

Prvá verzia obsahuje prihlásenie, stav čakajúceho účtu, prehľad meraní, graf histórie za 14/30 dní, detail dňa a tréningov, profil a odhlásenie. Podporuje svetlý/tmavý vzhľad a preferované skóre spánku. Správa profilu, registrácia a obnova hesla otvoria existujúci web v prehliadači.

Zobrazuje dáta, ktoré už do servera posiela Open Wearables. Zber cez Health Connect, widgety, upozornenia a offline história v tejto verzii ešte nie sú zahrnuté. Namerané hodnoty majú prednosť; odhadované hodnoty a približná Readiness sú označené. Chýbajúci údaj sa nezobrazuje ako nula.

## Zostavenie

Potrebuješ JDK 21 a Android SDK (compile API 37, build tools 36). Aplikácia beží od Androidu 8 / API 26; cieľové API je 36. Gradle wrapper má overený kontrolný súčet distribúcie. Verzie AGP, Kotlinu a Compose sú pevne uvedené v Gradle súboroch.

V Android Studiu otvor tento priečinok. Alebo v PowerShelli z koreňa repozitára:

```powershell
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA/Android/Sdk"
./android/gradlew.bat -p android :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK vznikne v `app/build/outputs/apk/debug/app-debug.apk`. Ide o vývojový balíček s lokálnym debug podpisom. Verejné vydania zostavuje samostatný release workflow s trvalým podpisom; heslá ani súkromné podpisové kľúče sa neukladajú do repozitára. Vlastný debug/fork balíček môže aktualizovať iba APK podpísané rovnakým kľúčom.

Vlastný server a repozitár aktualizácií nastavíš vlastnosťami Gradle `-PapiBaseUrl=https://tvoj-server.example -PupdateRepository=owner/repository`. Pri forku treba zodpovedajúce nastavenie použiť aj v release workflow.

Testy obrazoviek a úložiska v emulátore:

```powershell
./android/gradlew.bat -p android :app:connectedDebugAndroidTest
```

Používajú výhradne syntetické účty a údaje. Zostavenie, jednotkové testy a Android lint sú zapojené aj do GitHub kontrol.

Výsledky prvej verzie a kroky na overenie v telefóne sú v [zázname overenia](../docs/mobile/android-v1-verification.md).

## Účty a uloženie

API pre mobil je popísané v [spoločnom rozhraní](../docs/mobile/android-v1-contract.md). Každé načítanie overuje aktuálnu reláciu a identitu odpovede. Zneplatnená relácia, zmena párovania alebo nesúlad identity vymažú načítané údaje. Po odhlásení sa oneskorená odpoveď nezobrazí pod iným účtom.

Heslo sa neukladá. Zdravotné dáta zostávajú iba v pamäti. Voliteľne zapamätaná relácia je šifrovaná cez Android Keystore a vylúčená zo záloh; odhlásenie ju odstráni. Aplikácia používa bežné overovanie HTTPS certifikátov a nesleduje presmerovania s prihlasovacími údajmi.

Manifest vypína zálohy aj explicitnými pravidlami pre cloud a prenos medzi Android zariadeniami. Konfigurácia zodpovedá [pravidlám Android Auto Backup](https://developer.android.com/identity/data/autobackup#xml-changes).

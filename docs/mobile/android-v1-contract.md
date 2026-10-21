# Natívna Android aplikácia Zdravie — prvá verzia

Používateľ 21. 10. 2026 zvolil vlastnú appku Zdravie a natívne Android obrazovky. Existujúci web a účty zostávajú zdrojom identity a vypočítaných dát. Integrácia Health Connect sa rozhoduje osobitne; prehľad, prihlasovanie a grafy od nej nezávisia.

## Spoločné rozhranie

- Produkčný server aplikácie: `https://zdravie-rho.vercel.app`. Appka neobsahuje spoločné API tokeny ani podpisový kľúč servera.
- `POST /api/mobile/login`: JSON `{ email: string, password: string, remember: boolean }`. Použije existujúce limity pokusov a prihlásenie účtu. Úspech nastaví existujúcu bezpečnú cookie `owi_session` a vráti `{ account, identity, expiresAt, persistent }`. `expiresAt` je čas Unix v milisekundách; account a identity majú existujúce webové typy. Bez hesla alebo tokenu v tele odpovede.
- `GET /api/mobile/session`: čerstvo overená relácia a rovnaký tvar odpovede. Neprihlásený/zneplatnený účet: 401. Nedostupný backend: 503. Mobilné API neponúka prezeranie iného účtu.
- `POST /api/mobile/logout`: zruší cookie, odpoveď 204. JSON a dôveryhodný Origin (ak existuje) chránia mutácie; natívny klient neposiela Origin. Žiadne široké CORS pravidlá.
- Dáta používa už existujúce `GET /api/data`: cookie a `x-zdravie-identity` z overenej relácie. Úspech musí mať rovnakú identitu aj v hlavičke odpovede. Pri nesúlade 409 sa dáta zahodia. Server stále vyberá používateľa.
- Všetky mobilné odpovede majú `Cache-Control: private, no-store`. Chybové telo: `{ error: string, message: string }`, prípadne retry interval. Nekopírovať detaily backendu ani tajomstvá.

## Android rozdelenie práce

- Kotlin, Jetpack Compose, Material 3; balíček `sk.zdravie.app`, minimum API 26. UI v `android/app/src/main/java/sk/zdravie/app/ui/`; root vlastní Gradle, manifest, dáta, sieť, bezpečné uloženie a spustenie.
- UI vstup: `@Composable fun ZdravieApp(state: AppUiState, onLogin: (String, String, Boolean) -> Unit, onLogout: () -> Unit, onRefresh: () -> Unit, onOpenWeb: (String) -> Unit)`.
- Modely v `sk.zdravie.app.model` vlastní root. `AppUiState(loading: Boolean = false, session: AppSession? = null, days: List<DaySummary> = emptyList(), syncedAt: String? = null, error: String? = null, refreshing: Boolean = false, hasLoaded: Boolean = false)`.
- `AppSession(account: Account, identity: AccountIdentity, expiresAt: Long, persistent: Boolean)`; `Account(id: String, firstName: String, lastName: String?, email: String, role: String, status: String, paired: Boolean, hasSamsung: Boolean, theme: String)`.
- `AccountIdentity(actorId: String, dataAccountId: String, viewOnly: Boolean, sessionVersion: Long)`.
- `DaySummary(day: String, complete: Boolean, steps: Long?, distanceMeters: Double?, activeMinutes: Double?, sleepMinutes: Double?, sleepScore: Double?, readiness: Double?, activityScore: Double?, restingHr: Double?, hrvMs: Double?, hrvKind: String?, workouts: List<WorkoutSummary>, distanceSource: String?, restingHrSource: String?, sleepScoreEstimated: Boolean, timezone: String?)`. Časové pásmo sa overuje zo serverového dňa alebo datasetu a používa sa aj pre časy tréningov. Odhady aktívneho času, vzdialenosti, pokojového tepu a dopočítaného Samsung skóre majú označenie `≈` podľa pôvodu.
- `WorkoutSummary(id: String, type: String, start: String, durationSeconds: Double?, distanceMeters: Double?, averageHr: Double?)`.
- UI: prihlásenie, čakanie na spárovanie, prehľad, história s natívnym grafom a detailom dňa, profil/odhlásenie. Slovenčina, žltá/fialová značka, svetlá/tmavá/systémová téma podľa účtu. Chýbajúce čísla nie sú nula. Readiness je označená ako približná. Prázdna história a nedostupný server majú konkrétny stav a opakovanie.
- Heslo iba v pamäti; nikdy nie saved state/log. Bez zdravotných dát na disku v prvej verzii. Zapamätaná relácia šifrovaná kľúčom Android Keystore, bez zálohovania. Odhlásenie alebo zmena identity okamžite vyčistí pamäť; oneskorená odpoveď starého účtu sa nesmie zobraziť.

## Overenie

Zostavenie APK, Android lint, účelové testy parsovania/identity/uloženia a mobilného API. Emulátor používa iba syntetické účty a dáta. Prvé prihlásenie skutočným heslom a povolenia telefónu dokončuje používateľ.

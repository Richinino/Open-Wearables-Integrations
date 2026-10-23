# Android redizajn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appka Zdravie 0.2.0 ukáže takmer všetko, čo web, vo vzhľade A2 „Nočný panel“, a vyjde ako aktualizácia cez existujúci updater.

**Architecture:** Celý `GET /api/data` sa načíta do modelu `Dataset`, ktorý zodpovedá `web/src/lib/types.ts`. Pravidlá, ktoré web počíta v prehliadači, sa prenesú 1:1 do čistého Kotlinu v balíku `sk.zdravie.app.logic` a overia sa testami prenesenými z webu. Obrazovky v Compose kreslia výhradne výsledky týchto funkcií. Balík 1 (`/api/insights`, `/api/journal`) je voliteľný: appka ho zistí za behu a bez neho bloky skryje.

**Tech Stack:** Kotlin, Jetpack Compose (BOM 2026.09.00), Material 3, OkHttp 4.12, org.json, JUnit 4, MockWebServer, Compose UI test.

**Spec:** `docs/superpowers/specs/2026-10-23-android-redizajn-design.md`. **Dizajn:** plátno https://claude.ai/artifact/3zVcKhgnWSX8uCHvRogaTV, stránka „Android“, artboardy `AndroidDnesRano`, `AndroidDnesVecer`, `AndroidSpanok`, `AndroidAktivita`, `AndroidTrendy`, `AndroidUcet` a `AndroidPrihlasenie`. Ich zdrojové `.dc.html` dostane každý UI task priložené. Rozmery, farby a texty sa z nich preberajú presne.

## Global Constraints

- **Miesto práce:** worktree `C:\Users\richa\Open-Wearables-Integrations-android` na vetve `claude/android-redizajn` z `38d655b`. Hlavný strom obsahuje necommitnutú prácu Codexu, ktorej sa nikto nedotýka. Commituj vždy len vymenované cesty, nikdy `git add -A`.
- **Platforma:** Kotlin a Compose, balíček `sk.zdravie.app`, minSdk 26, targetSdk 36. Nové závislosti sú zakázané, okrem tých, ktoré task výslovne menuje.
- **Build** (PowerShell, z koreňa worktree): `$env:JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'; $env:ANDROID_HOME="$env:LOCALAPPDATA/Android/Sdk"; ./android/gradlew.bat -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`.
- **Súkromie:** zdravotné dáta len v pamäti, nič na disk. Heslo nikdy do stavu ani logu. Zmena identity alebo odhlásenie zahodí dataset aj stav obrazoviek, ako dnes.
- **Chýbajúce a odhadnuté hodnoty:** chýbajúca hodnota sa ukáže ako `–` (`DASH`), nikdy ako 0. Odhad sa zobrazí cez `approx()` („≈ “). Readiness je vždy označená ako približná.
- **Zhoda s webom:** rovnaký vstup dá rovnaké číslo a text ako `web/src/lib`. Ak sa Kotlin a TS líšia, platí TS. Appka nepočíta žiadne skóre.
- **Texty:** po slovensky, presne ako v artboardoch a webových funkciách (vety zo `scores.ts`, `overview.ts`, `latest-day.ts`).
- **Tokeny:** presne podľa tabuľky v spece (sekcia Vizuál), tmavý aj svetlý režim. Písma: Urbanist (300, 400, 500, 600, 700) a DM Mono (400, 500) ako TTF v `res/font` spolu s `OFL.txt`.
- **Ovládanie:** dotykové plochy ≥ 48 dp, kontrast textu ≥ 4,5 : 1, grafy majú `contentDescription`.
- **Testy:** výhradne syntetické dáta. Repo je verejné: žiadne skutočné hodnoty, mená, e-maily ani ID účtov.
- **Commit:** každý commit končí riadkami `Co-Authored-By: <model agenta> <noreply@anthropic.com>` a `Claude-Session: https://claude.ai/code/session_01PVwyLrh9NhEi3xtT3oyMsY`.

## Review Focus

1. **Staršie dni bez `scores` alebo s čiastočnými poliami** (prvé dni histórie, rozbehnutý dnešok): obrazovky ukážu `–` alebo konkrétny prázdny stav, nespadnú a nevymyslia hodnotu. Test v Task 8 a Task 11.
2. **Jedna chybná hodnota v jednom dni** (neznámy enum, text namiesto čísla, záporná hodnota tam, kde nemá byť): zahodí sa len táto hodnota a zvyšok dňa aj datasetu ostane. Test v Task 1.
3. **Preferencia `samsung` bez `samsung_auto` a so skóre „learning“:** zobrazí sa stav učenia (`learningText`), nie „≈ –“. Test v Task 5 a Task 9.
4. **Iné časové pásmo telefónu než datasetu** (cestovanie): dni, časy spánku a tréningov sa počítajú v pásme datasetu. Test v Task 2 a Task 8.
5. **Balík 1 vráti 404, 503 alebo 409:** pri 404 bloky zmiznú. Pri 503 sa ukáže tichá nedostupnosť bloku a zvyšok obrazovky ostane. `409 session_changed` sa správa ako zmena relácie, `409 revision_conflict` ponechá rozpísaný formulár. Test v Task 6.

---

### Task 1: Model celého datasetu a jeho parser

**Files:**
- Create: `android/app/src/main/java/sk/zdravie/app/model/Dataset.kt`
- Create: `android/app/src/main/java/sk/zdravie/app/data/DatasetParser.kt`
- Modify: `android/app/src/main/java/sk/zdravie/app/data/ZdravieApi.kt` (`DatasetResult` nesie aj `dataset`)
- Modify: `android/app/src/main/java/sk/zdravie/app/model/Models.kt` (`AppUiState.dataset: Dataset? = null`)
- Modify: `android/app/src/main/java/sk/zdravie/app/controller/SessionController.kt` (uloží `dataset` do stavu)
- Test: `android/app/src/test/java/sk/zdravie/app/data/DatasetParserTest.kt`, rozšíriť `DataFixtures.kt`

**Interfaces:**
- Produces (všetky ďalšie tasky), balík `sk.zdravie.app.model`. Dni sú ISO reťazce `YYYY-MM-DD` ako na webe, časy sú `java.time.Instant`.
  ```kotlin
  enum class ValueSource { MEASURED, DERIVED, ESTIMATED }
  enum class SleepStage { DEEP, REM, LIGHT, AWAKE, ASLEEP }
  /** A device-or-estimate field that newer servers send; null on Day = field absent (older response). */
  data class Selected(val value: Double?, val source: ValueSource?)
  data class SleepInterval(val start: Instant, val end: Instant, val stage: SleepStage)
  data class Workout(val id: String, val day: String, val type: String, val start: Instant, val end: Instant,
      val durationS: Double?, val source: String?, val hrAvg: Double?, val hrMax: Double?, val hrMin: Double?,
      val zoneLightMin: Double?, val zoneModerateMin: Double?, val zoneVigorousMin: Double?,
      val distanceM: Double?, val kcalEst: Double?, val strain: Double?)
  data class Score(val value: Double?, val components: Map<String, Double?>, val note: String?)
  data class CardioLoad(val strain7d: Double?, val tolerance28d: Double?, val ratio: Double?, val status: String?)
  data class NightSignal(val level: String?, val nightHr: Double?, val baseline: Double?, val delta: Double?)
  data class DayScores(val day: String, val strain: Double?, val cardioLoad: CardioLoad, val sleepNeedMinutes: Double?,
      val sleepPerformance: Score?, val appleSleep: Score?, val sleepRegularity: Double?, val readiness: Score?,
      val activity: Score?, val nightSignal: NightSignal, val dayScore: Double?, val vo2max: Double?,
      val vo2maxUth: Double?, val whoopAge: Score?, val samsungSleep: Score?, val energyScore: Score?)
  data class SamsungAuto(val steps: Double?, val activeKcal: Double?, val sleepScore: Double?)
  data class Day(val day: String, val timezone: String, val complete: Boolean, val steps: Double?,
      val stepsSource: String?, val distanceMEst: Double?, val activeMinutesEst: Double?,
      val activityKcalEst: Double?, val basalKcal: Double?, val totalKcalEst: Double?,
      val distance: Selected?, val activeKcal: Selected?, val totalKcal: Selected?, val restingHr: Selected?,
      val hrv: Selected?, val hrvKind: String?, val hrResting: Double?, val hrAvg: Double?, val hrMax: Double?,
      val hrMin: Double?, val zoneLightMin: Double?, val zoneModerateMin: Double?, val zoneVigorousMin: Double?,
      val sleepStart: Instant?, val sleepEnd: Instant?, val sleepMinutes: Double?, val sleepDeepMin: Double?,
      val sleepRemMin: Double?, val sleepLightMin: Double?, val sleepAwakeMin: Double?, val napMinutes: Double?,
      val workouts: List<Workout>, val sleepTimeline: List<SleepInterval>, val scores: DayScores?,
      val samsungAuto: SamsungAuto?)
  data class Dataset(val timezone: String, val firstDay: String?, val lastDay: String?, val syncedAt: Instant?,
      val latestMeasurementAt: Instant?, val lastComputeSuccessAt: Instant?, val days: List<Day>)
  ```
- Produces: `object DatasetParser { fun dataset(value: JSONObject): Dataset }`, `DatasetResult(days, syncedAt, dataset: Dataset)` a `AppUiState.dataset`.

Mapovanie polí je 1:1 podľa `web/src/lib/types.ts` (snake_case na camelCase). `Selected` sa naplní z dvojíc `distance_m`/`distance_m_source`, `active_kcal`/`active_kcal_source`, `total_kcal`/`total_kcal_source`, `resting_hr`/`resting_hr_source` a `hrv_ms`/`hrv_ms_source`. Ak pole v JSON chýba, `Selected` je `null`; ak má hodnotu `null`, je to `Selected(null, …)`. Stage `in_bed` a neznáme hodnoty sa mapujú na `ASLEEP`, `"awake"` na `AWAKE`.

Odolnosť: nesprávny typ alebo nepovolený enum jedného poľa dá `null` len pre toto pole. Deň sa zahodí iba pri neplatnom `day`. Celý dataset zlyhá iba pri chýbajúcom `days` alebo `timezone`. Záporné hodnoty sú povolené pre `sleepRegularity`, `nightSignal.delta` a zložky skóre. Existujúce `Payloads.days` ostáva bez zmeny, kým ho Task 12 neodstráni.

- [ ] **Step 1: Write the failing tests** v `DatasetParserTest`:
  - `fullDayParses`: fixture so všetkými poľami z `types.ts`. Overiť `scores.cardioLoad.status == "productive"`, `sleepTimeline.size`, `workouts[0].strain`, `distance == Selected(9600.0, MEASURED)`.
  - `absentSelectedFieldIsNull`: deň bez kľúča `distance_m` dá `distance == null`; `"distance_m": null` dá `Selected(null, null)`.
  - `badValueDropsOnlyThatField`: `steps: "x"` dá `steps == null` a ostatné polia dňa ostanú.
  - `unknownEnumsAreNull`: `cardio_load.status: "zzz"` dá `null`, `distance_m_source: "guess"` dá `source == null`.
  - `negativeAllowedWhereSigned`: `sleep_regularity: -12.5` a `night_signal.delta: -3.0` sa zachovajú.
  - `invalidDayIsDropped`: `day: "2026-02-30"` sa vynechá a ostatné dni ostanú.
  - `missingDaysFails`: chýbajúce `days` vyhodí výnimku.
- [ ] **Step 2: Run** `:app:testDebugUnitTest --tests "*DatasetParserTest*"`. Expected: FAIL, lebo `DatasetParser` neexistuje.
- [ ] **Step 3: Implement** modely, `DatasetParser.dataset`, `ZdravieApi.data` (parsuje oboje z jedného JSON) a uloženie `dataset` v `SessionController.loadData`.
- [ ] **Step 4: Run** plný build príkaz z Global Constraints. Expected: všetky testy PASS, lint bez nových chýb.
- [ ] **Step 5: Commit** vymenovaných súborov, správa „Android: parse the full dataset“.

### Task 2: Dátumy a formáty z webu

**Files:**
- Create: `android/app/src/main/java/sk/zdravie/app/logic/Dates.kt`, `.../logic/Format.kt`
- Test: `android/app/src/test/java/sk/zdravie/app/logic/DatesTest.kt`, `.../logic/FormatTest.kt`

**Interfaces:**
- Consumes: nič z iných taskov.
- Produces: `object Dates` s funkciami `isValidDay`, `addDays(day: String, n: Int): String`, `diffDays`, `dateRange`, `todayIn(timeZone: String, now: Instant = Instant.now()): String`, `localDay(instant: Instant, timeZone: String): String`, `localMinutesOfDay(instant: Instant, timeZone: String): Int`, `weekdayIndex(day: String): Int` (po = 0). `object Format` so všetkými exportmi z `web/src/lib/format.ts` (`DASH`, `formatInt`, `formatDecimal`, `formatDuration`, `formatDurationCompact`, `formatTimeOfDay`, `formatDurationShort`, `formatDistance`, `formatKcal`, `formatBpm`, `formatDay`, `formatDayMonth`, `formatDayLong`, `formatMonth`, `formatClock(instant: Instant?, timeZone: String)`, `formatClockMinutes`, `formatRelative(instant: Instant?, now: Instant)`, `formatChange`, `plural`, `approx`, `workoutLabel`, `stepsSourceLabel`). Nullable vstupy dávajú `DASH` presne ako na webe.

Prenesie sa 1:1 z `web/src/lib/dates.ts` a `format.ts`. Medzera v tisícoch je rovnaký znak ako na webe (skontrolovať v `format.ts`), desatinná čiarka. `UiFormatting.kt` zostane, kým ho Task 12 neodstráni.

- [ ] **Step 1: Write the failing tests:** preniesť každý `it(...)` z `web/src/lib/dates.test.ts` a `format.test.ts` ako JUnit test s rovnakými vstupmi a očakávaniami. Doplniť `localMinutesUsesDatasetZone`: rovnaký `Instant` v `Europe/Bratislava` a `America/New_York` dá rôzne minúty aj deň.
- [ ] **Step 2: Run** `--tests "*DatesTest*" --tests "*FormatTest*"`. Expected: FAIL.
- [ ] **Step 3: Implement** `Dates.kt` a `Format.kt`.
- [ ] **Step 4: Run** rovnaké testy. Expected: PASS.
- [ ] **Step 5: Commit** „Android: port date and format helpers from web“.

### Task 3: Metriky, hodnoty dňa a posledný deň

**Files:**
- Create: `.../logic/Metrics.kt`, `.../logic/DayValues.kt`, `.../logic/LatestDay.kt`
- Test: `.../logic/MetricsTest.kt`, `DayValuesTest.kt`, `LatestDayTest.kt`

**Interfaces:**
- Consumes: Task 1 (`Day`, `Workout`, `Selected`), Task 2 (`Dates`, `Format`).
- Produces: 1:1 porty `web/src/lib/metrics.ts` (`indexByDay`, `windowEnding`, `series`, `sum`, `average`, `min`, `max`, `periodSummary`, `allWorkouts`, `workoutTotals`, `sleepNights`, `averageClock`, `isStale`), `day-values.ts` (`enum class DayMetric { DISTANCE, ACTIVE_ENERGY, TOTAL_ENERGY, RESTING_HR }`, `dayValue`, `dayValueSource`, `restingHrDescription`, `dayFigure`, `periodHasEstimate`, `periodFigure`) a `latest-day.ts` (`hasDayData`, `data class LatestDay`, `ageLabel`, `latestDay`). TS typy `NumericDayKey` sa stanú `enum class DayKey` s rovnakými menami polí. Dátové triedy majú rovnaké polia ako TS rozhrania.

`Object.hasOwn(day, field)` v `day-values.ts` zodpovedá `day.distance != null` (alebo príslušnému `Selected`).

- [ ] **Step 1: Write the failing tests:** preniesť všetky prípady z `metrics.test.ts`, `day-values.test.ts` a `latest-day.test.ts`. Doplniť `olderResponseFallsBackToEstimate`: `distance == null` a `distanceMEst = 5400.0` dá `dayValue = 5400.0` so zdrojom `ESTIMATED`.
- [ ] **Step 2: Run** testy. Expected: FAIL.
- [ ] **Step 3: Implement** tri súbory.
- [ ] **Step 4: Run** testy. Expected: PASS.
- [ ] **Step 5: Commit** „Android: port metrics, day values and latest day“.

### Task 4: Skóre, srdce a aktivita

**Files:**
- Create: `.../logic/Scores.kt`, `.../logic/Heart.kt`, `.../logic/Activity.kt`
- Test: `.../logic/ScoresTest.kt`, `HeartTest.kt`, `ActivityTest.kt`

**Interfaces:**
- Consumes: Tasky 1–3.
- Produces:
  - 1:1 port celého `web/src/lib/scores.ts`: `SCORE_NAMES`, `componentLabel`, `noteText`, `scoreValue`, `isEstimate`, `formatScore`, `formatStrain`, pásma (`data class Band`), `dayScoreLabel`, `cardioStatusLabel`, `EVENING_FROM_MINUTES = 900`, `NIGHT_UNTIL_MINUTES = 240`, `resolveMode(now: Instant, timeZone: String, override: String?): ModeResult(mode: Mode, day: String)` s `enum class Mode { MORNING, EVENING }`, `nightSignalAlert`, `componentExtremes`, `subScores(day, previous): List<SubScore>`, `typicalWake`, `bedtimeFor`, `morningSummary` a `eveningSummary`.
  - Z `detail-heart.ts`: `READINESS_PARTS`, `restingBaseline`, `restingComparison`, `signalStatus`, `nightHeartSeries`, `restingTrend`.
  - Z `detail-activity.ts`: `ACTIVITY_PARTS`, `STRAIN_BANDS`, `STRAIN_MAX = 21`, `CARDIO_BANDS`, `CARDIO_THRESHOLDS`, `cardioText`, `cardioTrend`, `cardioWeeks`, `zoneTotals`, `stepsCategory`, `finishedSteps`, `stepsStats`, `weekdaySteps`, `bestStepDays` a `weekendShare`.

- [ ] **Step 1: Write the failing tests:** preniesť všetky prípady zo `scores.test.ts`, `detail-heart.test.ts` a `detail-activity.test.ts` pre vymenované funkcie. Doplniť:
  - `eveningFrom15UntilFour`: 14:59 dá ráno, 15:00 večer, 03:59 večer predchádzajúceho dňa, 04:00 ráno.
  - `morningSentenceExact`: readiness 81 a sleep 86 dajú presne „Noc bola v poriadku a pripravenosť je dobrá. Bežný deň by mal sedieť.“
- [ ] **Step 2: Run** testy. Expected: FAIL.
- [ ] **Step 3: Implement** tri súbory.
- [ ] **Step 4: Run** testy. Expected: PASS.
- [ ] **Step 5: Commit** „Android: port scores, heart and activity rules“.

### Task 5: Spánok, prehľad a dlhodobé

**Files:**
- Create: `.../logic/Sleep.kt`, `.../logic/Overview.kt`, `.../logic/LongTerm.kt`, `.../logic/Samsung.kt`
- Test: `.../logic/SleepTest.kt`, `OverviewTest.kt`, `LongTermTest.kt`, `SamsungTest.kt`

**Interfaces:**
- Consumes: Tasky 1–4.
- Produces:
  - Z `detail-sleep.ts`: `enum class SleepKind { PERFORMANCE, APPLE, SAMSUNG }` (z účtu `performance`, `apple`, `samsung`), `SLEEP_KINDS`, `sleepScoreOf`, `nightScore`, `lastNight`, `stageTotals`, `splitTimeline`, `hourTicks`, `needTonight`, `sleepHistory`, `needCoverage`, `clockSummary`, `SRI_QUINTILES`, `SRI_MEDIAN` a `regularityBand`.
  - Z `overview.ts`: `WEEKDAY_LETTERS`, `nightWeekday`, `enum class HeatMetric { STEPS, SLEEP, ACTIVE, RESTING }`, `HEAT_METRICS`, `heatValue`, `heatmap`, `heatmapNote`, `records`, `weekCards`, `sleepSegments`, `sleepWindow`, `insights` a `barRange`.
  - Z `detail-longterm.ts`: `weeklyMeans`, `vo2maxWeeks`, `latestValue`, `seriesChange`, `vo2maxLevel`, `bodyAge` a `longRecords`.
  - Zo `samsung.ts`: `isLearning`, `learningGap`, `learningText` a `scoreParts`.

- [ ] **Step 1: Write the failing tests:** preniesť prípady z `detail-sleep.test.ts`, `overview.test.ts`, `detail-longterm.test.ts` a `samsung.test.ts` pre vymenované funkcie. Doplniť `samsungLearningShowsLearningText`: kind `SAMSUNG`, bez `samsungAuto`, `samsungSleep = Score(null, {entries: 4, needed: 10}, "learning")`. Výsledok: `nightScore.value == null` a `learningText` vráti rovnaký text ako web.
- [ ] **Step 2: Run** testy. Expected: FAIL.
- [ ] **Step 3: Implement** štyri súbory.
- [ ] **Step 4: Run** testy. Expected: PASS.
- [ ] **Step 5: Commit** „Android: port sleep, overview and long-term rules“.

### Task 6: Klient Balíka 1 (postrehy a denník)

**Files:**
- Create: `.../data/DailyApi.kt`, `.../model/Daily.kt`
- Modify: `.../data/MobileApi.kt`, `.../data/ZdravieApi.kt`, `.../controller/SessionController.kt`
- Test: `.../data/DailyApiTest.kt`, rozšíriť `SessionControllerTest.kt`

**Interfaces:**
- Consumes: Task 1 (`AppUiState`), existujúce `call(...)` so session cookie a `x-zdravie-identity`.
- Produces:
  - `data class Insight(val id: String, val ruleId: String, val messageKey: String, val kind: String, val evidence: Map<String, Any?>, val text: String)`. `text` sa poskladá ako vo webovom `insight-text.ts`.
  - `data class InsightsResult(val status: String, val items: List<Insight>)`
  - `data class JournalEntry(val ratings: Map<String, Int?>, val context: Map<String, Boolean?>, val note: String?)`
  - `data class JournalState(val entry: JournalEntry?, val revision: Long)`
  - `sealed interface DailyResult<out T> { data class Ok<T>(val value: T); object Unsupported; object Unavailable; data class Conflict(val current: JournalState) }`
  - `MobileApi.insights(credential, session, day: String): DailyResult<InsightsResult>`, `journal(credential, session, day): DailyResult<JournalState>`, `saveJournal(credential, session, day, patch: JSONObject, expectedRevision: Long): DailyResult<JournalState>`.
  - `SessionController.loadDaily(day: String)` a `saveJournal(day, entry)`, stav `AppUiState.daily: DailyUiState? = null`.

Kontrakt platí podľa `docs/balik-1-api.md` v hlavnom strome (v tomto worktree súbor nie je, prečítať z `C:\Users\richa\Open-Wearables-Integrations\docs\balik-1-api.md`). Polia hodnotení sú `morning_energy`, `sleep_quality`, `evening_stress` a `muscle_soreness` (celé čísla 1–5 alebo null). Kontext tvoria `travel`, `unusual_schedule`, `late_meal` a `late_caffeine` (true, false alebo null). Poznámka má najviac 500 znakov.

Mapovanie odpovedí: 404 alebo 501 dá `Unsupported` a appka sa na tento endpoint už v relácii nepýta. 503 alebo sieťová chyba dá `Unavailable`. `409 error=revision_conflict` dá `Conflict` s aktuálnym stavom. `409 session_changed` vyhodí `ApiFailure(409)`, ako ostatné volania.

- [ ] **Step 1: Write the failing tests** v `DailyApiTest` cez MockWebServer:
  - `insightsOk`, `insights404IsUnsupportedAndCached` (druhé volanie nejde na server), `insights503IsUnavailable`.
  - `journalPatchSendsOnlyChangedFields`.
  - `revisionConflictKeepsCurrent`: telo `{"error":"revision_conflict","entry":{…},"revision":3}`.
  - `sessionChangedThrows409`.
  - `identityHeaderRequired` (chýbajúca alebo iná identita v odpovedi dá 409).
- [ ] **Step 2: Run** testy. Expected: FAIL.
- [ ] **Step 3: Implement** klienta, modely a metódy kontroléra.
- [ ] **Step 4: Run** plný build. Expected: PASS.
- [ ] **Step 5: Commit** „Android: optional insights and journal client“.

### Task 7: Téma A2, písma a spoločné prvky

**Files:**
- Create: `android/app/src/main/res/font/urbanist_*.ttf` (light, regular, medium, semibold, bold), `dm_mono_regular.ttf`, `dm_mono_medium.ttf`, `android/app/src/main/res/font/OFL.txt` (alebo `assets/licenses/`, podľa toho, čo lint pustí)
- Create: `.../ui/theme/Tokens.kt`, `.../ui/theme/Type.kt`, `.../ui/components/` (`Panel.kt`, `Eyebrow.kt`, `Ring.kt`, `Bars.kt`, `StageStrip.kt`, `ZoneBar.kt`, `Sparkline.kt`, `Chips.kt`, `Segmented.kt`, `Glow.kt`)
- Modify: `.../ui/ZdravieTheme.kt` (tokeny A2 namiesto súčasných farieb)
- Test: `android/app/src/test/java/sk/zdravie/app/ui/TokensTest.kt`, `android/app/src/androidTest/.../ui/ComponentsTest.kt`

**Interfaces:**
- Consumes: nič z logiky.
- Produces:
  - `data class ZTokens(bg, glass, ink, ink2, muted, line, track, accent, sleep, heart, deep, rem, lightSleep, good, warn: Color, glow: Float)`, `val LocalZTokens`, `ZdravieTheme(theme: String?, content)`.
  - Kompozity: `Panel(modifier, radius = 28.dp, content)`, `Eyebrow(text)`, `ScoreRing(fraction: Float, color, size: Dp, content)` (oblúk 270°, začiatok 225°), `MiniBars(values: List<Double?>, highlight: Set<Int>, color)`, `StageStrip(segments: List<StageSegment>)`, `ZoneBar(light, moderate, vigorous: Double?)`, `Sparkline(values: List<Double?>, color)`, `ChoiceChips(options, selected, onSelect)`, `Segmented(options, selected, onSelect)` a `BackgroundGlow()`.

Písma: TTF stiahnuť z oficiálneho repozitára `github.com/google/fonts` (`ofl/urbanist`, `ofl/dmmono`), statické rezy alebo variabilný súbor s osou `wght`, a pribaliť `OFL.txt`. Tmavé tokeny: `warn = #f2b35b`; svetlé: `warn = #a86a00`, accent `#9a7a2c` (zodpovedá `color-mix(#e9b44c 70 %, #4a3200)`; overiť kontrast ≥ 4,5 : 1 na `#eef0f3` a v prípade potreby stmaviť). Ostatné hodnoty sú zo spec tabuľky.

- [ ] **Step 1: Write the failing tests:** `TokensTest.darkMatchesSpec` a `lightMatchesSpec` (každý hex zo spec tabuľky) a `textContrastAtLeast45` (ink, ink2 a muted na bg a glass v oboch režimoch). V `ComponentsTest` zobraziť `ScoreRing` a `MiniBars` s `contentDescription` a overiť ich sémantiku.
- [ ] **Step 2: Run** `--tests "*TokensTest*"`. Expected: FAIL.
- [ ] **Step 3: Implement** tokeny, typografiu a komponenty.
- [ ] **Step 4: Run** plný build. Expected: PASS. Súčasné obrazovky majú nové farby a písmo.
- [ ] **Step 5: Commit** „Android: A2 tokens, fonts and shared components“.

### Task 8: Navigácia a obrazovka Dnes

**Files:**
- Create: `.../ui/screens/TodayScreen.kt`, `.../ui/AppNav.kt`
- Modify: `.../ui/ZdravieApp.kt` (štyri karty Dnes, Spánok, Aktivita, Trendy a kruh účtu; vybraný dátum zdieľaný medzi kartami)
- Test: `android/app/src/androidTest/.../ui/TodayScreenTest.kt`, `.../preview/NativePreviewTest.kt` (nové náhľady)

**Interfaces:**
- Consumes: Tasky 1–7. `AppUiState.dataset`, `daily`.
- Produces: `@Composable TodayScreen(dataset: Dataset, date: String, now: Instant, account: Account, daily: DailyUiState?, onDate: (String) -> Unit, onOpenSleep, onSaveJournal, onRefresh)` a `enum class AppTab { TODAY, SLEEP, ACTIVITY, TRENDS }`.

Obsah a poradie podľa artboardov `AndroidDnesRano` a `AndroidDnesVecer`:

1. Hlavička a ‹ › s dátumom.
2. Prepínač Ráno/Večer (`resolveMode`; `account.settings.overview_mode`, ak ho session nesie, inak automaticky).
3. Stav dát (`formatRelative` z `lastComputeSuccessAt ?: syncedAt`, varovná farba pri `isStale`).
4. `nightSignalAlert`.
5. Hlavný blok ráno (`dayScore`, `dayScoreLabel`, `subScores`, `morningSummary`) alebo večer (strain, `needTonight` alebo `bedtimeFor` + `typicalWake`, `eveningSummary`).
6. „Čo sa zmenilo“: Balík 1, inak `insights()` bez `restingTrend`.
7. Spánok (`lastNight`, `sleepSegments`, `stageTotals`, `nightScore` podľa preferencie).
8. Aktivita (kroky a kruh oproti 30-dňovému priemeru zo `stepsStats`; tri mini dlaždice cez `dayFigure` a 7-dňové `MiniBars`; zóny).
9. Srdce (`dayValue(RESTING_HR)`, zdroj, 30-dňová `Sparkline`, HRV podľa `hrvKind`, nočný tep zo `signalStatus`).
10. Záťaž (`cardioStatusLabel`, pomer, VO2max).
11. Tréningy dňa.
12. Môj deň (iba ak `daily.journal != Unsupported`).

Prázdny alebo neúplný dnešok rieši `latestDay` a štítok „Priebežné údaje · deň ešte nie je uzavretý“.

- [ ] **Step 1: Write the failing UI tests** (syntetický `Dataset` cez fixture builder):
  - `morningShowsDayScoreAndSentence`.
  - `eveningShowsStrainNeedAndBedtime` (`now` = 20:00 v pásme datasetu).
  - `yellowSignalShowsBanner`.
  - `dayWithoutScoresShowsDashes`: žiadna nula, žiadny pád.
  - `phoneZoneDiffersFromDataset`: `TimeZone.setDefault(America/New_York)`; časy spánku ostanú v pásme datasetu.
  - `journalHiddenWhenUnsupported`.
- [ ] **Step 2: Run** `:app:connectedDebugAndroidTest --tests "*TodayScreenTest*"` (emulátor API 36). Expected: FAIL.
- [ ] **Step 3: Implement** navigáciu a obrazovku. Náhľady „Dnes ráno“ a „Dnes večer“ uložiť do `artifacts/android/` (adresár je ignorovaný).
- [ ] **Step 4: Run** UI testy a plný build. Expected: PASS. Náhľad porovnať s artboardom.
- [ ] **Step 5: Commit** „Android: Today screen with morning and evening modes“.

### Task 9: Obrazovka Spánok

**Files:**
- Create: `.../ui/screens/SleepScreen.kt`, `.../ui/components/Hypnogram.kt`
- Test: `.../ui/SleepScreenTest.kt`

**Interfaces:**
- Consumes: Tasky 1–8 (`splitTimeline`, `hourTicks`, `stageTotals`, `nightScore`, `sleepHistory`, `needCoverage`, `clockSummary`, `regularityBand`, `learningText`).
- Produces: `@Composable SleepScreen(dataset: Dataset, date: String, kind: SleepKind, onDate: (String) -> Unit)`.

Podľa artboardu `AndroidSpanok`:

1. Výber noci.
2. Hypnogram so štyrmi dráhami a osou `hourTicks`.
3. Súhrn (spánok, v posteli, bdenie, zdriemnutie).
4. Fázy s percentami.
5. Skóre noci: preferované veľké, ostatné dve malé. Pri stave učenia text `learningText`.
6. 14 nocí oproti potrebe: stĺpce a prerušovaná čiara.
7. Pravidelnosť: SRI, `regularityBand`, okná zaspania a vstávania.

- [ ] **Step 1: Write the failing UI tests:** `hypnogramHasFourLanes`, `preferredScoreIsLarge`, `samsungLearningShowsLearningText`, `nightWithoutTimelineShowsEmptyState` a `napListedSeparately`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testy a plný build. Expected: PASS. Náhľad porovnať s artboardom.
- [ ] **Step 5: Commit** „Android: Sleep screen“.

### Task 10: Obrazovka Aktivita a detail tréningu

**Files:**
- Create: `.../ui/screens/ActivityScreen.kt`, `.../ui/components/WorkoutSheet.kt`
- Test: `.../ui/ActivityScreenTest.kt`

**Interfaces:**
- Consumes: `stepsStats`, `finishedSteps`, `cardioTrend`, `cardioWeeks`, `cardioText`, `zoneTotals`, `allWorkouts`, `workoutTotals`, `workoutLabel`, `dayFigure`, `formatStrain` a `STRAIN_BANDS`.
- Produces: `@Composable ActivityScreen(dataset: Dataset, date: String, onDate: (String) -> Unit)`.

Podľa artboardu `AndroidAktivita`:

1. Kroky s 30-dňovou krivkou a priemerom.
2. Strain za 14 dní.
3. Stav záťaže za 8 týždňov (7 d oproti tolerancii 28 d).
4. Štyri dlaždice dňa: aktívny čas, kalórie spolu, vzdialenosť a priemerný tep.
5. Zóny.
6. Tréningy za 30 dní. Ťuknutie otvorí `ModalBottomSheet` s detailom. Tempo je `duration / distance` iba pri behu a chôdzi, inak sa nezobrazí.

- [ ] **Step 1: Write the failing UI tests:** `stepsShowAverage`, `workoutTapOpensSheet`, `paceOnlyForRunning`, `missingStrainShowsDash` a `estimatedDistanceHasApprox`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testy a plný build. Expected: PASS.
- [ ] **Step 5: Commit** „Android: Activity screen and workout detail“.

### Task 11: Obrazovka Trendy

**Files:**
- Create: `.../ui/screens/TrendsScreen.kt`, `.../logic/Trends.kt`
- Test: `.../logic/TrendsTest.kt`, `.../ui/TrendsScreenTest.kt`

**Interfaces:**
- Consumes: `series`, `periodSummary`, `weekCards`, `heatmap`, `heatmapNote`, `records`, `vo2maxWeeks` a `bodyAge`.
- Produces:
  - `enum class TrendMetric { STEPS, SLEEP, DAY_SCORE, READINESS, STRAIN, RESTING_HR, HRV, ACTIVE, KCAL, VO2MAX }`
  - `fun trendValues(days: List<Day>, end: String, metric: TrendMetric, range: Int): TrendSeries`, kde `range` je 7, 30, 90 alebo 365. Pri 365 sú to týždenné priemery cez `weeklyMeans`.
  - `TrendSeries(values: List<Double?>, average: Double?, previousAverage: Double?, best: Double?, worst: Double?, covered: Int, total: Int)`
  - `@Composable TrendsScreen(dataset: Dataset, today: String, onOpenDay: (String) -> Unit)`.

Hodnota dňa pre metriku: kroky `steps`, spánok `sleepMinutes`, skóre dňa `scores.dayScore`, readiness `scores.readiness.value`, strain `scores.strain`, pokojový tep `dayValue(RESTING_HR)`, HRV `hrv.value`, aktívny čas `activeMinutesEst`, kalórie `dayValue(TOTAL_ENERGY)`, VO2max `scores.vo2max`. `previousAverage` je priemer rovnako dlhého obdobia pred rozsahom. Chýbajúci deň je `null` a v grafe medzera.

- [ ] **Step 1: Write the failing tests:**
  - `TrendsTest.averageIgnoresMissing`.
  - `previousPeriodIsSameLength`.
  - `yearUsesWeeklyMeans` (52 hodnôt).
  - UI: `chipChangesMetric`, `heatmapTapOpensDay` a `recordsListFive`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testy a plný build. Expected: PASS.
- [ ] **Step 5: Commit** „Android: Trends screen“.

### Task 12: Účet, prihlásenie, čakanie a upratanie

**Files:**
- Create: `.../ui/screens/AccountScreen.kt`, `.../ui/screens/LoginScreen.kt`, `.../ui/screens/WaitingScreen.kt`
- Modify: `.../ui/ZdravieApp.kt`, `MainActivity.kt` (do povolených ciest `openWeb` pridať `/zapis`)
- Delete: `.../ui/HistoryScreen.kt`, `.../ui/UiFormatting.kt`, `DaySummary` a `WorkoutSummary` z `Models.kt`, `Payloads.days` a ich testy (nahradené Taskami 1–5)
- Test: upraviť `ZdravieAppTest.kt`, `ZdravieThemeTest.kt` a `NativePreviewTest.kt`

**Interfaces:**
- Consumes: všetko predošlé. Existujúce `UpdateUi` a `onCheckForUpdates` sa nemenia.
- Produces: finálna `ZdravieApp(...)` s rovnakou signatúrou ako dnes.

Podľa artboardov `AndroidUcet` a `AndroidPrihlasenie`:

1. **Účet:** meno, e-mail a stav.
2. **Téma:** Systém, Tmavý, Svetlý. Lokálna voľba ako dnes.
3. **Hlavné skóre spánku:** zobrazí sa z účtu a mení sa na webe. Ak doterajší kód vie zmenu uložiť, ponechať.
4. **Aplikácia:** verzia a „Skontrolovať aktualizácie“.
5. **Odkazy na web:** `/nastavenia`, `/zapis`, `/admin` (iba rola admin).
6. **Odhlásiť sa.**
7. **Prihlásenie a čakanie:** rovnaké správanie, nový vzhľad.

- [ ] **Step 1: Write the failing tests:** `adminLinkOnlyForAdmin`, `logoutClearsDataset`, `identityChangeResetsSelectedDate` a `loginKeepsPasswordOutOfState` (prenesený existujúci test).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, zmazať starý kód.
- [ ] **Step 4: Run** plný build a `:app:connectedDebugAndroidTest`. Expected: PASS a žiadne odkazy na odstránené typy.
- [ ] **Step 5: Commit** „Android: account, login and cleanup of v0.1 screens“.

### Task 13: Vydanie 0.2.0

**Files:**
- Modify: `android/version.properties` (`versionName=0.2.0`, `versionCode=10`; release workflow pripočíta číslo behu, preto overiť v `.github/workflows/android-release.yml`, že výsledný kód je vyšší než pri 0.1.1)
- Modify: `android/RELEASE_NOTES.md`, `android/README.md` (popis obrazoviek)
- Modify: `docs/mobile/android-v1-verification.md`, alebo vytvoriť `docs/mobile/android-v2-verification.md`

**Interfaces:**
- Consumes: hotové Tasky 1–12.
- Produces: podpísaný GitHub release `android-v0.2.x` s `android-update.json`, ktorý appka 0.1.1 ponúkne.

- [ ] **Step 1:** Spustiť plný build, `:app:connectedDebugAndroidTest` a náhľady všetkých obrazoviek. Expected: všetko PASS, náhľady uložené v `artifacts/android/0.2.0/`.
- [ ] **Step 2:** `RELEASE_NOTES.md` po anglicky ako doteraz: nový vzhľad, ráno a večer, spánok s fázami, aktivita a tréningy, trendy a kalendár, denník, keď je dostupný.
- [ ] **Step 3:** Commit, potom merge vetvy `claude/android-redizajn` do `claude/bold-brahmagupta-tvvwvt` v hlavnom strome. Fast-forward, Codexove necommitnuté súbory sa nedotknú. Pred pushom overiť `git diff --stat origin/claude/bold-brahmagupta-tvvwvt..HEAD`: iba `android/`, `docs/` a nič z Codexových ciest.
- [ ] **Step 4:** `git push origin claude/bold-brahmagupta-tvvwvt`. Sledovať behy „Android release“ a „Checks“ cez `https://api.github.com/repos/Richinino/Open-Wearables-Integrations/actions/runs`. Expected: oba `success`.
- [ ] **Step 5:** Overiť `releases/latest/download/android-update.json`: `versionName` začína `0.2.`, `versionCode` je vyšší než pri 0.1.1, SHA-256 sedí so `SHA256SUMS.txt`.

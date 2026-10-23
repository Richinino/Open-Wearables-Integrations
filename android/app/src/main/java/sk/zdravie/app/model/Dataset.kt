package sk.zdravie.app.model

import java.time.Instant

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

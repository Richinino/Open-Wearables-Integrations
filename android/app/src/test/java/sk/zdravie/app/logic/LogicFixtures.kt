package sk.zdravie.app.logic

import java.time.Instant
import sk.zdravie.app.model.CardioLoad
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.DayScores
import sk.zdravie.app.model.NightSignal
import sk.zdravie.app.model.Score
import sk.zdravie.app.model.Selected
import sk.zdravie.app.model.ValueSource
import sk.zdravie.app.model.Workout

/** Invented days for tests: every value null, override with copy. */
object LogicFixtures {
    const val ZONE = "Europe/Bratislava"

    fun makeDay(day: String, change: (Day) -> Day = { it }): Day = change(
        Day(
            day = day, timezone = ZONE, complete = true, steps = null, stepsSource = null,
            distanceMEst = null, activeMinutesEst = null, activityKcalEst = null, basalKcal = null,
            totalKcalEst = null, distance = null, activeKcal = null, totalKcal = null, restingHr = null,
            hrv = null, hrvKind = null, hrResting = null, hrAvg = null, hrMax = null, hrMin = null,
            zoneLightMin = null, zoneModerateMin = null, zoneVigorousMin = null, sleepStart = null,
            sleepEnd = null, sleepMinutes = null, sleepDeepMin = null, sleepRemMin = null,
            sleepLightMin = null, sleepAwakeMin = null, napMinutes = null, workouts = emptyList(),
            sleepTimeline = emptyList(), scores = null, samsungAuto = null,
        ),
    )

    fun makeWorkout(id: String, change: (Workout) -> Workout = { it }): Workout = change(
        Workout(
            id = id, day = "2026-06-10", type = "running",
            start = Instant.parse("2026-06-10T16:00:00Z"), end = Instant.parse("2026-06-10T16:30:00Z"),
            durationS = 1800.0, source = "test", hrAvg = null, hrMax = null, hrMin = null,
            zoneLightMin = 0.0, zoneModerateMin = 0.0, zoneVigorousMin = 0.0,
            distanceM = null, kcalEst = null, strain = null,
        ),
    )

    fun selected(value: Double?, source: ValueSource?) = Selected(value, source)

    fun makeScore(value: Double?, components: Map<String, Double?> = emptyMap(), note: String? = null): Score =
        Score(value, components, note)

    fun makeScores(day: String, change: (DayScores) -> DayScores = { it }): DayScores = change(
        DayScores(
            day = day, strain = null, cardioLoad = CardioLoad(null, null, null, null), sleepNeedMinutes = null,
            sleepPerformance = makeScore(null), appleSleep = makeScore(null), sleepRegularity = null,
            readiness = makeScore(null), activity = makeScore(null),
            nightSignal = NightSignal(null, null, null, null), dayScore = null, vo2max = null,
            vo2maxUth = null, whoopAge = makeScore(null), samsungSleep = null, energyScore = null,
        ),
    )
}

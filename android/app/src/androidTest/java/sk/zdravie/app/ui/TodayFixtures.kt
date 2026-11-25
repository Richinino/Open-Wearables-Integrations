package sk.zdravie.app.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt
import kotlin.math.sin
import sk.zdravie.app.model.Account
import sk.zdravie.app.model.CardioLoad
import sk.zdravie.app.model.Dataset
import sk.zdravie.app.model.Day
import sk.zdravie.app.model.DayScores
import sk.zdravie.app.model.NightSignal
import sk.zdravie.app.model.Score
import sk.zdravie.app.model.Selected
import sk.zdravie.app.model.SleepInterval
import sk.zdravie.app.model.SleepStage
import sk.zdravie.app.model.ValueSource
import sk.zdravie.app.model.Workout

/** Invented, obviously synthetic days for UI tests and previews. Nothing here comes from a real account. */
object TodayFixtures {
    const val ZONE = "Europe/Bratislava"
    private val zone: ZoneId = ZoneId.of(ZONE)

    /** An instant at a wall-clock time of [date] in the dataset zone. */
    fun local(date: String, hour: Int, minute: Int): Instant =
        LocalDate.parse(date).atTime(hour, minute).atZone(zone).toInstant()

    fun account(sleepScore: String = "performance") =
        Account("synthetic-today", "Alex", "Ukážka", "alex@example.invalid", "user", "active", true, true, "dark", sleepScore)

    fun emptyDay(date: String, complete: Boolean = true) = Day(
        day = date, timezone = ZONE, complete = complete, steps = null, stepsSource = null,
        distanceMEst = null, activeMinutesEst = null, activityKcalEst = null, basalKcal = null,
        totalKcalEst = null, distance = null, activeKcal = null, totalKcal = null, restingHr = null,
        hrv = null, hrvKind = null, hrResting = null, hrAvg = null, hrMax = null, hrMin = null,
        zoneLightMin = null, zoneModerateMin = null, zoneVigorousMin = null, sleepStart = null,
        sleepEnd = null, sleepMinutes = null, sleepDeepMin = null, sleepRemMin = null,
        sleepLightMin = null, sleepAwakeMin = null, napMinutes = null, workouts = emptyList(),
        sleepTimeline = emptyList(), scores = null, samsungAuto = null,
    )

    fun score(value: Double?, note: String? = null, components: Map<String, Double?> = emptyMap()) =
        Score(value, components, note)

    fun emptyScores(date: String) = DayScores(
        day = date, strain = null, cardioLoad = CardioLoad(null, null, null, null), sleepNeedMinutes = null,
        sleepPerformance = score(null), appleSleep = score(null), sleepRegularity = null,
        readiness = score(null), activity = score(null), nightSignal = NightSignal(null, null, null, null),
        dayScore = null, vo2max = null, vo2maxUth = null, whoopAge = score(null), samsungSleep = null,
        energyScore = null,
    )

    /** The night of the artboard: 23:12 -> 06:56, 7 h 36 min asleep. */
    private val NIGHT = listOf(
        SleepStage.LIGHT to 30, SleepStage.DEEP to 50, SleepStage.LIGHT to 35, SleepStage.REM to 25,
        SleepStage.LIGHT to 55, SleepStage.DEEP to 40, SleepStage.REM to 40, SleepStage.AWAKE to 8,
        SleepStage.LIGHT to 70, SleepStage.REM to 45, SleepStage.LIGHT to 66,
    )

    private fun night(date: String): Triple<Instant, Instant, List<SleepInterval>> {
        val start = local(LocalDate.parse(date).minusDays(1).toString(), 23, 12)
        var at = start
        val timeline = NIGHT.map { (stage, minutes) ->
            val end = at.plusSeconds(minutes * 60L)
            SleepInterval(at, end, stage).also { at = end }
        }
        return Triple(start, at, timeline)
    }

    fun run(date: String, hour: Int, minute: Int, minutes: Int = 42, id: String = "run-$date") = Workout(
        id = id, day = date, type = "running", start = local(date, hour, minute),
        end = local(date, hour, minute).plusSeconds(minutes * 60L), durationS = minutes * 60.0, source = "synthetic",
        hrAvg = 152.0, hrMax = 178.0, hrMin = 96.0, zoneLightMin = 8.0, zoneModerateMin = 21.0, zoneVigorousMin = 13.0,
        distanceM = 7400.0, kcalEst = 520.0, strain = 11.2,
    )

    /** A full synthetic day; [i] varies the numbers a little from day to day. */
    fun richDay(date: String, i: Int, complete: Boolean = true): Day {
        val wave = sin(i * 1.3)
        val (start, end, timeline) = night(date)
        val scores = emptyScores(date).copy(
            strain = 9.6 + 2.0 * sin(i * 0.7),
            cardioLoad = CardioLoad(70.0, 62.0, 1.12, "productive"),
            sleepNeedMinutes = 485.0,
            sleepPerformance = score(86.0),
            appleSleep = score(82.0),
            samsungSleep = score(84.0, "estimate"),
            readiness = score(81.0, components = mapOf("resting_hr" to 96.0, "sleep" to 88.0)),
            activity = score(64.0 + (i % 5)),
            nightSignal = NightSignal("green", 52.0, 51.0, 1.0),
            dayScore = 78.0 - (i % 4),
            vo2max = 51.0,
        )
        return emptyDay(date, complete).copy(
            steps = (9800 + 2400 * wave).roundToInt().toDouble(),
            stepsSource = "samsung_health_total",
            distanceMEst = 7800 + 1600 * wave,
            activeMinutesEst = 64 + 20 * wave,
            activityKcalEst = 600 + 150 * wave,
            totalKcalEst = 2400 + 180 * wave,
            restingHr = Selected(51.0 + (2 * sin(i * 0.35)).roundToInt(), ValueSource.MEASURED),
            hrv = Selected(58.0 + (i % 6), ValueSource.MEASURED),
            hrvKind = "rmssd",
            hrResting = 52.0,
            hrMin = 47.0, hrMax = 171.0, hrAvg = 74.0,
            zoneLightMin = 40.0, zoneModerateMin = 15.0, zoneVigorousMin = 5.0,
            sleepStart = start, sleepEnd = end, sleepMinutes = 456.0,
            sleepDeepMin = 90.0, sleepRemMin = 110.0, sleepLightMin = 256.0, sleepAwakeMin = 8.0,
            sleepTimeline = timeline,
            workouts = if (i % 2 == 0) listOf(run(date, 7, 10)) else emptyList(),
            scores = scores,
        )
    }

    /** [count] days ending at [end], the last one still running. */
    fun richDays(end: String, count: Int): List<Day> {
        val last = LocalDate.parse(end)
        return (count - 1 downTo 0).mapIndexed { index, back ->
            richDay(last.minusDays(back.toLong()).toString(), index, complete = back != 0)
        }
    }

    fun dataset(days: List<Day>, synced: Instant?) = Dataset(
        timezone = ZONE, firstDay = days.firstOrNull()?.day, lastDay = days.lastOrNull()?.day,
        syncedAt = synced, latestMeasurementAt = synced, lastComputeSuccessAt = synced, days = days,
    )
}

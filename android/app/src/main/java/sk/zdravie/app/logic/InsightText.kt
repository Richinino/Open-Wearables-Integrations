package sk.zdravie.app.logic

import kotlin.math.abs

/** Port of web/src/lib/insight-text.ts: the server sends keys and evidence, the client words them. */
object InsightText {
    const val UNKNOWN = "Nový postreh je dostupný v novšej verzii klienta."

    private fun number(value: Double): String = Format.formatDecimal(value, 1).removeSuffix(",0")
    private fun delta(evidence: Map<String, Any?>): Double =
        ((evidence["delta"] as? Number)?.toDouble() ?: 0.0).takeIf { it.isFinite() } ?: 0.0

    fun of(messageKey: String, evidence: Map<String, Any?>): String {
        val delta = delta(evidence)
        val size = number(abs(delta))
        return when (messageKey) {
            "sleep_duration" -> "Spánok bol o $size minút ${if (delta < 0) "kratší" else "dlhší"} než medián tvojich predchádzajúcich nocí."
            "resting_hr_trend" -> "Medián pokojového tepu za posledný týždeň je o $size bpm ${if (delta < 0) "nižší" else "vyšší"} než počas predchádzajúcich troch týždňov."
            "readiness_change" -> "Vypočítaná pripravenosť sa oproti včerajšku ${if (delta < 0) "znížila" else "zvýšila"} o $size bodov."
            "readiness_comparability" -> "Zmenu pripravenosti zatiaľ nemožno presne rozdeliť medzi jej zložky: líši sa výpočet, jeho vstupy alebo chýba evidencia verzie."
            else -> UNKNOWN
        }
    }
}

plugins {
    id("com.android.application") version "9.1.1" apply false
    // Declaring a newer KGP upgrades the built-in Kotlin used by AGP as well.
    id("org.jetbrains.kotlin.android") version "2.4.10" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
}

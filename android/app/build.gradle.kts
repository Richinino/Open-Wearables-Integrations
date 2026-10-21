import java.util.Properties
import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}
val appVersion = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}
val releaseVersionCode = providers.gradleProperty("androidVersionCode").orElse(appVersion.getProperty("versionCode")).get().toInt()
val releaseVersionName = providers.gradleProperty("androidVersionName").orElse(appVersion.getProperty("versionName")).get()
require(releaseVersionCode in 1..2_100_000_000)
require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(releaseVersionName))
val updateRepository = providers.gradleProperty("updateRepository").orElse("Richinino/Open-Wearables-Integrations").get()
require(Regex("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+").matches(updateRepository))
val apiBaseUrl = providers.gradleProperty("apiBaseUrl").orElse("https://zdravie-rho.vercel.app/").get()
val apiOrigin = URI(apiBaseUrl)
require(apiOrigin.scheme == "https" && apiOrigin.host != null && apiOrigin.rawUserInfo == null &&
    apiOrigin.rawQuery == null && apiOrigin.rawFragment == null && apiOrigin.port == -1 &&
    apiOrigin.path in listOf("", "/")) { "apiBaseUrl must be a canonical HTTPS origin" }
android {
    namespace = "sk.zdravie.app"
    compileSdk = 37
    defaultConfig {
        applicationId = "sk.zdravie.app"
        minSdk = 26
        targetSdk = 36
        versionCode = releaseVersionCode
        versionName = releaseVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl.trimEnd('/')}\"")
        buildConfigField("String", "UPDATE_REPOSITORY", "\"$updateRepository\"")
    }
    signingConfigs {
        create("release") {
            providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull?.let { path ->
                storeFile = file(path)
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").get()
            }
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("com.squareup.okhttp3:okhttp-tls:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

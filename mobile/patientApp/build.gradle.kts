import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Supabase URL and publishable key: environment variables win, else the git-ignored
// mobile/local.secrets.properties. Never committed.
val secrets =
    Properties().apply {
        val file = rootProject.file("local.secrets.properties")
        if (file.isFile) file.inputStream().use(::load)
    }

fun secret(
    key: String,
    env: String,
): String = providers.environmentVariable(env).orNull ?: secrets.getProperty(key).orEmpty()

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.aarogyam.patient.android"
    compileSdk =
        libs.versions.android.compileSdk
            .get()
            .toInt()
    defaultConfig {
        // The decided store id (docs/decisions.md, "Aarogyam" naming).
        applicationId = "com.sakalya.patient"
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        targetSdk =
            libs.versions.android.targetSdk
                .get()
                .toInt()
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "SUPABASE_URL", quoted(secret("supabase.url", "AAROGYAM_SUPABASE_URL")))
        buildConfigField("String", "SUPABASE_KEY", quoted(secret("supabase.key", "AAROGYAM_SUPABASE_KEY")))
        buildConfigField("String", "PROD_APP_HOST", quoted(secret("prod.app_host", "AAROGYAM_PROD_APP_HOST")))
    }
    flavorDimensions += "environment"
    productFlavors {
        create("local") {
            dimension = "environment"
            applicationIdSuffix = ".local"
            buildConfigField("String", "ENVIRONMENT", quoted("Local"))
        }
        create("demo") {
            dimension = "environment"
            applicationIdSuffix = ".demo"
            buildConfigField("String", "ENVIRONMENT", quoted("Demo"))
        }
        create("prod") {
            dimension = "environment"
            buildConfigField("String", "ENVIRONMENT", quoted("Prod"))
        }
    }
    // The development sign-in exists in the local flavour's debug build only; every other variant
    // gets an empty stand-in, and `checkNoDevSignIn` proves it.
    sourceSets {
        for (name in listOf("demo", "prod", "localRelease")) {
            maybeCreate(name).kotlin.directories.add("src/noDevSignIn/kotlin")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    lint {
        warningsAsErrors = true
        abortOnError = true
        checkDependencies = false
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions { allWarningsAsErrors.set(true) }
}

dependencies {
    implementation(project(":patientShared"))
    implementation(libs.sakalya.design.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.navigation.compose)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
}

// Fails the build if any variant but the local flavour's debug build contains the development
// sign-in (its class, or the local API's dev-token route). Part of `./gradlew check`.
val devSignInVariants = listOf("DemoDebug", "DemoRelease", "ProdDebug", "ProdRelease", "LocalRelease")

val checkNoDevSignIn =
    tasks.register("checkNoDevSignIn") {
        group = "verification"
        description = "Proves demo, prod and release builds do not contain the development sign-in."
        dependsOn((devSignInVariants + "LocalDebug").map { "compile${it}Kotlin" })
        val classDirs =
            (devSignInVariants + "LocalDebug").associateWith { variant ->
                val dir = variant.replaceFirstChar(Char::lowercase)
                layout.buildDirectory
                    .dir("intermediates/built_in_kotlinc/$dir/compile${variant}Kotlin/classes")
                    .get()
                    .asFile
            }
        doLast {
            val found =
                classDirs.mapValues { (_, dir) ->
                    dir
                        .walkTopDown()
                        .filter {
                            it.isFile && (
                                it.name.contains(
                                    "DevPatient",
                                ) || it.readText().contains("dev/token")
                            )
                        }.map { it.path }
                        .toList()
                }
            // Control: the check must see the sign-in where it exists, or it proves nothing.
            check(found.getValue("LocalDebug").isNotEmpty()) { "checkNoDevSignIn cannot find the local debug sign-in" }
            val offenders = found.filterKeys { it != "LocalDebug" }.values.flatten()
            check(offenders.isEmpty()) { "Development sign-in found in: ${offenders.joinToString()}" }
        }
    }
tasks.named("check") { dependsOn(checkNoDevSignIn) }

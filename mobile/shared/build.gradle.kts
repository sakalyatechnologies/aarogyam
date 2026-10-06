import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.openapitools.generator.gradle.plugin.tasks.GenerateTask

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.kmp.library)
    alias(libs.plugins.android.lint)
    alias(libs.plugins.openapi.generator)
    // Swift sees flows as AsyncSequence, sealed types as enums and suspend functions as async.
    alias(libs.plugins.skie)
}

// The models the screens use, generated from the committed OpenAPI document. Add a schema here
// when a screen needs it; the build regenerates them whenever docs/api/openapi.json changes.
val apiModels =
    listOf(
        "Me",
        "MyClinic",
        "Session",
        "SessionClinic",
        "SessionMembership",
        "SessionUser",
        "TodayResponse",
        "TodayCounts",
        "Appointment",
        "PatientBrief",
        "PractitionerBrief",
        "AttentionItem",
        "AttentionPatient",
        "HourBar",
        "ChairStatus",
        "ChairAppointment",
        "LowStockAlert",
        "QueueToken",
        "TeamMemberToday",
        "TodayShift",
        "SearchRequest",
        "PatientList",
        "Patient",
        "NextAppointment",
        "ClinicalFlags",
        "Allergy",
        "Condition",
        "Code",
        "VisitList",
        "Visit",
        "MemberRef",
        "AppointmentList",
        "PractitionerList",
        "Practitioner",
        "RoomList",
        "Room",
        "DentalChart",
        "ChartEntry",
        "NewChartEntries",
        "NewChartEntry",
    )
val generatedApi = layout.buildDirectory.dir("generated/openapi")

val generateApiModels =
    tasks.register<GenerateTask>("generateApiModels") {
        generatorName.set("kotlin")
        library.set("multiplatform")
        inputSpec.set(rootProject.file("../docs/api/openapi.json").path)
        outputDir.set(generatedApi.map { it.asFile.path })
        packageName.set("com.aarogyam.staff.api")
        modelPackage.set("com.aarogyam.staff.api.model")
        globalProperties.set(
            mapOf(
                "models" to apiModels.joinToString(","),
                "modelDocs" to "false",
                "modelTests" to "false",
            ),
        )
        configOptions.set(
            mapOf(
                "dateLibrary" to "string",
                "enumPropertyNaming" to "UPPERCASE",
                "sourceFolder" to "src/commonMain/kotlin",
            ),
        )
        typeMappings.set(mapOf("object" to "kotlinx.serialization.json.JsonObject"))
        importMappings.set(mapOf("kotlinx.serialization.json.JsonObject" to "kotlinx.serialization.json.JsonObject"))
        cleanupOutput.set(true)
        // utoipa omits some response descriptions, which strict 3.x validation rejects.
        validateSpec.set(false)
    }

kotlin {
    jvmToolchain(17)
    compilerOptions {
        allWarningsAsErrors.set(true)
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }
    android {
        namespace = "com.aarogyam.staff.shared"
        compileSdk =
            libs.versions.android.compileSdk
                .get()
                .toInt()
        minSdk =
            libs.versions.android.minSdk
                .get()
                .toInt()
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
        lint {
            warningsAsErrors = true
            abortOnError = true
            disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
        }
        withHostTest { isReturnDefaultValues = true }
    }
    // JVM runs commonTest fast; the iOS targets build the framework the SwiftUI app links.
    jvm { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
        target.binaries.framework {
            baseName = "AarogyamShared"
            isStatic = true
            binaryOption("bundleId", "com.aarogyam.staff.shared")
            // Unprefixed Swift names for the sakalya-mobile types screens use (SessionState, AppTheme).
            export(libs.sakalya.core)
            export(libs.sakalya.auth)
            export(libs.sakalya.design)
        }
    }
    sourceSets {
        commonMain {
            kotlin.srcDir(generateApiModels.map { generatedApi.get().dir("src/commonMain/kotlin") })
            dependencies {
                api(libs.sakalya.core)
                api(libs.sakalya.http)
                api(libs.sakalya.auth)
                api(libs.sakalya.secure.storage)
                api(libs.sakalya.design)
                api(libs.kotlinx.coroutines.core)
                api(libs.kotlinx.datetime)
                api(libs.kotlinx.serialization.json)
            }
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
        matching { it.name.endsWith("Test") }.configureEach {
            languageSettings.optIn("kotlinx.coroutines.ExperimentalCoroutinesApi")
        }
        all {
            // Generated models mark required fields with @Required.
            languageSettings.optIn("kotlinx.serialization.ExperimentalSerializationApi")
        }
    }
}

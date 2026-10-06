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
    namespace = "com.aarogyam.staff.android"
    compileSdk =
        libs.versions.android.compileSdk
            .get()
            .toInt()
    defaultConfig {
        applicationId = "com.aarogyam.staff"
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
    implementation(project(":shared"))
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

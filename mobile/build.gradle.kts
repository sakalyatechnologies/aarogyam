plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.kmp.library) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.openapi.generator) apply false
    alias(libs.plugins.skie) apply false
    alias(libs.plugins.spotless)
}

val ktlintVersion: String = libs.versions.ktlint.get()

// ktlint through Spotless on every project; `check` depends on `spotlessCheck`.
allprojects {
    apply(plugin = "com.diffplug.spotless")
    extensions.configure<com.diffplug.gradle.spotless.SpotlessExtension> {
        kotlinGradle {
            target(
                if (project ==
                    rootProject
                ) {
                    files("build.gradle.kts", "settings.gradle.kts")
                } else {
                    files("build.gradle.kts")
                },
            )
            ktlint(ktlintVersion)
        }
        if (project != rootProject) {
            kotlin {
                target(fileTree("src") { include("**/*.kt") })
                ktlint(ktlintVersion)
            }
        }
    }
}

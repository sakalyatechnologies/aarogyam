rootProject.name = "aarogyam-mobile"

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

// sakalya-mobile, pinned in sakalya-mobile.version and checked out by scripts/mobile-deps.sh.
// Gradle substitutes com.sakalya.mobile:<module> with the included build's projects.
val sakalyaMobile = file(".deps/sakalya-mobile")
require(sakalyaMobile.resolve("settings.gradle.kts").isFile) {
    "sakalya-mobile is missing: run ../scripts/mobile-deps.sh first"
}
includeBuild(sakalyaMobile)

include(":shared")

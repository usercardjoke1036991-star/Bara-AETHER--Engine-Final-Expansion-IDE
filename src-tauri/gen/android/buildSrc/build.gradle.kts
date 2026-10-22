plugins {
    `kotlin-dsl`
}

// Una sola fuente: scripts/android/BuildTask.kt. No se copia al arbol
// generado, porque Sonar contaria las dos copias como duplicado.
sourceSets.main {
    kotlin.srcDir("../../../../scripts/android")
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    compileOnly(gradleApi())
    implementation("com.android.tools.build:gradle:9.3.1")
}


// Canonical copy. scripts/build_android.ps1 copies this file to
// src-tauri/gen/android/buildSrc/src/main/java/com/aetheromega/bara/ide/kotlin/BuildTask.kt.
// Do not edit the generated copy by hand.
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Properties
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject
import org.gradle.process.ExecOperations

/**
 * Builds the Rust Android library without going through the Tauri CLI.
 *
 * The generated `tauri android android-studio-script` task asks the CLI to
 * build Cargo and then lets cargo-mobile2 create the jniLibs entry as a
 * symbolic link. Creating symlinks on Windows requires Developer Mode (or
 * SeCreateSymbolicLinkPrivilege), so that path fails on a default Windows
 * setup. Invoking Cargo ourselves with the NDK toolchain and copying the
 * resulting .so into jniLibs is equivalent and works on every host.
 */
abstract class BuildTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var projectDir: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    private val isWindows = Os.isFamily(Os.FAMILY_WINDOWS)
    private val clangSuffix = if (isWindows) ".cmd" else ""
    private val toolSuffix = if (isWindows) ".exe" else ""

    @TaskAction
    fun assemble() {
        val rootDirRelValue = rootDirRel
            ?: throw GradleException("rootDirRel cannot be null")
        val projectDirValue = projectDir
            ?: throw GradleException("projectDir cannot be null")
        val targetName = target
            ?: throw GradleException("target cannot be null")
        val releaseValue = release
            ?: throw GradleException("release cannot be null")
        val triple = TARGET_TRIPLE[targetName]
            ?: throw GradleException("Unsupported Android target: $targetName")
        val abi = TARGET_ABI[targetName]
            ?: throw GradleException("Unsupported Android ABI for target: $targetName")
        val profile = if (releaseValue) "release" else "debug"
        val srcTauriDir = File(projectDirValue, rootDirRelValue).absoluteFile
        if (!srcTauriDir.isDirectory) {
            throw GradleException("Rust project directory not found: $srcTauriDir")
        }

        val ndkHome = resolveNdkHome(projectDirValue)
        val sdkHome = resolveAndroidSdk(projectDirValue, ndkHome)
        val apiLevel = resolveMinSdk(projectDirValue)
        val hostTag = ndkHostTag()
        val toolchainBin = File(ndkHome, "toolchains/llvm/prebuilt/$hostTag/bin")
        val clangPrefix = CLANG_PREFIX[targetName]
            ?: throw GradleException("No clang prefix configured for target: $targetName")
        val clang = File(toolchainBin, "$clangPrefix$apiLevel-clang$clangSuffix")
        if (!clang.isFile) {
            throw GradleException(
                "Android NDK clang not found: $clang. Install the NDK with " +
                    "sdkmanager --install \"ndk;27.1.12297006\"."
            )
        }
        val llvmAr = File(toolchainBin, "llvm-ar$toolSuffix")
        val llvmRanlib = File(toolchainBin, "llvm-ranlib$toolSuffix")

        val linkerEnv = "CARGO_TARGET_${triple.uppercase().replace('-', '_')}_LINKER"
        val underscoredTriple = triple.replace('-', '_')
        val output = ByteArrayOutputStream()

        logger.lifecycle("Building Rust library for $triple ($profile) with Cargo")
        execOperations.exec {
            workingDir(srcTauriDir)
            executable(CARGO)
            args("build", "--lib", "--target", triple)
            if (releaseValue) {
                args("--release")
            }

            environment("ANDROID_HOME", sdkHome.absolutePath)
            environment("ANDROID_SDK_ROOT", sdkHome.absolutePath)
            environment("ANDROID_NDK_HOME", ndkHome.absolutePath)
            environment("NDK_HOME", ndkHome.absolutePath)

            // Cargo reads the linker from CARGO_TARGET_<TRIPLE>_LINKER; the cc
            // crate reads CC/AR/RANLIB. Both hyphenated and underscored names
            // are set because host environment rules differ between platforms.
            environment(linkerEnv, clang.absolutePath)
            environment("CC_$triple", clang.absolutePath)
            environment("AR_$triple", llvmAr.absolutePath)
            environment("RANLIB_$triple", llvmRanlib.absolutePath)
            environment("CC_$underscoredTriple", clang.absolutePath)
            environment("AR_$underscoredTriple", llvmAr.absolutePath)
            environment("RANLIB_$underscoredTriple", llvmRanlib.absolutePath)

            // tauri-build/tauri read these during Android compilation.
            environment("TAURI_ENV_TARGET_TRIPLE", triple)
            environment("TAURI_ENV_PLATFORM", "android")
            environment("TAURI_ENV_FAMILY", "unix")
            environment("TAURI_ENV_ARCH", TAURI_ARCH[targetName] ?: targetName)
            environment("TAURI_ENV_DEBUG", (!releaseValue).toString())
            environment("TAURI_ENV_PLATFORM_VERSION", apiLevel.toString())

            // The Tauri CLI points tauri-build at gen/android so it can
            // regenerate the Gradle container. That regeneration overwrites
            // this patched buildSrc, so leave the existing project untouched.
            environment.remove("TAURI_ANDROID_PROJECT_PATH")

            standardOutput = output
            errorOutput = output
        }.assertNormalExitValue()

        logger.lifecycle(output.toString())
        val destination = copyLibraryToJniLibs(srcTauriDir, abi, triple, profile)
        logger.lifecycle(
            "Copied ${destination.name} to jniLibs/$abi " +
                "(${destination.length() / (1024 * 1024)} MiB)"
        )
    }

    private fun resolveNdkHome(projectDirValue: String): File {
        for (key in listOf("ANDROID_NDK_HOME", "NDK_HOME")) {
            val value = System.getenv(key)
            if (!value.isNullOrBlank()) {
                val candidate = File(value).absoluteFile
                if (File(candidate, "source.properties").isFile) {
                    return candidate
                }
            }
        }

        val sdk = resolveAndroidSdkOrNull(projectDirValue)
        if (sdk != null) {
            val versions = File(sdk, "ndk")
                .listFiles { file -> file.isDirectory && File(file, "source.properties").isFile }
                ?.sortedByDescending { it.name }
            if (!versions.isNullOrEmpty()) {
                return versions.first().absoluteFile
            }
            val legacy = File(sdk, "ndk-bundle")
            if (File(legacy, "source.properties").isFile) {
                return legacy.absoluteFile
            }
        }

        throw GradleException(
            "Android NDK not found. Define ANDROID_NDK_HOME or install one under <sdk>/ndk."
        )
    }

    private fun resolveAndroidSdk(projectDirValue: String, ndkHome: File): File {
        resolveAndroidSdkOrNull(projectDirValue)?.let { return it }

        // NDK layout: <sdk>/ndk/<version>
        val fromNdk = ndkHome.parentFile?.parentFile
        if (fromNdk != null && File(fromNdk, "platform-tools").isDirectory) {
            return fromNdk.absoluteFile
        }

        throw GradleException("Android SDK not found. Define ANDROID_HOME.")
    }

    private fun resolveAndroidSdkOrNull(projectDirValue: String): File? {
        for (key in listOf("ANDROID_HOME", "ANDROID_SDK_ROOT")) {
            val value = System.getenv(key)
            if (!value.isNullOrBlank() && File(value).isDirectory) {
                return File(value).absoluteFile
            }
        }

        // gen/android/local.properties (projectDir is gen/android/app).
        for (relative in listOf("../local.properties", "local.properties")) {
            val propertiesFile = File(projectDirValue, relative)
            if (!propertiesFile.isFile) {
                continue
            }
            val properties = Properties()
            propertiesFile.inputStream().use { properties.load(it) }
            val sdkDir = properties.getProperty("sdk.dir")
            if (!sdkDir.isNullOrBlank()) {
                val candidate = File(sdkDir.replace("\\\\", "\\")).absoluteFile
                if (candidate.isDirectory) {
                    return candidate
                }
            }
        }

        return null
    }

    private fun resolveMinSdk(projectDirValue: String): Int {
        val buildFile = File(projectDirValue, "build.gradle.kts")
        if (buildFile.isFile) {
            val match = Regex("""minSdk\s*=\s*(\d+)""").find(buildFile.readText())
            if (match != null) {
                return match.groupValues[1].toInt()
            }
        }
        return 24
    }

    private fun ndkHostTag(): String {
        val os = System.getProperty("os.name").lowercase()
        val arch = System.getProperty("os.arch").lowercase()
        return when {
            os.contains("win") -> "windows-x86_64"
            os.contains("mac") || os.contains("darwin") -> "darwin-x86_64"
            os.contains("linux") ->
                if (arch.contains("aarch64") || arch.contains("arm64")) {
                    "linux-aarch64"
                } else {
                    "linux-x86_64"
                }
            else -> throw GradleException("Unsupported NDK host platform: $os/$arch")
        }
    }


    private fun copyLibraryToJniLibs(
        srcTauriDir: File,
        abi: String,
        triple: String,
        profile: String,
    ): File {
        val targetRoots = linkedSetOf<File>()
        System.getenv("CARGO_TARGET_DIR")?.takeIf { it.isNotBlank() }?.let { configured ->
            val configuredDir = File(configured)
            targetRoots += if (configuredDir.isAbsolute) {
                configuredDir
            } else {
                File(srcTauriDir, configured)
            }
        }
        targetRoots += File(srcTauriDir, "target")
        targetRoots += File(srcTauriDir, "../../target")
        targetRoots += File(srcTauriDir, "../../../target")

        val sourceDir = targetRoots
            .map { File(it, "$triple/$profile") }
            .firstOrNull { it.isDirectory }
            ?: throw GradleException(
                "Cargo finished but no output directory was found for $triple/$profile. " +
                    "Checked: " + targetRoots.joinToString { File(it, "$triple/$profile").absolutePath }
            )

        val expectedName = expectedLibraryName(srcTauriDir)
        val libraries = sourceDir.listFiles()
            ?.asSequence()
            ?.filter {
                it.isFile &&
                    it.name.startsWith("lib") &&
                    it.name.endsWith(".so") &&
                    it.name != "libc++_shared.so"
            }
            ?.sortedByDescending { it.lastModified() }
            ?.toList()
            .orEmpty()
        val library = libraries.firstOrNull { it.name == expectedName }
            ?: libraries.firstOrNull()
            ?: throw GradleException("Cargo finished but no .so was produced in $sourceDir")

        val appDir = projectDir
            ?: throw GradleException("projectDir cannot be null")
        val destinationDir = File(appDir, "src/main/jniLibs/$abi")
        destinationDir.mkdirs()
        val destination = File(destinationDir, library.name)
        Files.copy(library.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING)
        if (!destination.isFile || destination.length() != library.length()) {
            throw GradleException("Failed to copy ${library.name} to $destination")
        }
        return destination
    }

    private fun expectedLibraryName(srcTauriDir: File): String? {
        val cargoToml = File(srcTauriDir, "Cargo.toml")
        if (!cargoToml.isFile) {
            return null
        }
        val libSection = Regex("""(?s)\[lib]\s*(.*?)(?:\r?\n\[|\z)""")
            .find(cargoToml.readText())
            ?.groupValues
            ?.get(1)
            ?: return null
        val name = Regex("""(?m)^\s*name\s*=\s*"([^"]+)"""")
            .find(libSection)
            ?.groupValues
            ?.get(1)
            ?: return null
        return "lib${name.replace('-', '_')}.so"
    }

    private companion object {
        const val CARGO = "cargo"

        val TARGET_ABI = mapOf(
            "aarch64" to "arm64-v8a",
            "armv7" to "armeabi-v7a",
            "i686" to "x86",
            "x86_64" to "x86_64",
        )
        val TARGET_TRIPLE = mapOf(
            "aarch64" to "aarch64-linux-android",
            "armv7" to "armv7-linux-androideabi",
            "i686" to "i686-linux-android",
            "x86_64" to "x86_64-linux-android",
        )
        val CLANG_PREFIX = mapOf(
            "aarch64" to "aarch64-linux-android",
            "armv7" to "armv7a-linux-androideabi",
            "i686" to "i686-linux-android",
            "x86_64" to "x86_64-linux-android",
        )
        val TAURI_ARCH = mapOf(
            "aarch64" to "aarch64",
            "armv7" to "arm",
            "i686" to "x86",
            "x86_64" to "x86_64",
        )
    }
}


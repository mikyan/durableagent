plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "dev.durableagent.probe"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = providers.gradleProperty("validationApplicationId").orElse("dev.durableagent.probe").get().also { require(it == "dev.durableagent.probe" || it == "dev.durableagent.retention") }
        minSdk = 36
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { jniLibs { useLegacyPackaging = false } }
    buildFeatures { buildConfig = true }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/runtimeAssets"))
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
val npmBuild = if(System.getProperty("os.name").startsWith("Windows")) listOf("cmd","/c","npm.cmd","run","build") else listOf("npm","run","build")
val buildRuntime by tasks.registering(Exec::class) {
    workingDir(file("../../runtime"))
    inputs.dir("../../runtime/src")
    inputs.files("../../runtime/tsconfig.json","../../runtime/package.json","../../runtime/package-lock.json")
    outputs.dir("../../runtime/dist")
    commandLine(npmBuild)
    doFirst { check(file("../../runtime/node_modules").isDirectory) { "Run npm ci in runtime/ before building the Android app" } }
}
val buildUi by tasks.registering(Exec::class) {
    dependsOn(buildRuntime)
    workingDir(file("../../ui"))
    inputs.dir("../../ui/src");inputs.dir("../../ui/test");inputs.dir("../../runtime/src")
    inputs.files("../../ui/tsconfig.json","../../ui/vite.config.ts","../../ui/index.html","../../ui/package.json","../../ui/package-lock.json")
    outputs.dir("../../ui/dist")
    commandLine(npmBuild)
    doFirst { check(file("../../ui/node_modules").isDirectory) { "Run npm ci in ui/ before building the Android app" } }
}
val packageRuntime by tasks.registering(Zip::class) {
    dependsOn(buildRuntime)
    archiveFileName.set("runtime.zip")
    destinationDirectory.set(layout.buildDirectory.dir("generated/runtimeAssets"))
    from("../../runtime") {
        include("dist/**", "validation/**", "package.json", "package-lock.json", "node_modules/**")
        exclude("node_modules/typescript/**", "node_modules/@types/**", "node_modules/.bin/**", "node_modules/.package-lock.json")
    }
    isReproducibleFileOrder = true
    isPreserveFileTimestamps = false
    doFirst { check(file("../../runtime/dist/bridge.js").exists()) { "Run npm ci and npm run build in runtime/ first" } }
}
val packageUi by tasks.registering(Sync::class) {
    dependsOn(buildUi)
    from("../../ui/dist")
    into(layout.buildDirectory.dir("generated/runtimeAssets/ui"))
    doFirst {check(file("../../ui/dist/index.html").exists()) {"Run npm ci and npm run build in ui/ first"}}
}
val generateExecutionSetup by tasks.registering(Exec::class) {
    val output=layout.buildDirectory.file("generated/runtimeAssets/execution-setup.txt")
    inputs.files("../../tools/build_execution_setup.py","../../tools/execution_setup_installer.py","../../managed-execution/durable_executor.py","../../managed-execution/execution_transport.py")
    outputs.file(output)
    commandLine("python",file("../../tools/build_execution_setup.py").absolutePath,"--output",output.get().asFile.absolutePath)
}
tasks.named("preBuild").configure { dependsOn(packageRuntime,packageUi,generateExecutionSetup) }
dependencies {
    implementation("com.caoccao.javet:javet-node-android-i18n:6.0.3")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "dev.durableagent.probe"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "dev.durableagent.probe"
        minSdk = 36
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { jniLibs { useLegacyPackaging = false } }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/runtimeAssets"))
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
val packageRuntime by tasks.registering(Zip::class) {
    archiveFileName.set("runtime.zip")
    destinationDirectory.set(layout.buildDirectory.dir("generated/runtimeAssets"))
    from("../../runtime") {
        include("dist/**", "package.json", "package-lock.json", "node_modules/**")
        exclude("node_modules/typescript/**", "node_modules/@types/**", "node_modules/.bin/**", "node_modules/.package-lock.json")
    }
    isReproducibleFileOrder = true
    isPreserveFileTimestamps = false
    doFirst { check(file("../../runtime/dist/bridge.js").exists()) { "Run npm ci and npm run build in runtime/ first" } }
}
val packageUi by tasks.registering(Sync::class) {
    from("../../ui/dist")
    into(layout.buildDirectory.dir("generated/runtimeAssets/ui"))
    doFirst {check(file("../../ui/dist/index.html").exists()) {"Run npm ci and npm run build in ui/ first"}}
}
tasks.named("preBuild").configure { dependsOn(packageRuntime,packageUi) }
dependencies {
    implementation("com.caoccao.javet:javet-node-android-i18n:6.0.3")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

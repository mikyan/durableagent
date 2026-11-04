plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace="dev.durableagent.backupfixture"
    compileSdk=36
    defaultConfig { applicationId="dev.durableagent.backupfixture";minSdk=36;targetSdk=36;versionCode=1;versionName="synthetic-1";testInstrumentationRunner="androidx.test.runner.AndroidJUnitRunner" }
    flavorDimensions += "policy"
    productFlavors {
        create("rules") { dimension="policy";applicationIdSuffix=".rules";manifestPlaceholders["extractionRules"]="@xml/data_extraction_rules" }
        create("control") { dimension="policy";applicationIdSuffix=".control";manifestPlaceholders["extractionRules"]="@xml/permissive_rules" }
    }
    sourceSets["main"].res.srcDir("../app/src/main/res")
    compileOptions { sourceCompatibility=JavaVersion.VERSION_17;targetCompatibility=JavaVersion.VERSION_17 }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies { androidTestImplementation("androidx.test:runner:1.6.2");androidTestImplementation("androidx.test:core:1.6.1");androidTestImplementation("androidx.test.ext:junit:1.2.1") }

plugins { id("com.android.application") }
android {
    namespace="dev.durableagent.documentsfixture"
    compileSdk=36
    buildToolsVersion="36.0.0"
    defaultConfig { applicationId="dev.durableagent.documentsfixture";minSdk=36;targetSdk=36;versionCode=1;versionName="1" }
    compileOptions {sourceCompatibility=JavaVersion.VERSION_17;targetCompatibility=JavaVersion.VERSION_17}
}

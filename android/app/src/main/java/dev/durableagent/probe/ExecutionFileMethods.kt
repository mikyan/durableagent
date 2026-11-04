package dev.durableagent.probe

/** Trusted core boundary only. These methods are not exposed by NativeExecutionBridge to WebView. */
internal val EXECUTION_FILE_METHODS = setOf("file.open", "file.read", "file.info", "file.close", "file.stat", "file.canonical", "file.describe", "file.resolveWrite", "file.prepareWrite", "file.writeResult", "file.verifyWrite")

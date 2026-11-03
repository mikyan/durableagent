package dev.durableagent.termuxprobe

/** v0.118.3 ResultSender writes original lengths as decimal Strings, err as Activity.RESULT_OK (-1). */
fun decodeTermuxResult(wire: Map<String, Any?>): ProbeResult {
    val stdout = wire["stdout"] as? String ?: ""
    val stderr = wire["stderr"] as? String ?: ""
    val stdoutLength = (wire["stdout_original_length"] as? String)?.toLongOrNull()
    val stderrLength = (wire["stderr_original_length"] as? String)?.toLongOrNull()
    val incomplete = stdoutLength != stdout.length.toLong() || stderrLength != stderr.length.toLong() ||
        stdout.length > 16_384 || stderr.length > 16_384
    return ProbeResult(stdout.take(16_384), stderr.take(16_384), wire["exitCode"] as? Int ?: Int.MIN_VALUE,
        wire["err"] as? Int ?: Int.MIN_VALUE, (wire["errmsg"] as? String).orEmpty().take(4096), incomplete)
}

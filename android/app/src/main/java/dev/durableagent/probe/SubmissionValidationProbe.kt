package dev.durableagent.probe

import android.os.Process
import com.caoccao.javet.annotations.V8Function
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicReference

/** Bound only by the debuggable host. The public WebView has no access to this object. */
class SubmissionValidationProbe {
    private val stage=AtomicReference("")
    @V8Function fun at(value:String){
        require(value in setOf("sdk-before","sdk-after"))
        stage.set(value)
        CountDownLatch(1).await() // Instrumentation observes the boundary, then kills this owner PID.
    }
    fun state()=JSONObject().put("stage",stage.get()).put("pid",Process.myPid())
    fun halted()=stage.get().isNotEmpty()
}

package dev.durableagent.probe

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Real WebView/native envelope boundary, with no Node host and no Termux command effects. */
@RunWith(AndroidJUnit4::class)
class ExecutionUiTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun trustedPageRejectsCommandParametersAndUntrustedDocumentCannotReachNativeControl() {
        val run=UUID.randomUUID().toString()
        val request=JSONObject().put("protocol",1).put("connectionId",run).put("requestId","native-control-proof")
            .put("method","execution.cancel").put("payload",JSONObject().put("executionId","known-id").put("script","unrequested-command"))
        ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","input-only").putExtra("validationRun",run)).use {page->
            until { js(page,"document.readyState==='complete' && typeof window.__durableReceive==='function'")=="true" }
            js(page,"window.__executionProof=[];window.__durableReceive=x=>{if(x.requestId==='native-control-proof')window.__executionProof.push(x)}")
            js(page,"DurableNative.postMessage(${JSONObject.quote(request.toString())})")
            until {js(page,"window.__executionProof.length")=="1"}
            assertEquals("\"INVALID_EXECUTION_ID\"",js(page,"window.__executionProof[0].error.code"))
            // A hostile document is introduced by the test harness, never by product navigation.
            page.onActivity {it.webView!!.loadDataWithBaseURL("https://untrusted.invalid/","<html><body data-ready='true'></body></html>","text/html","UTF-8",null)}
            until {js(page,"document.readyState==='complete'")=="true"}
            val location=js(page,"location.href")
            if(location=="\"https://appassets.androidplatform.net/assets/ui/index.html\"") {
                evidence("navigation-blocked",location,false)
                return@use
            }
            assertEquals("true",js(page,"typeof DurableNative.postMessage==='function'"))
            js(page,"window.__executionProof=[];window.__durableReceive=x=>window.__executionProof.push(x)")
            js(page,"DurableNative.postMessage(${JSONObject.quote(request.toString())})")
            Thread.sleep(500)
            assertEquals("0",js(page,"window.__executionProof.length"))
            evidence("untrusted-document-bridge-rejected",location,true)
        }
    }
    private fun evidence(case:String,documentUrl:String,bridgeExercised:Boolean) {
        InstrumentationRegistry.getInstrumentation().sendStatus(0,android.os.Bundle().apply {putString("executionUiEvidence",JSONObject().put("case",case).put("documentUrl",documentUrl).put("untrustedBridgeExercised",bridgeExercised).put("trustedCommandParametersRejected",true).toString())})
    }
    private fun js(page:ActivityScenario<AgentActivity>,source:String):String {
        val result=CompletableFuture<String>()
        page.onActivity {it.webView!!.evaluateJavascript(source){value->result.complete(value)}}
        return result.get(10,TimeUnit.SECONDS)
    }
    private fun until(condition:()->Boolean) {
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10)
        while(System.nanoTime()<deadline){if(condition())return;Thread.sleep(50)}
        fail("Expected UI boundary was not observed before deadline")
    }
}

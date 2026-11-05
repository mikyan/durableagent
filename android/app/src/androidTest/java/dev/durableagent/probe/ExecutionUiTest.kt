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
    @Test fun setupButtonCopiesTheCompletePackagedCommandWithoutNode() {
        val run=UUID.randomUUID().toString()
        ActivityScenario.launch<AgentActivity>(Intent(context,AgentActivity::class.java).putExtra("validationMode","input-only").putExtra("validationRun",run)).use {page->
            until {js(page,"!!document.querySelector('.menu-button')")=="true"}
            js(page,"document.querySelector('.menu-button').click()")
            js(page,"Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='工具').click()")
            until {js(page,"Array.from(document.querySelectorAll('button')).some(x=>x.textContent==='复制初始化命令')")=="true"}
            js(page,"Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='复制初始化命令').click()")
            until {js(page,"document.body.textContent.includes('初始化命令已复制')")=="true"}
            val clipboard=CompletableFuture<String>()
            page.onActivity { activity->clipboard.complete(activity.getSystemService(android.content.ClipboardManager::class.java).primaryClip?.getItemAt(0)?.text?.toString()?:"") }
            val actual=clipboard.get(10,TimeUnit.SECONDS)
            val expected=context.assets.open("execution-setup.txt").bufferedReader().use {it.readText()}
            assertEquals(expected,actual)
            assertTrue(actual.contains("python=3.14.8"))
            assertTrue(actual.contains("openssl-tool=1:3.6.5"))
            assertTrue(actual.contains("DURABLE_EXECUTION_PAYLOAD"))
            assertTrue(actual.toByteArray(Charsets.UTF_8).size in 1..600000)
            InstrumentationRegistry.getInstrumentation().sendStatus(0,android.os.Bundle().apply {
                putString("executionSetupEvidence",JSONObject().put("clipboardMatchesAsset",true).put("bytes",actual.toByteArray(Charsets.UTF_8).size).put("sha256",ExecutionIdentity.sha256(actual.toByteArray(Charsets.UTF_8))).toString())
            })
        }
    }
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

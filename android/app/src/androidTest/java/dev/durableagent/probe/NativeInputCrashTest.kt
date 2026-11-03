package dev.durableagent.probe

import android.content.*
import android.net.Uri
import android.os.*
import android.provider.DocumentsContract
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Kills a real separate native process at a reported persistence boundary, never orderly close. */
@RunWith(AndroidJUnit4::class)
class NativeInputCrashTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun seed(namespace: String, attachment: Boolean): String? = NativeInputStore(context, namespace).use { store ->
        store.rememberConversation(JSONObject().put("id","chat").put("title","Synthetic crash test")
            .put("model",JSONObject().put("provider","validation").put("modelId","text").put("name","Validation")),
            JSONObject().put("version","validation-1").put("provider","validation").put("modelId","text").put("source","validation")
                .put("input",JSONArray(listOf("text"))).put("limits",JSONObject()).put("applicationPolicy",JSONObject()))
        if (!attachment) { store.save("chat",0,"initial","last confirmed text",emptyList()); null }
        else {
            val id = "fixture-${UUID.randomUUID()}"
            context.contentResolver.call(Uri.parse("content://${InputTestDocumentsProvider.AUTHORITY}"),"fixture.put",id,
                Bundle().apply { putByteArray("bytes","exact durable attachment 北京🌍".toByteArray()); putString("mime","text/plain"); putString("name","crash source") })
            store.selectSource("chat",0,"select",DocumentsContract.buildDocumentUri(InputTestDocumentsProvider.AUTHORITY,id),Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .getJSONArray("selections").getJSONObject(0).getString("id")
        }
    }
    private fun interrupt(namespace:String, action:String, stage:String, selection:String?=null) {
        val connected=CompletableFuture<IBinder>(); val barrier=CompletableFuture<JSONObject>(); val died=CompletableFuture<Unit>()
        val incoming=Messenger(Handler(Looper.getMainLooper()) { message ->
            barrier.complete(JSONObject(message.data.getString("value")!!)); true
        })
        val connection=object:ServiceConnection {
            override fun onServiceConnected(name:ComponentName,binder:IBinder) { binder.linkToDeath({died.complete(Unit)},0); connected.complete(binder) }
            override fun onServiceDisconnected(name:ComponentName) { died.complete(Unit) }
        }
        check(context.bindService(Intent(context,InputFaultProbeService::class.java),connection,Context.BIND_AUTO_CREATE))
        try {
            val remote=Messenger(connected.get(10,TimeUnit.SECONDS))
            remote.send(Message.obtain(null,1).apply { replyTo=incoming; data=Bundle().apply {putString("namespace",namespace);putString("action",action);putString("stage",stage);putString("selection",selection)} })
            val observed=barrier.get(15,TimeUnit.SECONDS); assertEquals(stage,observed.optString("stage")); assertNotEquals(Process.myPid(),observed.getInt("pid"))
            remote.send(Message.obtain(null,2)); died.get(10,TimeUnit.SECONDS)
            InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply {putString("inputCrashEvidence",JSONObject().put("stage",stage).put("separateProcessKilled",true).toString())})
        } finally { context.unbindService(connection) }
    }
    @Test fun nativeProcessDeathBeforeAndAfterDraftCommitRecoversAuthoritativeReceipt() {
        for(stage in listOf("transaction.beforeCommit","transaction.afterCommit")) {
            val namespace="input-test-${UUID.randomUUID()}"; seed(namespace,false)
            interrupt(namespace,"save",stage)
            NativeInputStore(context,namespace).use { store ->
                val current=store.read("chat")
                assertEquals(if(stage.endsWith("beforeCommit")) "last confirmed text" else "committed after interruption",current.getString("text"))
                assertEquals(if(stage.endsWith("beforeCommit"))1L else 2L,current.getLong("revision"))
                val receipt=store.save("chat",1,"interrupted-save","committed after interruption",emptyList())
                assertEquals(2L,receipt.getLong("revision")); assertEquals(receipt.toString(),store.save("chat",1,"interrupted-save","committed after interruption",emptyList()).toString())
            }
        }
    }
    @Test fun nativeProcessDeathAcrossObjectPublicationNeverLosesPinsOrUsesPartialBytes() {
        for(stage in listOf("object.synced","object.published","prepare.committed","freeze.committed")) {
            val namespace="input-test-${UUID.randomUUID()}"; val selection=seed(namespace,true)!!
            if(stage=="freeze.committed") NativeInputStore(context,namespace).use {it.prepare("chat",selection,"prepare-before-freeze")}
            interrupt(namespace,if(stage=="freeze.committed")"freeze" else "prepare",stage,selection)
            NativeInputStore(context,namespace).use { store ->
                val recovered=store.read("chat"); val state=recovered.getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state")
                if(stage=="object.synced"||stage=="object.published") {
                    assertEquals("failed",state); store.gc()
                    assertEquals("ready",store.prepare("chat",selection,"prepare-after-recovery").getJSONArray("selections").getJSONObject(0).getJSONObject("preparation").getString("state"))
                } else assertEquals("ready",state)
                val frozen=store.freeze("chat",1,if(stage=="freeze.committed")"interrupted-freeze" else "freeze-after-recovery")
                val token=frozen.getString("token"); val objectId=frozen.getJSONArray("representations").getJSONObject(0).getString("objectId")
                if(stage=="freeze.committed") assertEquals(frozen.toString(),store.freeze("chat",1,"interrupted-freeze").toString())
                store.clear("chat",1,"clear"); store.gc()
                assertArrayEquals("exact durable attachment 北京🌍".toByteArray(),store.readObjectBytes(token,objectId))
            }
        }
    }
}

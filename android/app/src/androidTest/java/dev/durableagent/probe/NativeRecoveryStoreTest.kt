package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeRecoveryStoreTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun oneWorkKeepsItsProbeBudgetAndEpochAcrossReopenAndDuplicateWake(){
        val namespace="recovery-${UUID.randomUUID()}";var now=100000L
        NativeRecoveryStore(context,namespace).use{store->
            store.wake(JSONObject().put("active",false).put("at",now+1000))
            val first=store.probe("fixed-input",now)
            assertTrue(first.getBoolean("allowed"));assertEquals(1,first.getInt("used"));assertEquals(now+1000,first.getLong("at"))
            assertFalse(store.probe("fixed-input",now).getBoolean("allowed"))
        }
        NativeRecoveryStore(context,namespace).use{store->
            assertEquals(101000L,store.readWake().getLong("at"))
            for(index in 2..5){now+=1000L shl (index-2);val next=store.probe("fixed-input",now);assertTrue(next.getBoolean("allowed"));assertEquals(index,next.getInt("used"));assertEquals(now+(1000L shl(index-1)),next.getLong("at"))}
            now+=16000
            assertFalse(store.probe("fixed-input",now).getBoolean("allowed"));assertEquals(5,store.probe("fixed-input",now+86400000).getInt("used"))
            assertTrue(store.probe("different-input",now).getBoolean("allowed"))
            assertFalse(store.probe("fixed-input",1).getBoolean("allowed"))
            store.wake(JSONObject().put("active",false));assertFalse(store.readWake().has("at"))
        }
    }
    @Test fun durableCompletionOutboxRetainsOneIdentityUntilAcknowledged(){
        val namespace="completion-${UUID.randomUUID()}"
        NativeRecoveryStore(context,namespace).use{store->
            val value=store.pendingCompletion("answer:101:37","original-chat")
            assertEquals("pending",value.getString("state"));assertEquals("original-chat",value.getString("conversationId"))
        }
        NativeRecoveryStore(context,namespace).use{store->
            assertEquals("pending",store.pendingCompletion("answer:101:37","original-chat").getString("state"))
            store.completeNotification("answer:101:37")
        }
        NativeRecoveryStore(context,namespace).use{store->
            assertEquals("published",store.pendingCompletion("answer:101:37","original-chat").getString("state"))
            assertEquals("pending",store.pendingCompletion("answer:101:38","original-chat").getString("state"))
            try{store.pendingCompletion("answer:101:37","wrong-chat");fail("Completion identity must retain conversation")}catch(_:IllegalArgumentException){}
        }
    }
}

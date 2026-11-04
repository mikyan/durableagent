package dev.durableagent.probe

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DataSaverAccessTest {
    private val context=InstrumentationRegistry.getInstrumentation().targetContext
    private fun expectCode(code:String,action:()->Unit){try{action();fail("Expected $code")}catch(error:NativeInputException){assertEquals(code,error.code)}}
    private fun invoke(access:NativeDataSaverAccess,method:String,value:JSONObject=JSONObject()):JSONObject {
        val response=JSONObject(access.requestJson(method,value.toString()))
        if(!response.getBoolean("ok")){val failure=response.getJSONObject("error");throw NativeInputException(failure.getString("code"),failure.getString("message"))}
        return response.getJSONObject("value")
    }
    @Test fun finalNativeFenceRechecksFactsAndUserStopAfterExactPreparedGrant(){
        val namespace="data-saver-access-${UUID.randomUUID()}";var network=DataSaverNetwork("synthetic",true,true)
        val owner=JSONObject().put("productId","chat").put("sdkConversationId",101).put("controlGeneration",1).put("namespace","termux:synthetic").put("taskId",201).put("callId","call").put("bindingId","binding").put("locationVersion",1)
        val request=JSONObject().put("executionId","operation").put("context",owner).put("command",JSONObject().put("kind","shell").put("script","unknown command")).put("cwd","/synthetic").put("env",JSONObject()).put("inheritEnv",true).put("timeoutMs",1000)
        NativeInputStore(context,namespace).use{inputs->
            inputs.rememberConversation(JSONObject().put("id","chat").put("title","chat").put("model",JSONObject().put("provider","fixture").put("modelId","test").put("name","Synthetic" )).put("submissionContext",JSONObject().put("sdkConversationId",101).put("associationVersion",1).put("location",JSONObject().put("workspaceId","default").put("version",1).put("identity","synthetic-directory"))),null)
            NativeExecutionFence(inputs).remember(request)
            NativeDataSaverAccess(context,namespace,{network},true).use{access->
                invoke(access,"configure",JSONObject().put("enabled",true).put("expectedVersion",0))
                val registered=invoke(access,"register",request);val digest=registered.getString("requestDigest")
                val prepared=invoke(access,"prepared",JSONObject().put("executionId","operation").put("requestDigest",digest).put("finalDigest","a".repeat(64)))
                val grant=JSONObject().put("executionId","operation").put("requestDigest",digest).put("finalDigest","a".repeat(64)).put("period",prepared.getLong("period"))
                invoke(access,"grant",grant)
                // A changed live network invalidates the old period before final start.
                network=DataSaverNetwork("other-synthetic",true,true)
                expectCode("DATA_SAVER_WAIT"){access.requireStart("operation","a".repeat(64))}
                val current=invoke(access,"decision",JSONObject().put("executionId","operation"));grant.put("period",current.getLong("period"))
                invoke(access,"grant",grant);assertEquals("granted",access.requireStart("operation","a".repeat(64)).getString("phase"))
                inputs.requestStop(JSONObject().put("id","chat").put("actionId","stop-one").put("expectedControlVersion",0))
                network=DataSaverNetwork("other-synthetic",true,false)
                expectCode("EXECUTION_STOPPED"){access.requireStart("operation","a".repeat(64))}
                expectCode("EXECUTION_STOPPED"){invoke(access,"grant",grant)}
                val stopped=invoke(access,"operations",JSONObject().put("productId","chat")).getJSONArray("operations").getJSONObject(0)
                assertEquals("User stop must not be displayed as an available temporary grant","result-unverified",stopped.getString("phase"))
                assertEquals("user-stopped",stopped.getString("reason"))
            }
        }
    }
}

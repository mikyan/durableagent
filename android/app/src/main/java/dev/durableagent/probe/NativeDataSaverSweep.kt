package dev.durableagent.probe

import org.json.JSONObject

/** One bounded pass over policy-interrupted operations; external receipts remain authoritative. */
class NativeDataSaverSweep(private val store:NativeDataSaverStore,private val current:()->DataSaverNetwork,private val cancel:(JSONObject)->JSONObject) {
    private var cursor=""
    fun run():JSONObject=run(4096)
    fun run(limit:Int):JSONObject {
        require(limit in 1..4096);var attempted=0;var confirmed=0
        do {
            val page=store.claimAffected(current(),cursor);val rows=page.getJSONArray("operations")
            for(index in 0 until rows.length()){
                if(Thread.currentThread().isInterrupted)break
                val row=store.beginPolicyCancellation(rows.getJSONObject(index).getString("executionId"),current())?:continue
                attempted++
                try {
                    val observed=store.observe(cancel(row),current());if(observed.optBoolean("terminal"))confirmed++
                }catch(error:Exception){store.policyCancellationFailed(row.getString("executionId"),when(error){is NativeInputException->error.code;is ExecutionChannelException->error.code;else->"CANCEL_UNCONFIRMED"},current())}
                if(attempted>=limit){cursor=row.getString("executionId");return JSONObject().put("attempted",attempted).put("confirmed",confirmed)}
            }
            cursor=page.optString("nextCursor").takeUnless{page.isNull("nextCursor")}?:""
        }while(cursor.isNotEmpty()&&!Thread.currentThread().isInterrupted)
        return JSONObject().put("attempted",attempted).put("confirmed",confirmed)
    }
}

package dev.durableagent.probe

import org.json.JSONObject
import android.os.SystemClock

/** Bounded native control sweep. The transport owns proof; the store owns durable stop scope. */
class NativeStopSweep(private val store:NativeInputStore,private val cancel:(JSONObject)->JSONObject) {
    @JvmOverloads fun run(deadline:Long=SystemClock.elapsedRealtime()+20000):Int {
        fun <T> lease(action:()->T):T{while(true){try{return action()}catch(error:NativeInputException){if(error.code!="INPUT_STORAGE_BUSY"||SystemClock.elapsedRealtime()>=deadline)throw error;Thread.sleep(20)}}}
        var after:String?=null;var visited=0
        while(true){
            val page=lease{store.stoppedEffects(after)};if(page.length()==0)return visited
            for(index in 0 until page.length()){
                val row=page.getJSONObject(index);val id=row.getString("operationId");after=id
                try{val evidence=cancel(row);lease{store.recordEffectEvidence(id,evidence)}}
                catch(error:Exception){
                    // Transport/identity failure leaves an explicit unresolved fact, never a stopped claim.
                    val reason=when(error){is NativeInputException->error.code;is ExecutionChannelException->error.code;else->"CANCEL_UNCONFIRMED"}
                    lease{store.recordEffectEvidence(id,JSONObject().put("operationId",id).put("namespace",row.getString("namespace"))
                        .put("requestDigest",row.getString("requestDigest")).put("sequence",row.optLong("sequence",-1))
                        .put("state","unknown").put("scopeConfirmed",false).put("reason",reason))}
                }
                visited++
            }
            // Advancing by identity, rather than repeatedly reading page one, prevents unknown work starving later pages.
        }
    }
}

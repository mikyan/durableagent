package dev.durableagent.probe

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Process
import android.util.Log
import org.json.JSONObject

/** Debug lifecycle evidence only. Callers supply fixed categories/counters, never request/error text. */
internal object NativeStopTrace {
    fun event(context:Context,stage:String,value:JSONObject=JSONObject()){
        if(context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE!=0)Log.i("DurableStop",value.put("stage",stage).put("pid",Process.myPid()).toString())
    }
    fun failure(context:Context,stage:String,error:Exception){event(context,stage,JSONObject().put("code",when(error){is NativeInputException->error.code;is ExecutionChannelException->error.code;else->error.javaClass.simpleName}))}
}

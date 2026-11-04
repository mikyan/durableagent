package dev.durableagent.probe

import android.content.Context
import org.json.JSONObject

/** Old feature regressions use this test platform driver; production has no direct-text send path. */
object SubmissionTestDriver {
    fun payload(context:Context,mode:String,run:String,method:String,payload:JSONObject):JSONObject {
        if(method=="send"&&payload.has("actionId")&&payload.has("id")&&!payload.has("intentId"))return NativeInputStore(context,NativeInputBridge.namespace(mode,run)).use{store->
            val id=payload.getString("id");val action=payload.getString("actionId")
            val existing=store.listSends(JSONObject().put("id",id).put("limit",50)).getJSONArray("intents")
            for(index in 0 until existing.length())if(existing.getJSONObject(index).getString("intentId")==action)return@use JSONObject().put("intentId",action)
            val fixed=if(payload.has("inputToken"))store.readFrozen(payload.getString("inputToken")) else {
                val draft=store.inspect(id);val saved=store.save(id,draft.getLong("revision"),"$action-save",payload.getString("text"),emptyList())
                store.freeze(id,saved.getLong("revision"),"$action-freeze")
            }
            val intent=store.createSend(JSONObject().put("actionId",action).put("id",id).put("inputToken",fixed.getString("token"))
                .put("expectedContext",store.inspect(id).getJSONObject("submissionContext")).put("expectedControlVersion",store.readControl(id).getLong("version"))
                .put("queue",JSONObject().put("whenBusy","followUp").put("whenIdle","start")))
            JSONObject().put("intentId",intent.getString("intentId"))
        }
        if(method=="stop"&&payload.has("actionId"))return NativeInputStore(context,NativeInputBridge.namespace(mode,run)).use{store->
            val id=payload.getString("id");val stop=store.requestStop(JSONObject().put("id",id).put("actionId",payload.getString("actionId")).put("expectedControlVersion",store.readControl(id).getLong("version")))
            JSONObject().put("id",id).put("stopId",stop.getJSONObject("pendingAbort").getString("stopId"))
        }
        return payload
    }
}

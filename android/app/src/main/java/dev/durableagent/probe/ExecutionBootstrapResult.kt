package dev.durableagent.probe

import org.json.JSONObject

/** Exact pinned Termux result types; only complete nonce-bound public CLI errors are surfaced. */
fun decodeExecutionBootstrapResult(nonce:String,wire:Map<String,Any?>):String {
    val stdout=wire["stdout"] as? String
    val stderr=wire["stderr"] as? String
    val complete=stdout!=null && stderr!=null && stdout.length<=16384 && stderr.length<=16384 &&
        (wire["stdout_original_length"] as? String)?.toIntOrNull()==stdout.length &&
        (wire["stderr_original_length"] as? String)?.toIntOrNull()==stderr.length
    if(complete && wire["err"]==-1 && wire["exitCode"]==0)return JSONObject().put("ok",true).put("stdout",stdout).toString()
    var code=if(complete && wire["err"]==-1 && wire["exitCode"]==78)"SETUP_REQUIRED" else "BOOTSTRAP_UNCONFIRMED"
    if(complete && wire["err"]==-1 && wire["exitCode"] is Int) {
        val public=runCatching {JSONObject(stdout!!)}.getOrNull()
        val candidate=public?.optJSONObject("error")?.opt("code") as? String
        if(public?.opt("protocol")==1 && public.opt("nonce")==nonce && candidate?.matches(Regex("[A-Z][A-Z0-9_]{0,63}"))==true)code=candidate
    }
    return JSONObject().put("ok",false).put("error",code).toString()
}

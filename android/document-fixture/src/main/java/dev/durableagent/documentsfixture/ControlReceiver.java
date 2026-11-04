package dev.durableagent.documentsfixture;
import android.content.*;
import android.net.Uri;
import android.os.Process;
import android.util.Base64;
import org.json.JSONObject;
/** Synthetic fixture only. It has no access to user documents or product app storage. */
public final class ControlReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        try{
            String target=intent.getStringExtra("targetPackage");
            if(!java.util.Set.of("dev.durableagent.probe","dev.durableagent.saf","dev.durableagent.retention").contains(target))throw new IllegalArgumentException("Unknown fixture target");
            String operation=intent.getStringExtra("operation");
            JSONObject value=new JSONObject().put("providerUid",Process.myUid());
            switch(operation){
                case "reset":Fixture.reset(context);break;
                case "create-shared":value.put("shared",Fixture.createShared(context));break;
                case "replace":Fixture.replace(context);break;
                case "hold-readback":context.getSharedPreferences("state",0).edit().putBoolean("holdReadback",true).putBoolean("writeSeen",false).putLong("readbackMillis",30000).commit();break;
                case "hold-readback-long":context.getSharedPreferences("state",0).edit().putBoolean("holdReadback",true).putBoolean("writeSeen",false).putLong("readbackMillis",120000).commit();break;
                case "release":context.getSharedPreferences("state",0).edit().putBoolean("holdReadback",false).commit();break;
                case "revoke":context.revokeUriPermission(target,Uri.parse("content://"+Fixture.AUTHORITY+"/document/original"),Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);break;
                case "read":value.put("base64",Base64.encodeToString(Fixture.read(context),Base64.NO_WRAP)).put("writeOpens",context.getSharedPreferences("state",0).getInt("writeOpens",0));break;
                default:throw new IllegalArgumentException("Unknown control");
            }
            setResultCode(0);setResultData(value.toString());
        }catch(Exception error){setResultCode(1);setResultData(new JSONObject().toString());}
    }
}

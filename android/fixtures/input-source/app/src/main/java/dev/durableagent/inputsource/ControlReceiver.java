package dev.durableagent.inputsource;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.JSONObject;

/** Disposable test application: controls affect only two generated fixtures and one fixed client. */
public final class ControlReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent) {
        try {
            FixtureFiles.ensure(context);
            String id=intent.getStringExtra("document"); if(id==null)id="text";
            FixtureFiles.file(context,id); // Strict fixed-ID validation before grants or writes.
            Uri uri=DocumentsContract.buildDocumentUri(FixtureFiles.AUTHORITY,id);
            String operation=intent.getStringExtra("operation"); if(operation==null)operation="inspect";
            switch(operation) {
                case "reset" -> { FixtureFiles.writeText(context,"原始外部来源 UTF-8：中文🌍\n"); FixtureFiles.writeImage(context,"R7K2"); }
                case "mutate" -> { if(id.equals("text"))FixtureFiles.writeText(context,"来源已改变：第二个 UTF-8 版本🌍\n"); else FixtureFiles.writeImage(context,"V8D3"); }
                case "seed-image" -> FixtureFiles.writeImage(context,intent.getStringExtra("challenge"));
                case "revoke" -> context.revokeUriPermission("dev.durableagent.probe",uri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                case "grant" -> context.grantUriPermission("dev.durableagent.probe",uri,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                case "inspect" -> {}
                default -> throw new IllegalArgumentException("Unknown fixed fixture operation");
            }
            int targetUid=-1; String targetLookup="found";
            try { targetUid=context.getPackageManager().getApplicationInfo("dev.durableagent.probe",0).uid; }
            catch(Exception error) { targetLookup=error.getClass().getSimpleName(); }
            int targetReadPermission=targetUid<0?-99:context.checkUriPermission(uri,-1,targetUid,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            setResultCode(0); setResultData(new JSONObject().put("operation",operation).put("document",id).put("uri",uri.toString()).put("providerUid",android.os.Process.myUid()).put("targetUid",targetUid).put("targetLookup",targetLookup).put("targetReadPermission",targetReadPermission).put("sha256",FixtureFiles.sha256(FixtureFiles.file(context,id))).put("bytes",FixtureFiles.file(context,id).length()).toString());
        } catch(Exception error) { setResultCode(1); setResultData("Fixture control failed: "+error.getClass().getSimpleName()); }
    }
}

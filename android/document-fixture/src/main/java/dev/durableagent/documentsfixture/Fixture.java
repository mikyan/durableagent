package dev.durableagent.documentsfixture;
import android.content.Context;
import android.content.ContentValues;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import java.io.*;
import org.json.JSONObject;
final class Fixture {
    static final String AUTHORITY="dev.durableagent.documentsfixture.documents";
    static final byte[] ORIGINAL=new byte[]{83,65,70,0,10,(byte)0xff,65,66,67};
    static final byte[] REPLACEMENT=new byte[]{78,69,87,10};
    static File original(Context context){return new File(context.getFilesDir(),"original.bin");}
    static Uri shared(Context context){String value=context.getSharedPreferences("state",0).getString("sharedUri",null);return value==null?null:Uri.parse(value);}
    static ParcelFileDescriptor open(Context context,String mode)throws FileNotFoundException{
        Uri uri=shared(context);
        if(uri==null)return ParcelFileDescriptor.open(original(context),ParcelFileDescriptor.parseMode(mode));
        ParcelFileDescriptor descriptor=context.getContentResolver().openFileDescriptor(uri,mode);
        if(descriptor==null)throw new FileNotFoundException("Synthetic shared original unavailable");
        return descriptor;
    }
    static byte[] read(Context context)throws IOException{
        try(InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(open(context,"r"))){
            byte[] bytes=input.readNBytes(16*1024*1024+1);
            if(bytes.length>16*1024*1024)throw new IOException("Synthetic read budget exceeded");
            return bytes;
        }
    }
    static long size(Context context)throws FileNotFoundException{
        if(shared(context)==null){if(!original(context).isFile())throw new FileNotFoundException("Synthetic original absent");return original(context).length();}
        try(ParcelFileDescriptor descriptor=open(context,"r")){return descriptor.getStatSize();}
        catch(IOException error){throw new FileNotFoundException("Synthetic shared original unavailable");}
    }
    static JSONObject createShared(Context context)throws Exception{
        String folder="DurableAgent-SAF-"+java.util.UUID.randomUUID();
        String relative=android.os.Environment.DIRECTORY_DOWNLOADS+"/"+folder+"/";
        ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,"original.bin");
        values.put(MediaStore.MediaColumns.MIME_TYPE,"application/octet-stream");values.put(MediaStore.MediaColumns.RELATIVE_PATH,relative);values.put(MediaStore.MediaColumns.IS_PENDING,1);
        Uri uri=context.getContentResolver().insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values);
        if(uri==null)throw new IOException("Synthetic MediaStore creation unavailable");
        context.getSharedPreferences("state",0).edit().clear().putString("sharedUri",uri.toString()).putString("sharedFolder",folder).commit();
        try(ParcelFileDescriptor descriptor=open(context,"rw");FileOutputStream output=new ParcelFileDescriptor.AutoCloseOutputStream(ParcelFileDescriptor.dup(descriptor.getFileDescriptor()))){output.write(ORIGINAL);output.getChannel().truncate(ORIGINAL.length);output.getFD().sync();}
        ContentValues published=new ContentValues();published.put(MediaStore.MediaColumns.IS_PENDING,0);
        if(context.getContentResolver().update(uri,published,null,null)!=1)throw new IOException("Synthetic original publish unconfirmed");
        try(android.database.Cursor row=context.getContentResolver().query(uri,new String[]{MediaStore.MediaColumns.DATA,MediaStore.MediaColumns.RELATIVE_PATH,MediaStore.MediaColumns.OWNER_PACKAGE_NAME},null,null,null)){
            if(row==null||!row.moveToFirst())throw new IOException("Synthetic original location unconfirmed");
            String path=row.getString(0),storedRelative=row.getString(1),owner=row.getString(2);
            if(path==null||!new File(path).isAbsolute()||!path.endsWith("/"+folder+"/original.bin")||!relative.equals(storedRelative)||!context.getPackageName().equals(owner))throw new IOException("Synthetic original ownership/location unconfirmed");
            return new JSONObject().put("mediaUri",uri.toString()).put("path",path).put("relativePath",relative).put("owner",owner).put("documentUri","content://"+AUTHORITY+"/document/original");
        }
    }
    static void reset(Context context)throws IOException{
        try(FileOutputStream out=new FileOutputStream(original(context))){out.write(ORIGINAL);out.getFD().sync();}
        context.getSharedPreferences("state",0).edit().clear().commit();
    }
    static void replace(Context context)throws IOException{
        if(shared(context)!=null)throw new IOException("Use a fresh private fixture for the retained-inode replacement trace");
        java.nio.file.Files.move(original(context).toPath(),new File(context.getFilesDir(),"retired.bin").toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        try(FileOutputStream out=new FileOutputStream(original(context))){out.write(REPLACEMENT);out.getFD().sync();}
    }
}

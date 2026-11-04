package dev.durableagent.documentsfixture;
import android.content.Context;
import java.io.*;
final class Fixture {
    static final String AUTHORITY="dev.durableagent.documentsfixture.documents";
    static final byte[] ORIGINAL=new byte[]{83,65,70,0,10,(byte)0xff,65,66,67};
    static final byte[] REPLACEMENT=new byte[]{78,69,87,10};
    static File original(Context context){return new File(context.getFilesDir(),"original.bin");}
    static void reset(Context context)throws IOException{
        try(FileOutputStream out=new FileOutputStream(original(context))){out.write(ORIGINAL);out.getFD().sync();}
        context.getSharedPreferences("state",0).edit().clear().commit();
    }
    static void replace(Context context)throws IOException{
        java.nio.file.Files.move(original(context).toPath(),new File(context.getFilesDir(),"retired.bin").toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        try(FileOutputStream out=new FileOutputStream(original(context))){out.write(REPLACEMENT);out.getFD().sync();}
    }
}

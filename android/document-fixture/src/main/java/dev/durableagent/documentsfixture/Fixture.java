package dev.durableagent.documentsfixture;
import android.content.Context;
import java.io.*;
final class Fixture {
    static final String AUTHORITY="dev.durableagent.documentsfixture.documents";
    static final byte[] ORIGINAL=new byte[]{83,65,70,0,10,(byte)0xff,65,66,67};
    static File original(Context context){return new File(context.getFilesDir(),"original.bin");}
    static void reset(Context context)throws IOException{
        try(FileOutputStream out=new FileOutputStream(original(context))){out.write(ORIGINAL);out.getFD().sync();}
        context.getSharedPreferences("state",0).edit().clear().commit();
    }
}

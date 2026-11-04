package dev.durableagent.documentsfixture;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.*;
public final class DocumentProvider extends DocumentsProvider {
    private static final String[] DOC={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED};
    @Override public boolean onCreate(){return true;}
    @Override public Cursor queryRoots(String[] projection){
        String[] columns=projection!=null?projection:new String[]{DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID,DocumentsContract.Root.COLUMN_TITLE,DocumentsContract.Root.COLUMN_FLAGS,DocumentsContract.Root.COLUMN_MIME_TYPES,DocumentsContract.Root.COLUMN_ICON,DocumentsContract.Root.COLUMN_SUMMARY};
        MatrixCursor cursor=new MatrixCursor(columns);
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:columns)row.add(column,switch(column){
            case DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID -> "root";
            case DocumentsContract.Root.COLUMN_TITLE -> "DurableAgent 原文件测试";
            case DocumentsContract.Root.COLUMN_FLAGS -> DocumentsContract.Root.FLAG_LOCAL_ONLY;
            case DocumentsContract.Root.COLUMN_MIME_TYPES -> "*/*";
            case DocumentsContract.Root.COLUMN_ICON -> android.R.drawable.ic_menu_edit;
            case DocumentsContract.Root.COLUMN_SUMMARY -> "仅合成原件，独立应用 UID";
            default -> null;
        });
        return cursor;
    }
    private Cursor documents(String[] projection,String id)throws FileNotFoundException{
        MatrixCursor cursor=new MatrixCursor(projection!=null?projection:DOC);
        boolean root=id.equals("root");File file=Fixture.original(getContext());
        if(!root&&!id.equals("original"))throw new FileNotFoundException("Synthetic original is absent");
        long size=root?0:Fixture.size(getContext());
        Object modified=null;
        if(root)modified=Long.valueOf(0);
        else if(Fixture.shared(getContext())==null)modified=Long.valueOf(file.lastModified());
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:cursor.getColumnNames())row.add(column,switch(column){
            case DocumentsContract.Document.COLUMN_DOCUMENT_ID -> id;
            case DocumentsContract.Document.COLUMN_DISPLAY_NAME -> root?"DurableAgent 原文件测试":"original.bin";
            case DocumentsContract.Document.COLUMN_MIME_TYPE -> root?DocumentsContract.Document.MIME_TYPE_DIR:"application/octet-stream";
            case DocumentsContract.Document.COLUMN_FLAGS -> root?0:DocumentsContract.Document.FLAG_SUPPORTS_WRITE;
            case DocumentsContract.Document.COLUMN_SIZE -> size;
            case DocumentsContract.Document.COLUMN_LAST_MODIFIED -> modified;
            default -> null;
        });
        return cursor;
    }
    @Override public Cursor queryDocument(String id,String[] projection)throws FileNotFoundException{return documents(projection,id);}
    @Override public Cursor queryChildDocuments(String parent,String[] projection,String order)throws FileNotFoundException{return documents(projection,"original");}
    @Override public boolean isChildDocument(String parent,String child){return parent.equals("root")&&child.equals("original");}
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal)throws FileNotFoundException{
        if(!id.equals("original"))throw new FileNotFoundException();
        android.content.SharedPreferences state=getContext().getSharedPreferences("state",0);
        if(mode.contains("w"))state.edit().putBoolean("writeSeen",true).putInt("writeOpens",state.getInt("writeOpens",0)+1).commit();
        else if(state.getBoolean("writeSeen",false)){
            long end=android.os.SystemClock.elapsedRealtime()+state.getLong("readbackMillis",30000);
            while(state.getBoolean("holdReadback",false)&&android.os.SystemClock.elapsedRealtime()<end){
                if(signal!=null)signal.throwIfCanceled();
                try{Thread.sleep(20);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new FileNotFoundException("Synthetic readback interrupted");}
            }
        }
        return Fixture.open(getContext(),mode);
    }
}

package dev.durableagent.inputsource;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;

public final class SourceProvider extends DocumentsProvider {
    private static final String[] ROOT_COLUMNS={DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID,DocumentsContract.Root.COLUMN_TITLE,DocumentsContract.Root.COLUMN_SUMMARY,DocumentsContract.Root.COLUMN_FLAGS,DocumentsContract.Root.COLUMN_MIME_TYPES,DocumentsContract.Root.COLUMN_ICON};
    private static final String[] DOC_COLUMNS={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE,DocumentsContract.Document.COLUMN_LAST_MODIFIED};
    @Override public boolean onCreate() { try { FixtureFiles.ensure(getContext()); return true; } catch(Exception error) { return false; } }
    @Override public Cursor queryRoots(String[] projection) {
        MatrixCursor cursor=new MatrixCursor(projection==null?ROOT_COLUMNS:projection);
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:cursor.getColumnNames()) row.add(column,switch(column) {
            case DocumentsContract.Root.COLUMN_ROOT_ID,DocumentsContract.Root.COLUMN_DOCUMENT_ID -> "root";
            case DocumentsContract.Root.COLUMN_TITLE -> "DurableAgent 外部测试资料";
            case DocumentsContract.Root.COLUMN_SUMMARY -> "仅合成资料，独立应用 UID";
            case DocumentsContract.Root.COLUMN_FLAGS -> DocumentsContract.Root.FLAG_LOCAL_ONLY;
            case DocumentsContract.Root.COLUMN_MIME_TYPES -> "text/plain\nimage/png";
            case DocumentsContract.Root.COLUMN_ICON -> android.R.drawable.ic_menu_gallery;
            default -> null;
        });
        return cursor;
    }
    @Override public Cursor queryDocument(String id,String[] projection) throws FileNotFoundException {
        MatrixCursor cursor=new MatrixCursor(projection==null?DOC_COLUMNS:projection); add(cursor,id); return cursor;
    }
    @Override public Cursor queryChildDocuments(String parent,String[] projection,String sort) throws FileNotFoundException {
        if (!parent.equals("root")) throw new FileNotFoundException("Unknown fixture directory");
        MatrixCursor cursor=new MatrixCursor(projection==null?DOC_COLUMNS:projection); add(cursor,"text"); add(cursor,"image"); return cursor;
    }
    @Override public boolean isChildDocument(String parent,String child) { return parent.equals("root")&&(child.equals("text")||child.equals("image")); }
    private void add(MatrixCursor cursor,String id) throws FileNotFoundException {
        boolean root=id.equals("root"); File file=root?null:FixtureFiles.file(getContext(),id);
        if (!root&&!file.isFile()) throw new FileNotFoundException("Fixture missing");
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:cursor.getColumnNames()) row.add(column,switch(column) {
            case DocumentsContract.Document.COLUMN_DOCUMENT_ID -> id;
            case DocumentsContract.Document.COLUMN_DISPLAY_NAME -> root?"Synthetic fixtures":file.getName();
            case DocumentsContract.Document.COLUMN_MIME_TYPE -> root?DocumentsContract.Document.MIME_TYPE_DIR:id.equals("text")?"text/plain":"image/png";
            case DocumentsContract.Document.COLUMN_FLAGS -> 0;
            case DocumentsContract.Document.COLUMN_SIZE -> root?0:file.length();
            case DocumentsContract.Document.COLUMN_LAST_MODIFIED -> root?0:file.lastModified();
            default -> null;
        });
    }
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal) throws FileNotFoundException {
        if (!mode.equals("r")) throw new FileNotFoundException("Read-only fixture");
        if(signal!=null)signal.throwIfCanceled();
        return ParcelFileDescriptor.open(FixtureFiles.file(getContext(),id),ParcelFileDescriptor.MODE_READ_ONLY);
    }
}

package dev.durableagent.inputsource;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class FixtureFiles {
    static final String AUTHORITY = "dev.durableagent.inputsource.documents";
    static File file(Context context, String id) throws FileNotFoundException {
        if (!id.equals("text") && !id.equals("image")) throw new FileNotFoundException("Unknown fixture ID");
        return new File(context.getNoBackupFilesDir(), id.equals("text") ? "fixture-note.txt" : "fixture-image.png");
    }
    static synchronized void ensure(Context context) throws IOException {
        if (!file(context,"text").isFile()) writeText(context,"原始外部来源 UTF-8：中文🌍\n");
        if (!file(context,"image").isFile()) writeImage(context,"R7K2");
    }
    static synchronized void writeText(Context context,String text) throws IOException {
        if (text.length()>1024) throw new IOException("Fixture text too long");
        try (FileOutputStream out=new FileOutputStream(file(context,"text"))) { out.write(text.getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
    }
    static synchronized void writeImage(Context context,String code) throws IOException {
        if (!code.matches("[A-HJ-NP-Z2-9]{4}")) throw new IOException("Invalid fixture challenge");
        Bitmap bitmap=Bitmap.createBitmap(720,360,Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas=new Canvas(bitmap); canvas.drawColor(Color.WHITE);
            Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.BLACK); paint.setTextSize(140); paint.setTypeface(Typeface.create(Typeface.MONOSPACE,Typeface.BOLD)); paint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(code,360,220,paint);
            try (FileOutputStream out=new FileOutputStream(file(context,"image"))) { if (!bitmap.compress(Bitmap.CompressFormat.PNG,100,out)) throw new IOException("PNG encoding failed"); out.getFD().sync(); }
        } finally { bitmap.recycle(); }
    }
    static String sha256(File file) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try (var input=new java.io.FileInputStream(file)) { byte[] buffer=new byte[8192]; int count; while((count=input.read(buffer))!=-1) digest.update(buffer,0,count); }
        StringBuilder value=new StringBuilder(); for(byte b:digest.digest()) value.append(String.format("%02x",b&255)); return value.toString();
    }
}

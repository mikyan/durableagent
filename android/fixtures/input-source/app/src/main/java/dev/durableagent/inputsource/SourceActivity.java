package dev.durableagent.inputsource;
import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
public final class SourceActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView view=new TextView(this); view.setPadding(32,64,32,32); view.setText("DurableAgent 外部测试资料\n\n只提供合成文本和图片，用于跨应用文件授权验证。\n不会读取用户文件。");
        setContentView(view);
        try { FixtureFiles.ensure(this); } catch(Exception error) { view.append("\n初始化失败"); }
    }
}

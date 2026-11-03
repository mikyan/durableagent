package dev.durableagent.termuxprobe

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {
    private val owner get() = application as ProbeApplication
    private lateinit var output: TextView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 60, 24, 32) }
        column.addView(TextView(this).apply { text = "首次初始化 / 检查执行环境"; textSize = 23f })
        column.addView(TextView(this).apply { text = "T03 验证工程 · 独立应用 · target 36\n首次：安装固定官方 Termux，打开完成 bootstrap，再复制命令到 Termux 中整段执行，授予 RUN_COMMAND。之后只需本应用检查。" })
        fun button(label: String, action: () -> Unit) { column.addView(Button(this).apply { text = label; setOnClickListener { action() } }) }
        button("检查执行环境") { owner.inspect() }
        button("授予 RUN_COMMAND 系统权限") { requestPermissions(arrayOf(TERMUX_PERMISSION), 1) }
        button("复制完整首次配置命令") {
            val setup = assets.open("setup.sh").bufferedReader().use { it.readText() }
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("在官方 Termux 终端执行", setup))
        }
        button("首次打开 Termux / 完成 bootstrap") {
            packageManager.getLaunchIntentForPackage("com.termux")?.let { startActivity(it) }
        }
        button("固定官方发行页") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/termux/termux-app/releases/tag/v0.118.3"))) }
        button("Termux 系统设置 / 通知及电池限制") { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:com.termux"))) }
        output = TextView(this).apply { setTextIsSelectable(true); textSize = 14f }
        column.addView(output)
        setContentView(ScrollView(this).apply { addView(column) })
    }

    override fun onResume() { super.onResume(); owner.observer = ::render; render(); owner.inspect() }
    override fun onPause() { owner.observer = null; super.onPause() }

    private fun render() {
        val state = owner.inspector.state
        val guidance = when (state.phase) {
            Phase.READY -> "本次真实探针通过。就绪只代表这次核验，不保证无限后台存活。"
            Phase.UNKNOWN_TIMEOUT -> "20 秒未获得完整证明，原因未知。可重新核验；不要据此重装或清空 Termux。"
            Phase.FORCE_STOPPED -> "Android 报告 Termux stopped。需用户主动打开解除；这不是普通进程回收。"
            Phase.PERMISSION_REQUIRED -> "需要系统 RUN_COMMAND 授权；若被撤回，请重新授权。"
            Phase.EXTERNAL_CALLS_DISABLED -> "Termux 明确报告 allow-external-apps 被禁用，请核对首次配置。"
            Phase.SETUP_REQUIRED -> "shell 已执行，但未找到探针。复制完整首次配置命令到 Termux 执行。"
            Phase.UNTRUSTED_INSTALL -> "安装不匹配本次固定发行物。保留现有数据并复审兼容性，不自动卸载替换。"
            Phase.PROTOCOL_MISMATCH -> "执行桥协议不兼容，需要复核版本。"
            Phase.START_RESTRICTED -> "Android 明确拒绝服务启动。请保留诊断，不把手工打开终端视为日常方案。"
            Phase.BUSY -> "已有短时探针持锁。稍后重新核验；不启动第二个执行实例。"
            else -> "bootstrap、外部调用配置和桥版本只有真实执行成功后才能确认；未知不等于未初始化。"
        }
        output.text = "\n状态：${state.phase}\n$guidance\n安装与系统授权：\n${owner.platformDescription}\nbootstrap=${state.bootstrap}\nallow-external-apps=${state.externalCalls}\n执行桥协议=${state.protocol}\n\n${state.evidence}\n\n${owner.lastRun}"
    }
}

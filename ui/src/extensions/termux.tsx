import type {ConversationController,UiState} from '../controller';
import '../models.css';

export default function TermuxSettings({controller,state}:{controller:ConversationController;state:UiState}){
  const execution=state.execution??controller.execution.view();
  return <div className="settings-scroll" data-testid="termux-page"><div className="settings-content termux-settings">
    <div className="provider-detail-heading"><span className="provider-symbol termux-symbol" aria-hidden="true">›_</span><div><h2>Termux</h2><p>手机上的命令与工具环境</p></div><span className={`provider-state ${execution.connected?'configured':''}`}>{execution.connecting?'连接中':execution.connected?'已连接':'尚未连接'}</span></div>
    <p className="settings-hint">首次完成下面的设置后，执行命令时会按需启动 Termux。</p>
    {execution.error&&<p className="settings-error" role="alert">{execution.error}</p>}
    {execution.notice&&<p className="settings-notice" role="status">{execution.notice}</p>}
    <section className="settings-section"><h2>1. 安装 Termux</h2><p>已有 Termux 可以直接继续初始化。请保留原来的安装渠道和数据。</p>
      <div className="termux-source-actions"><button className="secondary-button" disabled={!!execution.openingSource} onClick={()=>void controller.execution.openDownload('github')}>GitHub 官方发布页 ↗</button><button className="secondary-button" disabled={!!execution.openingSource} onClick={()=>void controller.execution.openDownload('fdroid')}>F-Droid 官方页面 ↗</button></div>
      <details className="termux-compatibility"><summary>安装来源与兼容说明</summary><div className="disclosure-content"><p>支持核验官方 GitHub 和 F-Droid 安装来源，不限定单一版本；能否运行以连接检查为准。</p><p>GitHub 新安装包首次连接可能需要联网核验。已核验的同一安装包可离线使用，后台恢复不会联网核验来源。</p><p>请勿为连接而卸载、清空或跨渠道覆盖已有 Termux。</p></div></details>
    </section>
    <section className="settings-section"><h2>2. 初始化</h2><p>先打开 Termux 完成首次启动，再复制下面的初始化命令，在 Termux 中粘贴并运行。</p><button className="secondary-button" disabled={execution.copying} onClick={()=>void controller.execution.copySetup()}>{execution.copying?'正在复制…':'复制初始化命令'}</button></section>
    <section className="settings-section"><h2>3. 连接</h2><p>返回这里连接 Termux；出现系统授权提示时，允许应用执行 Termux 命令。</p><button className="primary-button" disabled={execution.connecting} onClick={()=>void controller.execution.connect()}>{execution.connecting?'正在连接 Termux…':'连接 Termux'}</button></section>
  </div></div>;
}

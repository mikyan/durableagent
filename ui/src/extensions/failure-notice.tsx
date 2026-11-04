export function FailureNotice({reason,onModels}:{reason:string;onModels:()=>void}){
 const auth=/\b401\b|authentication_error|invalid.{0,20}(api.?key|credential)|unauthorized/i.test(reason);
 const denied=/\b403\b|permission_denied|forbidden/i.test(reason),limited=/\b429\b|rate_limit|quota|insufficient.*balance/i.test(reason);
 const missing=/\b404\b|model_not_found|no_model/i.test(reason);
 const status=reason.match(/\b(401|403|404|429|5\d\d)\b/)?.[0];
 const category=auth?'鉴权失败':denied?'服务访问受限':limited?'服务额度或频率受限':missing?'模型不可用':'处理失败';
 const message=auth?'模型服务拒绝了当前凭据，请检查 API Key 与连接地址。':denied?'当前连接没有访问此模型的权限，请检查模型服务的授权。':limited?'模型服务的额度或请求频率受限，请检查套餐状态或稍后重试。':missing?'当前模型或接口地址不可用，请检查模型名称与连接地址。':'本次处理未完成；已保存的输入仍保留。请查看原因后再决定下一步。';
 return <div className="failure-notice" role="alert"><strong>{category}{status?' · '+status:''}</strong><p>{message}</p>{(auth||denied||limited||missing)&&<button className="text-button" onClick={onModels}>检查模型与凭据</button>}<details><summary>原始失败原因</summary><pre>{reason}</pre></details></div>;
}

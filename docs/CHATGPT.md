# ChatGPT 订阅接入

Baby Panel 的对话助手支持两条独立通道：现有 API 配置，以及用户授权的 ChatGPT 套餐。默认继续使用原有 API 配置。选择 ChatGPT 后，模型列表取自该账号；额度不足、授权失效或调用失败时不会自动切到现有 API。

在对话助手输入区的「模型来源与 ChatGPT 订阅」点击 **Continue with ChatGPT**。完成授权后，在「模型来源」选择连接的账号，再选择该账号可用的模型。每个 Baby Panel 登录用户只能看到和使用自己的连接；可以连接多个 ChatGPT 账号，或者对已有连接重新授权、断开。使用量和应用限额可在「管理 ChatGPT 用量」查看。

## 服务器部署时授权

官方动态客户端使用 `http://127.0.0.1:<端口>/auth/callback`，因此远程部署时需要把浏览器所在电脑的回调端口转发到服务器。授权监听器只绑定服务器的 `127.0.0.1`；不需要向公网开放端口。

先在自己的电脑运行，并保持该 SSH 连接：

```sh
ssh -N -L 14622:127.0.0.1:14622 <ssh-user>@<server>
```

然后在 Baby Panel 点击 **Continue with ChatGPT**，再点击「打开 ChatGPT 授权」。选择自己的账号、工作区，并允许使用 ChatGPT 套餐。页面显示连接完成后回到 Baby Panel 即可。授权过程中不需要复制令牌或粘贴回调地址。Fleet Atlas 使用另一个端口 `14621`，两个项目可以同时连接。

本机运行 Baby Panel 时可直接完成授权。如果本机端口被占用，改用 `CHATGPT_CALLBACK_PORT` 配置空闲端口，并相应调整 SSH 命令。

## 持久化与配置

- `CHATGPT_PLAN_ENABLED=false` 可关闭此通道。
- `CHATGPT_CALLBACK_PORT` 默认 `14622`，监听回环地址。
- `CHATGPT_PLAN_FILE` 默认项目根目录的 `.data/chatgpt-plan.json`；standalone 启动会向上定位项目根目录，避免凭据被下一次构建替换。可在环境文件中设置绝对路径。文件权限为 `0600`，备份时将其视为账号凭据。Docker 部署需给该路径配置持久化卷。
- 进程重启后保留 host ID、注册的 client ID 和连接；刷新令牌由当前服务串行更新。一个凭据文件只应由一个服务实例写入。
- 断开连接会撤销可续期会话并清除本地令牌；如果远端撤销未确认，界面会提示在 ChatGPT 设置中断开应用。注册记录保留供重新授权使用。

通过 OAuth 获得的权限及账号资格决定能否使用套餐。请求使用公共 Responses API，启用流式输出、关闭远端会话存储，并通过命名空间调用现有宝宝资料工具。实际推理只有收到 `response.completed` 才算完成。

验证：`npm run test:chatgpt` 包含隔离 OAuth 签名、PKCE、账号隔离、并发刷新、撤销竞态、用量错误及真实 Pi Agent 工具往返测试。测试全部使用合成数据和模拟 OpenAI 服务，不使用真实订阅或宝宝数据。

官方文档：[注册授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型和推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[自托管 VM](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)。

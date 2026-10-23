# 译间 · Yijian Translator

一个支持英文与简体中文互译的网页工具：自动检测方向，翻译粘贴的纯文本、TXT 文件或 Markdown，在浏览器中预览并下载译文。支持日间与夜间模式。

顶部提供「中英翻译」「语法与润色」「De-Claudish」「全局模型」四个标签页。**英文语法与润色**用中文指出语法问题和修改原因，输出仅修正语法的完整英文版本，再独立评估是否值得润色、给出中文建议及 2–3 个英文润色版本。每个英文版本均可单独复制为纯文本（不包含标题、说明或富文本格式）。无语法错误时，修正版本保留原文；无需润色时，其他版本仅作为可选风格参考。切换标签保留当前输入、结果和任务；方向键、Home 和 End 可切换标签。

### 英文语法与润色

1. 切换到「语法与润色」标签页，输入英文或点击「试一段示例」。每次最多 4,000 个字符。
2. 点击「检查语法与润色」，也可在英文输入框中按 Ctrl / ⌘ + Enter。
3. 右侧依次显示语法诊断、仅修正语法版本、润色必要性与建议、多个润色版本。内容较多时可在结果区滚动。
4. 点击对应版本的「复制英文」，只复制该版本的英文正文；输入更新会清除旧结果。等待期间可点击「停止」。

### 独立模型与全局覆盖

在全局模型页添加站点，保存名称、API 地址、模型列表和可选密钥。可通过「获取模型列表」读取接口的 `/models`，也可每行手动填一个模型 ID。保存多个站点后，翻译、润色和 De-Claudish（自选大模型方式）可分别选择站点与模型，直接复用该站点密钥，无需重复填写。修改站点密钥会同步影响引用它的功能；各功能选中的模型仍独立保留。

每个功能均有自己的「使用全局模型」开关：开启并应用后，只有该功能跟随全局默认站点与模型；关闭后恢复该功能的独立选择。选择全局时隐藏独立配置字段；取消弹窗不会改变选择。已有独立配置继续可用；已有全局配置可直接应用保存为共享站点。

全局模型在独立标签页中设置，该页没有总开关，也不会自动覆盖任何功能。保存全局模型只影响已选择使用全局的功能。正在翻译或检查时不能应用模型设置。

「记住到此浏览器」作用于当前站点；模型偏好及各功能的开关状态可保留，未勾选的密钥刷新即清除。清除站点密钥会影响引用同一站点的所有功能，不影响其他站点。旧版独立配置保持不变。语法检查正文只发送到其实际选择的服务商，不保存输入与结果，也不自动发送到翻译模型。

### De-Claudish

使用 [Claudish](https://github.com/programasweights/claudish) 的规则或官方程序 `e469f61ccab2699fbd51`，将冗余修辞改为直接英文。提供三种运行方式：

- **官方 PAW 云端**：浏览器直连 `https://programasweights.com/api/v1/infer`，匿名调用可留空密钥；也可填写个人 PAW Key（仅当前页面暂存）。受官方额度和可用性限制，不承诺永久免费或无限使用。
- **自部署 PAW**：用户安装 Python 3.10+，运行 `python -m pip install programasweights --extra-index-url https://pypi.programasweights.com/simple/`，下载页面提供的 `paw-bridge.py`，在其目录运行 `python paw-bridge.py`。默认服务地址 `http://127.0.0.1:8766`。脚本首次推理才下载官方模型和适配资源（约 620MB），也支持 CPU。
- **自选大模型**：使用所选站点的 OpenAI 兼容接口执行改写规则。支持云端或本地模型；效果不等同于原版 PAW。原文作为待改写数据传递。

「检测部署状态」只检查所填地址的连接服务、SDK 是否安装及模型状态，不下载模型、不扫描网络，也不能直接检查电脑上的所有已安装软件。「加载并验证模型」会准备资源并运行固定示例。网页停止等待后，服务端下载或推理可能继续；桥接服务串行执行推理，忙时返回 409。PAW 模式每次最多 1,200 字符，自选模型最多 4,000 字符；字符限制不能保证 PAW 的上下文一定足够，较长文本仍应分段。

局域网部署：设置环境变量 `YIJIAN_PAW_KEY` 后运行 `python paw-bridge.py --host 0.0.0.0`，网页填写服务器 IP 和相同密钥。只在专用网络开放端口。默认允许来源 `https://wang-kaijun.github.io`；其他域名可用重复的 `--origin` 参数指定。不要将该轻量连接服务暴露到公网。页面不安装软件，不自动启动服务。

规则改编遵循 MIT 许可证，版权声明见 `THIRD_PARTY_NOTICES.txt` 及发布产物 `licenses.txt`。本项目与 Anthropic、ProgramAsWeights 无隶属关系。

### 本地 / 局域网大模型

全局模型页的「部署本地模型」提供安装引导，并预填 Ollama 地址 `http://127.0.0.1:11434/v1`。也可填写 `http://192.168.1.100:8080/v1` 等 OpenAI 兼容地址。本地无鉴权接口可留空 API Key；密钥不从云端站点自动带入。

Ollama 需要配置 `OLLAMA_ORIGINS=https://wang-kaijun.github.io` 并重启；供其他设备访问时还需配置监听地址及防火墙。GitHub Pages 访问本机或局域网依赖浏览器本地网络权限和服务端 CORS；兼容性受浏览器版本影响。`127.0.0.1` 指当前浏览器所在设备。「自定义接口」和「本地 / 局域网模型」均支持回环/局域网 HTTP 地址，并允许无鉴权服务留空密钥；公网接口仍需 HTTPS；服务器不代理用户指定的地址。

模型可能误判语法或改变细微含义，请结合上下文核对。接口结果不完整或被截断时会提示重试或缩短输入。

**在线使用：[打开译间](https://wang-kaijun.github.io/yijian-translator/)**

## 使用

1. 在「中英翻译」标签页点击底部模型卡片的「设置」。
2. 选择服务商，填写你自己的 API Key，点击「测试接口」或「应用设置」。
3. 粘贴文字，或选择 / 拖入 `.txt`、`.md`、`.markdown` 文件；会按扩展名自动切换纯文本或 Markdown 模式。
4. 点击「开始翻译」。TXT 译文下载为 `原文件名.目标语言.txt`；Markdown 结果可以切换预览与源码，并下载为 `.md`。

| 服务商 | 默认模型 | 接口基础地址 |
| --- | --- | --- |
| 魔搭 ModelScope | `Qwen/Qwen3.8-Flash-Next` | `https://api-inference.modelscope.cn/v1` |
| Groq | `openai/gpt-oss-120b` | `https://api.groq.com/openai/v1` |
| OpenRouter | `qwen/qwen3.8-27b:free` | `https://openrouter.ai/api/v1` |
| 硅基流动 | `XingChenAGI/Xing4.0-29B` | `https://api.siliconflow.cn/v1` |
| DeepSeek | `deepseek-flash` | `https://api.deepseek.com` |
| Z.ai | `glm-5.3` | `https://api.z.ai/api/paas/v4` |
| 智谱 | `glm-4.7-flash` | `https://open.bigmodel.cn/api/paas/v4` |
| 自定义 | 自行填写 | 支持浏览器跨域访问的 OpenAI Chat Completions 兼容接口；公网 HTTPS，本机 / 局域网也支持 HTTP |

OpenRouter、硅基流动和智谱默认选择核对于 2026-10-15 的免费模型；免费模型仍有限流，政策以服务商为准。已有浏览器保存的模型设置不会自动覆盖，智谱老用户可将模型 ID 改为 `glm-4.7-flash`。

预设模型 ID 可以修改。获取密钥：[魔搭](https://modelscope.cn/my/myaccesstoken)、[Groq](https://console.groq.com/keys)。免费额度、模型可用性、地区限制和超额费用由服务商决定，网页不提供共享密钥。

## 密钥与文件

- 外部 API **由浏览器直接调用**。模型 API Key 放在 `Authorization` 请求头，PAW 密钥放在 `X-API-Key` 请求头，不经过本应用服务器，不发送给 GitHub，不进入 URL、译文下载、构建产物或统计服务。云端使用 HTTPS；显式本地/局域网 HTTP 未加密。
- 默认密钥只在当前页面内存中；刷新或关闭页面即清除。用户主动勾选「记住到此浏览器」后，才保存到本浏览器本站的 `localStorage`。共享站点密钥由引用它的功能复用，其他站点相互独立；旧版独立配置仍保持原有隔离。PAW 密钥仅内存暂存。清除后，其他已打开的标签页应关闭或刷新。
- 不会同步给其他访问者。浏览器存储并非加密保险箱：同一浏览器使用者、同源网页脚本或有权限的扩展可能读取它。共享设备不要勾选记住；删除浏览器网站数据也可以清除保存项。使用专用站点域名可避免与其他 Pages 项目共享 origin。
- 文件读取、UTF-8 解码、分段、Markdown 解析、格式恢复、预览和下载均在浏览器中完成。**不上传文件，但待译正文会发送给所选模型服务商**。服务商对请求的处理以其隐私政策为准。
- 本应用不保存原文、译文或文件。无统计脚本，无远程运行时脚本，无密钥共享后端。GitHub Pages 仍会处理正常的静态网页访问请求。
- 切换服务商时不会沿用上一家的密钥；自定义 API 地址改变时必须重新填写密钥。预设地址固定；请求拒绝跳转，避免凭据跟随重定向。错误提示不会显示服务商原始响应。
- Markdown 中的代码块、行内代码、URL、公式和 front matter 等受保护内容保持原样。预览经过 DOMPurify 清理，不执行嵌入脚本，不自动加载远程图片。

支持最大 2 MB 的 UTF-8 文档。翻译按段进行，失败或停止后保留已完成段落，可继续翻译或下载部分结果。模型仍可能产生术语、语义或指令遵循错误；严格的格式校验不能保证翻译完全准确。

## GitHub Pages 构建

需要 Node.js 22 或更新版本。

```sh
npm ci
npm test
npm run build:pages
```

`dist/` 包含全部静态网页文件及 PAW 连接脚本下载，可放在域名根目录或项目子目录。在线版不使用原局域网服务器的 LocalAI 网关，但允许用户显式配置自己的本地接口。普通云端模型由访问者填写密钥；PAW 官方云端当前支持匿名调用。

静态网站从 `gh-pages` 分支发布。修改后可执行：

```sh
npm test
git add .
git commit -m "Update translator"
git push origin main
npm run publish:pages
```

发布脚本只允许将规定的静态网页文件推送到 `gh-pages`，使用普通快进更新，不会覆盖并发提交。首次部署时，在 GitHub 仓库 **Settings → Pages → Source** 选择 **Deploy from a branch**，分支选择 `gh-pages`，目录选择 `/ (root)`。

不需要模型密钥、GitHub Actions Secrets 或新增 workflow 授权。`main` 保存源码，`gh-pages` 仅保存网页构建产物；访问者的 API Key 不在两者中。

2026-10-13 检查时，魔搭、Groq、DeepSeek 和智谱允许来自本 Pages 域名的标准跨域预检；魔搭与 Groq 另经正式网页的无效密钥鉴权请求验证。**Z.ai 当前没有返回允许浏览器跨域访问的响应头**，保留预设供接口支持后使用，并在设置中提示此限制。有效密钥下的翻译仍需使用用户自己的账户验证。若网页提示 CORS / 网络错误，请检查网络、地区限制或服务商政策；不要把密钥交给不明公共代理。

2026-10-15 新增免费预设验证：OpenRouter、硅基流动、智谱的 GitHub Pages Origin 跨域预检均通过；本机预览网页使用明确无效的测试密钥，三家均返回可由浏览器读取的鉴权失败，证明浏览器请求到达接口。未提供有效密钥，尚未验证这三个模型实际生成译文，不将鉴权响应计为翻译成功。26 项自动测试通过，含新增服务商请求路由和本地密钥隔离。

## 局域网 LocalAI 版本

相同代码也保留 LocalAI 网关，默认监听 `0.0.0.0:8765`。外部服务商在此版本中同样由浏览器直连。网关拒绝转发外部服务商凭据。

```sh
npm ci
npm run build
HOST=0.0.0.0 PORT=8765 \
LOCALAI_URL=http://127.0.0.1:8080/v1 \
LOCALAI_MODEL=qwen3.8-flash-next-strata \
LOCALAI_KEY_FILE=/path/outside/repository/localai-key \
npm start
```

LocalAI 网关的上游服务凭据由部署者管理，放在仓库外的受限文件或 systemd credential 中；它不是访客在页面填写的外部 API Key，永远不会下发到网页。`deploy/lan-translator.service` 是通用模板，请按设备情况配置 LocalAI 地址及 Node 路径。不要把真实凭据写入源代码、服务模板或提交到 Git。

## 验证与实现

```sh
npm test
npm run build
npm run build:pages
```

测试覆盖文本与 Markdown 结构保护、异常格式拒绝、恢复翻译、服务商地址绑定、密钥存储隔离、清除与刷新行为、请求去向、凭据不进入请求正文、错误回显防护及取消处理。测试使用明确标注的虚构凭据，不会发起真实计费模型调用。

- `src/app.mjs`：交互、设置、文件处理与预览。
- `src/api.mjs`：浏览器直接调用外部 API。
- `src/credentials.mjs`：页面内存与主动选择的浏览器本地存储。
- `src/translation.mjs`：分段及 Markdown 格式保护。
- `providers.mjs`：无密钥服务商预设与生成参数。
- `prompts.mjs`：翻译系统提示词与输出校验。
- `server.mjs`：仅局域网 LocalAI 版本使用的网关。

第三方组件许可随构建输出在 `licenses.txt` 中提供。


### 服务商配置、备份与 WebDAV

模型设置使用单一服务商选择器，内置 DeepSeek、智谱中国 / 海外、OpenRouter、Hugging Face、ModelScope、Groq、硅基流动；自建服务商集中在「我的服务商」，支持创建、重命名和删除。模型下拉选项区分免费模型、Free Plan 和试用额度；免费信息依据官方资料于 2026-10-22 核对，实际限额与费用以账户为准。模型价格来源见 `providers.mjs` 的 `PRICING_SOURCES`。

配置文件为 `yijian-config` 版本 1 JSON，包含服务商、模型列表及各功能绑定。默认不导出密钥，可主动勾选包含明文密钥。导入先预览，再按稳定 ID 合并；未列出的服务商保留。相同 ID 的地址变更会丢弃原密钥，不会转发到新接口。导入密钥默认只保存在本页；另行勾选才持久化。文件最大 1 MB，最多 100 个服务商，每个最多 500 个模型。

WebDAV 填写完整 JSON 文件 URL，以 GET 读取配置，重复读取用于更新本地；也可用 PUT 上传配置。支持 Basic 认证，账号密码仅本页暂存，不进入导出文件；本机 / 私有局域网地址允许 HTTP，公网要求 HTTPS。浏览器直连，需要服务端允许来源、GET/PUT/OPTIONS 及 Authorization、Content-Type、If-Match、If-None-Match 请求头，并暴露 ETag。覆盖上传使用 If-Match 检查版本；文件不存在时以 If-None-Match 创建；版本冲突拒绝覆盖。目录须预先存在。不后台自动同步，也不自动上传密钥。

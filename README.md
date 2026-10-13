# 译间 · Yijian Translator

一个支持英文与简体中文互译的网页工具：自动检测方向，翻译粘贴的纯文本或 Markdown，在浏览器中预览并下载译文。支持日间与夜间模式。

**在线使用：[打开译间](https://wang-kaijun.github.io/yijian-translator/)**

## 使用

1. 打开右下角的「引擎设置」。
2. 选择服务商，填写你自己的 API Key，点击「测试接口」或「应用设置」。
3. 粘贴文字，或切换 Markdown 选择 `.md` / `.markdown` 文件。
4. 点击「开始翻译」。Markdown 结果可以切换预览与源码，也可以下载。

| 服务商 | 默认模型 | 接口基础地址 |
| --- | --- | --- |
| 魔搭 ModelScope | `Qwen/Qwen3.8-Flash-Next` | `https://api-inference.modelscope.cn/v1` |
| Groq | `openai/gpt-oss-120b` | `https://api.groq.com/openai/v1` |
| DeepSeek | `deepseek-flash` | `https://api.deepseek.com` |
| Z.ai | `glm-5.3` | `https://api.z.ai/api/paas/v4` |
| 智谱 | `glm-5` | `https://open.bigmodel.cn/api/paas/v4` |
| 自定义 | 自行填写 | 支持浏览器跨域访问的 HTTPS、OpenAI Chat Completions 兼容接口 |

预设模型 ID 可以修改。获取密钥：[魔搭](https://modelscope.cn/my/myaccesstoken)、[Groq](https://console.groq.com/keys)。免费额度、模型可用性、地区限制和超额费用由服务商决定，网页不提供共享密钥。

## 密钥与文件

- 外部 API **由浏览器直接调用**。API Key 仅通过 HTTPS `Authorization` 请求头发送给用户选择的服务商用于鉴权，不经过本应用服务器，不发送给 GitHub，不进入 URL、译文下载、构建产物或统计服务。
- 默认密钥只在当前页面内存中；刷新或关闭页面即清除。用户主动勾选「记住到此浏览器」后，才保存到本浏览器本站的 `localStorage`。不同服务商分别保存。可用「清除本浏览器保存的全部密钥」删除本页和本站保存的密钥；其他已打开的标签页应关闭或刷新。
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

`dist/` 包含全部静态网页文件，可放在域名根目录或项目子目录。在线版默认魔搭，不连接局域网 LocalAI。仅提供网页不提供模型，访问者需要填写自己的 API Key。

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

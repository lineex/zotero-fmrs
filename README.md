# FMRS Downloader for Zotero

一个面向 Zotero 7/8 的 FMRS 插件：

- 右键条目从 FMRS 解析 DOI/PMID 对应文献
- 按 FMRS 返回的下载通道尝试挂载 PDF 到当前条目
- 失败时自动向全文请求邮箱提交申请
- 保存 UID / Token / accessMode / 默认邮箱，重启后继续生效
- 可接入 Agent Mail CLI，自动轮询邮箱并把收到的 PDF 附件挂回对应条目

## 当前能力

1. 从条目字段提取 `DOI` 或 `PMID`
2. 通过 `article/detail` 和 `article/download` 获取文献记录与下载通道
3. 将可直链的 PDF 作为 Zotero 附件挂到父条目
4. 下载失败时可自动触发 `require/submit`
5. 偏好页可验证会话并补回账号邮箱
6. 可配置 Agent Mail 邮箱轮询，将全文请求回来的附件自动导入 Zotero 条目
7. 提供 FMRS 登录辅助说明，并优先尝试从 **Cookie** 中回填 `uid` / `token` / `accessMode`
8. 在 Zotero 能力允许时，内嵌 FMRS 登录页辅助微信扫码登录

## 说明

- 这个版本依赖你已经有可用的 FMRS 登录态。
- 插件会保存 `uid` 和 `token`，并在 Zotero 启动后继续使用。
- 当前版本不再假定 `uid/token` 一定出现在 `localStorage`；会优先尝试从 `metstr.com` 相关 Cookie 中恢复会话。
- 如果 FMRS 需要通过邮箱回传全文，插件会把请求发到你配置的邮箱地址。
- 如果你已安装并授权 `agently-cli`，插件可轮询邮件并自动导入 PDF 附件。

## Agent Mail CLI

官方 Agent Mail CLI 文档要点：

```bash
npm install -g @tencent-qqmail/agently-cli
agently-cli auth login
agently-cli +me
```

常用命令：

```bash
agently-cli message +list --limit 10 --has-attachments
agently-cli message +read --id msg_xxx
agently-cli attachment +download --msg msg_xxx --att att_xxx --output ./downloads
```

当前插件里：

- `Agent Mail` 配置区可填写 `agently-cli` 路径
- 可验证是否已授权成功
- 可设置发件人过滤（留空则不过滤）
- 可立即手动同步，或在 Zotero 运行期间自动轮询
- 当 FMRS 账户邮箱为空时，可回退使用已授权的 Agent Mail 地址作为全文请求邮箱

## 构建

```bash
npm install
npm run build
```

构建完成后，`.xpi` 会由 `zotero-plugin-scaffold` 放到对应的发布目录。

## 安装

在 Zotero 中打开 `Tools -> Plugins`，把生成的 `.xpi` 拖进去即可。

## 配置

在 Zotero 的插件偏好页填写：

- API base URL
- UID
- Token
- accessMode
- 默认全文请求邮箱

然后点 `Verify session` 检查登录态。

然后点 `Verify session` 检查登录态。

## 邮件轮询与文献自动回填

插件支持通过两种方式轮询您接收文献的邮箱：

1. **POP3 直接轮询 (推荐)**：
   - 可以在偏好页启用 **Agent Mail / 邮箱自动同步** 并选择 **pop3** 后端。
   - 输入您接收文献邮箱的 POP3 服务器 (如 `pop.163.com`)、端口 (通常为 `995`)、SSL 状态，以及邮箱账户和授权密码。
   - 点击验证按钮检查是否连接正常。

2. **Agent Mail CLI (agently)**：
   - 先在系统里安装并授权 `agently-cli`；
   - 在插件配置里启用 `Agent Mail`，选择 **agently** 后端；
   - 设置 `agently-cli` 路径并验证连接。

### 发件人过滤与匹配规则

- **发件人过滤器支持多值**：在“发件人过滤”中，您可以输入多个邮箱或域名，以逗号或分号分隔（例如：`@ivqqiv.com, @clas.ac.cn`）。支持直接输入域名（如 `ivqqiv.com`）以匹配对应域名下的所有发件人。
- **可信白名单**：对于来自 `@ivqqiv.com`（FMRS文献投递系统）和 `@clas.ac.cn`（中科院文献情报中心文献传递）的投递邮件，插件将自动信任并进行文献匹配，放宽了之前对主题必须严格匹配的限制。
- **正文元数据与标题精准匹配**：
  - 如果邮件中没有多余的元数据信息（如正文只包含“请查看附件”），插件会自动降级为通过**标题高度一致性**进行安全匹配。
  - **PMID 宽限匹配**：如果下载附件文件名开头包含 PMID/FMRS 编号（如 `P37314417`），且该数字出现在 Zotero 选中条目的 `extra` (其他) 字段或 PMID 数据库中，则可直接完成 100% 自动精确关联。

## 已知边界

- FMRS 微信扫码登录仍然依赖 FMRS 官方页面本身；插件做的是“内嵌登录页 + Cookie 会话捕获 + 回填设置”。
- 不同 Zotero / Gecko 运行环境对内嵌 browser 的支持可能不完全一致；如果内嵌页面失败，可先用外部浏览器登录，再返回插件点击“重新检测登录态”。
- 如果 Agent Mail 返回的是大附件直链而不是 `attachment_id`，当前版本会提示下载链接而非自动接管。

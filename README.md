# AI Web Clipper

一键抓取网页内容，通过 AI 智能总结，保存为本地 Markdown 文件，并自动构建多层次知识体系。

## 功能特性

- **AI 智能总结** — 支持多种 Prompt 模板（快速总结、技术精读、学术论文、全文翻译等）
- **多 AI 模型支持** — OpenAI、Claude、DeepSeek、Kimi、智谱 GLM、通义千问、MiniMax、豆包等
- **免费模式** — 支持 Zero Token 模式，复用浏览器登录态免费调用 AI（Kimi、智谱、千问）
- **知识体系** — AI 自动分类，多层文件夹管理，File System Access API 扫描本地目录同步
- **侧边栏对话** — 基于当前网页内容的多轮 AI 深度对话
- **PDF 支持** — 自动检测 PDF 页面，提取文字内容进行总结
- **Markdown 保存** — 一键保存为本地 .md 文件，支持自定义保存路径
- **右键菜单 & 快捷键** — 快速触发总结、打开侧边栏
- **深色模式** — 自动跟随系统主题

## 安装

### 从源码安装（开发者）

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/ai-web-clipper.git
cd ai-web-clipper

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 构建生产版本
npm run build
```

构建完成后，在 Chrome 浏览器中：
1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `.output/chrome-mv3` 目录

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+S` (Mac: `⌘+Shift+S`) | 触发 AI 总结当前页面 |
| `Ctrl+Shift+L` (Mac: `⌘+Shift+L`) | 打开侧边 AI 对话 |

## 配置 AI 模型

打开扩展设置页（点击扩展图标 → 齿轮图标），在「基础设置」中添加 AI 模型：

1. **API Key 模式**：填入各 AI 服务商的 API Key（OpenAI、DeepSeek、Kimi 等）
2. **免费模式**：启用 Zero Token 模式，只需在对应网站登录即可免费使用

支持配置多个模型，自动按优先级 Fallback。

## 知识体系

扩展会自动将保存的文章分类到知识体系文件夹中：

- **自动分类** — 保存时 AI 自动推断文章所属分类
- **扫描目录** — 使用 File System Access API 扫描本地文件夹，同步知识体系
- **文件管理** — 在知识体系 Tab 中查看、展开文件列表、打开和删除文件
- **层级设置** — 支持 1~5 层文件夹深度

## 技术栈

- **框架**：[WXT](https://wxt.dev/) (Chrome Extension Framework)
- **前端**：React 18 + TypeScript + Tailwind CSS
- **AI SDK**：OpenAI Node.js SDK（兼容所有 OpenAI 格式 API）
- **内容提取**：[@mozilla/readability](https://github.com/mozilla/readability)
- **Markdown**：react-markdown + remark-gfm

## 项目结构

```
ai-web-clipper/
├── components/          # 共享 UI 组件
├── entrypoints/         # 扩展入口点
│   ├── background.ts    # Service Worker（消息中枢）
│   ├── content.ts       # Content Script（页面内容提取）
│   ├── options/         # 设置页
│   ├── popup/           # 弹出窗口
│   └── sidepanel/       # 侧边栏对话
├── lib/                 # 核心业务逻辑
│   ├── ai/              # AI Provider、分类器、Zero Token
│   ├── markdown/        # Markdown 生成
│   ├── storage/         # 存储管理（历史、知识体系、模板）
│   ├── types.ts         # 类型定义
│   └── utils/           # 工具函数（PDF 提取等）
├── public/              # 静态资源（图标）
├── wxt.config.ts        # WXT 配置
└── package.json
```

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 读取当前页面内容 |
| `storage` | 保存设置、历史记录、知识体系 |
| `downloads` | 保存 Markdown 文件到本地 |
| `scripting` | 动态注入 Content Script |
| `contextMenus` | 右键菜单 |
| `sidePanel` | 侧边栏对话 |
| `notifications` | 知识体系更新通知 |
| `cookies` | 免费模式读取 AI 平台登录态 |

## 开源协议

[MIT License](LICENSE)

## 贡献

欢迎提交 Issue 和 Pull Request！

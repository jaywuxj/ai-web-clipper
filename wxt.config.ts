import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "AI Web Clipper",
    description: "一键抓取网页内容，通过 AI 总结后保存为本地 Markdown 文件",
    version: "2.0.0",
    permissions: [
      "activeTab",
      "storage",
      "downloads",
      "downloads.open",
      "scripting",
      "contextMenus",
      "sidePanel",
      "notifications",
      "cookies",
    ],
    host_permissions: [
      "<all_urls>",
      "https://kimi.moonshot.cn/*",
      "https://tongyi.aliyun.com/*",
      "https://qianwen.biz.aliyun.com/*",
      "https://qianwen.com/*",
      "https://www.qianwen.com/*",
      "https://chat.qwen.ai/*",
      "https://tongyi.com/*",
      "https://chatglm.cn/*",
    ],
    action: {
      default_icon: {
        "16": "icon/icon.svg",
        "32": "icon/icon.svg",
        "48": "icon/icon.svg",
        "128": "icon/icon.svg",
      },
    },
    icons: {
      "16": "icon/icon.svg",
      "32": "icon/icon.svg",
      "48": "icon/icon.svg",
      "128": "icon/icon.svg",
    },
    side_panel: {
      default_path: "sidepanel.html",
    },
    commands: {
      "trigger-summary": {
        suggested_key: {
          default: "Ctrl+Shift+S",
          mac: "Command+Shift+S",
        },
        description: "触发 AI 总结当前页面",
      },
      "open-sidepanel": {
        suggested_key: {
          default: "Ctrl+Shift+L",
          mac: "Command+Shift+L",
        },
        description: "打开侧边 AI 对话",
      },
    },
  },
});

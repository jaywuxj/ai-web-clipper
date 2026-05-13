import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "__MSG_appName__",
    description: "__MSG_appDescription__",
    default_locale: "en",
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
    ],
    action: {
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png",
      },
    },
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
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

# Privacy Policy for AI Web Clipper

**Last updated: May 13, 2026**

## Overview

AI Web Clipper is a Chrome extension that captures web page content and uses AI to summarize, translate, or analyze it, then saves the result as a local Markdown file. We are committed to protecting your privacy.

## Information We Collect

AI Web Clipper accesses the content of web pages **only when you explicitly trigger the extension** (by clicking the extension icon, using the right-click menu, or pressing the keyboard shortcut). We do not passively collect, monitor, or track your browsing activity.

## How We Use Information

- **Web page content** is sent to your configured AI provider (e.g., OpenAI, DeepSeek, Kimi, Gemini, etc.) for summarization, translation, or analysis processing.
- **AI processing results** are displayed to you and can be saved locally as Markdown files.
- **Your AI API keys** are stored locally in Chrome's storage API and are only sent to the respective AI provider's API endpoint.
- **Cookie-based authentication** (Zero Token mode): If you choose to use the free mode, the extension reads your existing login session from supported AI websites (e.g., Kimi, Qwen, GLM) to make API calls on your behalf. No cookies are collected, stored externally, or shared.

## Data Storage

- All user settings, API keys, and preferences are stored **locally** using Chrome's `storage` API.
- Summary history is stored **locally** on your device.
- **No data is stored on our servers.** We do not operate any backend servers.

## Third-Party Services

Web page content is transmitted to third-party AI services **only when you actively trigger** a summarization or analysis. The specific service used depends on your configuration. We recommend reviewing the privacy policy of your chosen AI provider:

- [OpenAI Privacy Policy](https://openai.com/privacy/)
- [DeepSeek Privacy Policy](https://www.deepseek.com/privacy)
- [Moonshot AI (Kimi) Privacy Policy](https://kimi.moonshot.cn/privacy)

## Data Sharing

We do **not** sell, trade, or share your personal information with any third parties beyond the AI processing described above.

## Permissions Explained

| Permission | Purpose |
|---|---|
| `activeTab` | Read current page content for AI summarization when you activate the extension |
| `storage` | Store your settings, API keys, and prompt templates locally |
| `downloads` | Save AI-generated summaries as Markdown files to your local disk |
| `scripting` | Inject content extraction scripts into the active tab for reading page content |
| `contextMenus` | Provide right-click menu options for quick access |
| `sidePanel` | Display AI results in Chrome's Side Panel |
| `notifications` | Notify you when background tasks are completed |
| `cookies` | Read existing login sessions for supported AI platforms in free mode |

## Children's Privacy

AI Web Clipper is not directed at children under the age of 13. We do not knowingly collect personal information from children.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last updated" date above.

## Contact

If you have any questions about this privacy policy, please open an issue on our [GitHub repository](https://github.com/jaywuxj/AI-Web-Clipper/issues).

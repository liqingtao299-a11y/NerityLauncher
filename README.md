# Nerity 启动器

> 一款现代、美观、跨平台的 Minecraft 启动器（类 PCL / HMCL），采用微软 Fluent 设计风格。

## ✨ 特性

- 🎮 **游戏启动**：下载并管理 Minecraft 版本，一键启动（离线 / 微软账号登录）
- 🔑 **微软账号登录**：Device Code 设备码登录，完整 Xbox → Minecraft 令牌交换
- ☕ **内置 Java**：按版本自动下载 Temurin JDK（8 / 17 / 21），免去手动安装
- 🧩 **模组中心**：接入 Modrinth，按 MC 版本与加载器（Forge / Fabric / NeoForge）搜索并一键下载
- 🎨 **Fluent 界面**：深色现代化 UI，微软 Fluent 设计语言
- 🚀 **跨平台路线**：先支持 Windows，macOS 开发中，后续规划移动端

## 📦 下载

| 平台 | 状态 | 下载 |
|------|------|------|
| Windows | ✅ 已发布 | [下载](https://github.com/nerity-launcher/NerityLauncher/releases) |
| macOS | 🚧 开发中 | 敬请期待 |
| iOS / Android | 🧭 规划中 | - |

## 🔧 从源码构建

需要 Node.js 18+。

```bash
# 安装依赖
npm install

# 开发运行
npm start

# 打包 Windows 安装包（NSIS）
npx electron-builder --win nsis
```

## 🖥️ 系统要求

- Windows 10 / 11（x64）
- 运行游戏需 Java 8 / 17 / 21（启动器可自动下载）

## 📄 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

## 🙏 致谢

- [Electron](https://www.electronjs.org/) · [electron-builder](https://www.electron.build/)
- [Modrinth](https://modrinth.com/)（模组 API）
- [Adoptium](https://adoptium.net/)（Java 运行时）
- [Prism Launcher](https://prismlauncher.org/)（登录方案参考）
- [PCL](https://afdian.com/a/LTCatt) / [HMCL](https://hmcl.huangyuhui.net/)（启发）

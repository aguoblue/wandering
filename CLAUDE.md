# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概述

这是一个基于 Vite 和高德地图的 React 地图应用。项目展示了地图展示、定位和路径规划等基于位置的功能。

## 开发命令

```bash
# 首先进入应用目录
cd my-app

# 安装依赖（仅第一次）
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview

# 代码检查
npm run lint
```

## 架构说明

### 项目结构
- **根目录**：包含一个使用内联 JSX 和 Babel 的简单 React 演示
- **my-app/**：主应用，使用 Vite + React 19
  - `src/components/AmapMap.jsx`：核心地图组件
  - `src/App.jsx`：主应用组件
  - `package.json`：依赖项包括高德地图加载器和 React

### 关键依赖
- `@amap/amap-jsapi-loader`：加载高德地图 JavaScript API 2.0
- `react` & `react-dom`：React 19
- `vite`：构建工具，配有 React 插件

### 高德地图集成
- 使用命令式 API 模式与高德地图交互
- 通过环境变量进行关键配置：
  - `VITE_AMAP_KEY`：必需的 API 密钥（来自高德控制台）
  - `VITE_AMAP_SECURITY_CODE`：可选的安全密码
- 地图实例通过 React ref 管理，并正确清理
- 加载的插件：Scale（比例尺）、Geolocation（定位）

## 重要提示

- 地图组件遵循高德地图的命令式 API 模式，而非 React 的声明式模式
- 所有高德地图实例必须在 useEffect 清理函数中正确销毁，以防内存泄漏
- 坐标使用 GCJ-02 格式（中国标准）
- 应用需要有效的高德地图 API 密钥才能正常运行

## 开发习惯
- 需要注释
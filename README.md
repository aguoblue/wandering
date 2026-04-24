# wandering

这个仓库里目前有两个可单独运行的前端项目：

- 仓库根目录：主应用，Vite + React + 高德地图
- `my-app/`：从 Figma Make 导出的原型项目，Vite + React

## 运行主应用

```bash
npm install
npm run dev
```

说明：

- 默认会启动 Vite 开发服务器
- 如果要正常使用高德地图，需要在仓库根目录 `.env` 中配置 `VITE_AMAP_KEY`
- 如有需要，也可以配置 `VITE_AMAP_SECURITY_CODE`
- 主应用文件位于根目录 `src/`、`public/`、`package.json`

## 运行 `my-app`

```bash
cd my-app
npm install --legacy-peer-deps
npm run dev
npm run ai:server
```

说明：

- `my-app/` 是独立项目，不依赖主应用目录结构
- 首次安装建议使用 `--legacy-peer-deps`，因为导出依赖中存在 peer dependency 冲突
- `npm run ai:server` 会启动本地 AI 后端（`python3 server/ai_server.py`）

## 构建

主应用：

```bash
npm run build
```

`my-app`：

```bash
cd my-app
npm run build
```

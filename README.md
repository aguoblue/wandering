# wandering

这个仓库里目前有两个可单独运行的前端项目：

- `my-app/`：主应用，Vite + React + 高德地图
- `figma/`：从 Figma Make 导出的原型项目，Vite + React

## 运行 `my-app`

```bash
cd my-app
npm install
npm run dev
```

说明：

- 默认会启动 Vite 开发服务器
- 如果要正常使用高德地图，需要在 `my-app/.env` 中配置 `VITE_AMAP_KEY`
- 如有需要，也可以配置 `VITE_AMAP_SECURITY_CODE`

## 运行 `figma`

```bash
cd figma
npm install --legacy-peer-deps
npm run dev
```

说明：

- `figma/` 是独立项目，不依赖 `my-app/`
- 首次安装建议使用 `--legacy-peer-deps`，因为导出依赖中存在 peer dependency 冲突

## 构建

`my-app`：

```bash
cd my-app
npm run build
```

`figma`：

```bash
cd figma
npm run build
```

# 20260403 init repo
- try to use babel 
- 类组件、jsx

# 20260404 my-app 地图与迭代（按发生顺序）

1. **高德地图接入**：在 `my-app` 使用 `@amap/amap-jsapi-loader` 加载 JS API 2.0；新增 `src/components/AmapMap.jsx`，在 `App.jsx` 中展示地图；通过 `.env` 配置 `VITE_AMAP_KEY`，可选 `VITE_AMAP_SECURITY_CODE`。
2. **定位**：在 `AmapMap` 中集成 `AMap.Geolocation`（比例尺、右下角定位按钮、可选自动定位 `autoLocate`）。
3. **`.gitignore`**：仓库根目录补充环境变量、系统文件等常见忽略项说明；`my-app` 侧保留 Vite 模板的 `node_modules`、`dist` 等规则。
4. **精简页面**：从 `App.jsx` 移除 `NameDisplay`、`AgeDisplay` 及其组件文件。
5. **梧桐山展示**：导出常量 `WUTONG_SHAN`（GCJ-02 坐标）；支持 `markers` 打点；`App.jsx` 以梧桐山为中心并显示标记。
6. **路径规划**：`AmapMap` 增加 `route`，使用 `AMap.Driving` / `AMap.Walking` 在地图上绘制驾车或步行路线（固定 `from` + `to`）。
7. **当前位置 → 梧桐山**：`route` 支持 `fromCurrentLocation: true` + `to`，先 `getCurrentPosition` 再规划路线；`App` 中示例改为从当前位置导航至梧桐山。
8. **注释**：为 `AmapMap.jsx` 补充文件头、步骤分段、`useEffect` 依赖说明及 Props 的 JSDoc，便于阅读结构。
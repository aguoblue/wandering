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

# 20260404 搜索功能优化（16:05）

1. **搜索框集成**：新增 `src/components/SearchBox.jsx`，集成高德地图 `AMap.AutoComplete` 实现地点搜索自动补全功能。
2. **移除硬编码**：删除 `WUTONG_SHAN` 常量和相关硬编码标记代码，移除 `AMap.Marker` 插件的依赖。
3. **动态标记功能**：
   - `addSearchMarker` 函数负责创建和管理搜索结果的标记
   - 标记包含：名称标签、点击信息窗口、掉落动画效果
   - 搜索时地图自动调整到搜索结果位置（缩放到 16 级）
   - 支持点击标记显示详细信息（名称、地址、类型）
4. **组件优化**：
   - SearchBox 组件只负责输入框的自动补全功能，通过回调通知父组件
   - 添加了搜索标记的清理逻辑，防止内存泄漏
   - 优化了组件的依赖关系，移除了不必要的插件加载

# 20260404 搜索功能修复（17:30）

1. **修复接口不匹配问题**：
   - 移除 `AmapMap` 中多余的 `handleSearchComplete` 函数
   - 重命名 `addSearchMarker` 为 `handleSearchComplete`，统一命名
2. **修复搜索回调逻辑**：
   - `SearchBox` 在 `select` 事件中正确调用 `onSearchComplete(e.poi)` 传递 POI 数据
   - 移除错误的回调函数传递方式，改为直接使用 `window.AMap`
3. **组件通信修正**：
   - `AmapMap` 正确传递 `handleSearchComplete` 给 `SearchBox`
   - 搜索完成后自动添加标记、移动地图中心并缩放到 16 级

# 20260404 搜索功能修复（18:15）

1. **修复 AutoComplete 加载时机问题**：
   - SearchBox 组件改为独立加载 AMap API，不依赖 AmapMap 的加载状态
   - 添加 `ready` 状态控制输入框可用性，显示加载中状态
   - 使用 `autoCompleteRef` 管理 AutoComplete 实例
2. **用户体验优化**：
   - 输入框在 API 加载前显示"加载中..."并禁用
   - 加载完成后自动启用，显示"搜索地点..."占位符

# 20260404 搜索框样式优化（18:30）

1. **添加 AutoComplete 下拉列表样式**：
   - `.amap-sug-result`：下拉容器样式，白色背景、圆角、阴影
   - `.amap-sug-item`：建议项样式，hover 高亮、选中状态蓝色背景
   - 添加滚动条支持，最大高度 300px

# 20260404 搜索坐标获取修复（19:00）

1. **修复 AutoComplete 缺少坐标的问题**：
   - AutoComplete 只提供自动补全建议，不包含坐标信息
   - 添加 PlaceSearch 插件，当选择 AutoComplete 建议后，用 PlaceSearch 搜索获取详细信息和坐标
   - 如果 AutoComplete 已有坐标则直接使用，否则调用 PlaceSearch 搜索
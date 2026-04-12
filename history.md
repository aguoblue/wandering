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

# 20260404 路线规划功能（20:00）

1. **新增 RoutePanel 组件**：
   - 支持交通方式切换：驾车/步行/公交
   - 起点支持手动输入（AutoComplete）、定位按钮、地图选点
   - 终点显示搜索选择的地点（只读）
   - 可折叠和关闭
   - 新增 `RoutePanel.css` 样式文件
2. **AmapMap 集成路线规划**：
   - 搜索完成后信息窗口添加"规划路线"按钮
   - 点击按钮显示 RoutePanel 面板
   - 支持清除之前路线，规划新路线
   - 地图点击事件支持选点为起点
   - 起点、终点使用标准起点/终点标记图标
3. **路线规划 API**：
   - 驾车：使用 AMap.Driving
   - 步车：使用 AMap.Walking
   - 公交：使用 AMap.Transfer

# 20260404 路线交互优化（21:00）

1. **简化路线规划交互**：
   - 搜索框下方集成交通方式选择（驾车/步行/骑行/地铁）
   - 搜索完成后显示交通方式按钮
   - 选择交通方式后立即规划路线，使用当前位置作为起点
2. **SearchBox 组件更新**：
   - 添加 `travel-modes` 交通方式选择区域
   - 新增 `onTravelModeChange` 回调
   - 支持四种交通方式：驾车、步行、骑行、地铁
3. **AmapMap 简化**：
   - 移除 RoutePanel 组件及相关代码
   - 搜索完成后清除之前的路线
   - 切换交通方式时清除旧路线，规划新路线
4. **样式更新**：
   - 添加交通方式按钮样式（横向排列，图标+文字）
   - 选中状态蓝色高亮

# 20260405 点击地图设置终点功能

1. **新增功能**：点击地图任意位置作为终点的功能
2. **实现细节**：
   - 添加 `handleMapClick` 函数处理地图点击事件
   - 使用 `AMap.Geocoder` 进行逆地理编码，获取点击位置的详细地址信息
   - 点击后自动在搜索框中填充地址名称
   - 在地图上添加标记点，显示点击位置的名称和地址
   - 点击标记可查看详细信息窗口
3. **代码改动**：
   - `AmapMap.jsx`:
     - 添加了地图点击事件监听：`mapRef.current.on('click', handleMapClick)`
     - 使用逆地理编码将坐标转换为地址
     - 添加了 `searchBoxValue` 状态和 `updateSearchBoxValue` 方法
     - 自动清除之前的搜索结果和路线
   - `SearchBox.jsx`:
     - 添加了 `onValueUpdate` 回调属性
     - 添加了 `updateInputValue` 方法更新输入框值
     - 添加了 `useEffect` 监听全局更新事件
4. **用户体验**：
   - 点击地图任意位置，自动填充地址到搜索框
   - 地图自动调整视野到点击位置（缩放到 16 级）
   - 添加带动画的标记点，显示位置名称
   - 点击标记显示详细信息窗口

# 20260405 收藏夹链路修复

1. **修复收藏添加流程**：
   - `App.jsx` 新增 `selectedLocation` 状态，接收地图点击或搜索得到的位置
   - `Favorites.jsx` 接收 `selectedLocation`，在添加表单中直接展示当前选中的经纬度和地址
   - 添加收藏表单增加提示文案，明确“打开表单后可在地图上点击或搜索选择位置”
2. **修复收藏定位流程**：
   - `AmapMap.jsx` 改为通过 `ref` 暴露 `showLocation` 和 `centerOnLocation`
   - 从收藏夹点击“定位”时，直接在地图上展示该收藏点并移动视角，不再依赖未注册的全局方法
3. **顺手清理实现问题**：
   - `Favorites.jsx` 改为使用 `useState` 初始化函数读取 `localStorage`，避免 effect 内同步 `setState`
   - `AmapMap.jsx` 抽出统一的位置展示逻辑，修复未定义 `AMap` 的引用
   - `SearchBox.jsx` 调整回调定义顺序，移除无用变量，使 `npm run lint` 可通过
4. **修复点击后不定位的问题**：
   - 统一地图点击、搜索结果、收藏夹、`localStorage` 中的坐标格式为普通 `{ lng, lat }`
   - 调用高德地图 `setCenter`、`Marker`、`InfoWindow` 时统一转换为 `[lng, lat]`
   - 避免 `AMap.LngLat` 与普通对象混用导致点击收藏后地图不跳转
5. **修复点击后地图重建的问题**：
   - `App.jsx` 中将传给 `AmapMap` 的回调用 `useCallback` 固定引用
   - 避免点击地图后 `selectedLocation` 更新触发 `AmapMap` 初始化 effect 重新执行
   - 防止地图回到 `DEFAULT_CENTER` 后再次自动定位

# 20260407 路线规划 NO_PARAMS 修复

1. **原因**：`searchEndPoint.location` 存的是普通对象 `{ lng, lat }`，`AMap.Driving` / `Walking` / `Riding` / `Transfer` 的 `search` 需要 **`AMap.LngLat`**（或文档认可的格式），直接传普通对象会返回 **`NO_PARAMS`**。
2. **修改**：`AmapMap.jsx` 增加 `toAMapLngLat(AMap, location)`，在 `handleTravelModeChange` 的插件回调里将起点、终点转为 `new AMap.LngLat(lng, lat)` 再调用 `route.search`；公交逆地理 `getAddress` 也改为使用转换后的终点。

# 20260407 删除未使用的 RoutePanel

1. 删除 `my-app/src/components/RoutePanel.jsx`、`RoutePanel.css`（无任何引用，历史版本中已从主流程移除）。

# 20260407 收藏备注与默认展示名

1. **`Favorites.jsx`**：添加收藏时「名称」改为选填「备注」；保存时的列表标题为 `trim(备注) || 地图选中点的 name || 地址`，仅要求已选位置；表单下方显示即将保存的「展示名称」预览。

# 20260409 figma 原型补齐可运行工程

1. **补齐运行入口**：为 `figma/` 新增 `index.html` 和 `src/main.tsx`，挂载 React 应用并引入全局样式。
2. **完善脚本**：在 `figma/package.json` 中补充 `dev`、`build`、`preview`，使其成为标准 Vite 前端项目。
3. **依赖调整**：将 `react`、`react-dom` 改为项目真实依赖，并使用 `npm install --legacy-peer-deps` 完成安装，绕过 Figma 导出依赖集合中的 peer 冲突。
4. **验证结果**：`cd figma && npm run build` 已成功，当前可作为独立前端原型运行和打包。
5. **仓库说明**：新增根目录 `README.md`，补充 `my-app/` 与 `figma/` 的安装、启动和构建方式。

# 20260411 figma 地图切换为高德

1. **地图渲染方式替换**：`figma/src/app/components/MapView.tsx` 从 OpenStreetMap `iframe` 改为高德 JS API 动态地图，支持真实地图交互。
2. **点位与路线展示**：基于活动坐标渲染彩色编号 Marker，并使用 `AMap.Polyline` 连线形成当天/全程路线。
3. **数据格式适配**：将原数据中的 `[lat, lng]` 转换为高德需要的 `[lng, lat]`，保证点位和路径位置正确。
4. **错误兜底提示**：新增地图加载态与失败态，缺少 `VITE_AMAP_KEY` 或加载异常时给出明确提示。
5. **依赖补充**：`figma/package.json` 新增 `@amap/amap-jsapi-loader` 依赖。

# 20260411 figma routes.tsx JSX 作用域

1. **`figma/src/app/routes.tsx`**：在文件顶部增加 `import React from "react"`，消除「JSX 需要 React 在作用域内」的 TypeScript/ESLint 报错（经典 JSX 运行时假定）。

# 20260411 figma React 类型定义

1. **`figma/package.json`**：在 `devDependencies` 中增加 `@types/react`、`@types/react-dom`（与 `react` 19 对齐），解决 `react/jsx-runtime` 无声明文件、隐式 `any` 的 TypeScript 报错。
2. **安装**：使用 `npm install --legacy-peer-deps` 完成安装（与现有 peer 依赖策略一致）。
3. **验证**：`npm run build` 与 `tsc --noEmit`（通过 `npx -p typescript@5.8.3 tsc`）通过。

# 20260412 地图点位聚焦与线路降噪

1. **点位关系高亮**：`my-app/src/components/AmapMap.jsx` 从“单 marker 引用”改为“节点/边集合管理”，支持点击 marker 时聚焦当前点、提亮相连点并淡化其余点位。
2. **路线关系高亮**：驾车/步行/骑行/地铁改为提取路径后用 `AMap.Polyline` 自绘，点击点位时仅凸显关联线路，其他线路降透明度显示。
3. **交互细节**：
   - 点位按状态切换视觉层级（`active / connected / dimmed`），并通过 `zIndex` 保证焦点在最上层。
   - 新增起点节点（当前位置）并与终点节点建立边关系，便于表达“点击点位 -> 高亮关联路径”。
4. **样式补充**：`my-app/src/App.css` 新增 `.map-node` 系列样式，包含缩放、饱和度、阴影与淡化效果，提升地图上的焦点引导。

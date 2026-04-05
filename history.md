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
import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { SearchBox } from './SearchBox'

/**
 * 高德地图接入（基础）：底图 + 比例尺 + 定位控件。
 * 地图为命令式 API，用 ref 挂 DOM，在 useEffect 里创建/销毁实例。
 */

const KEY = import.meta.env.VITE_AMAP_KEY
const SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE

/** 默认中心 [lng, lat]，GCJ-02 */
const DEFAULT_CENTER = [116.397428, 39.90923]

export function AmapMap({
  zoom = 11,
  center = DEFAULT_CENTER,
  className,
  showLocateButton = true,
  autoLocate = true,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  // 搜索相关的状态
  const searchMarkerRef = useRef(null)
  const [searchEndPoint, setSearchEndPoint] = useState(null) // 搜索选择的终点
  const [currentTravelMode, setCurrentTravelMode] = useState(null) // 当前选择的交通方式
  const [searchBoxValue, setSearchBoxValue] = useState('') // 搜索框的值
  const [showTravelMode, setShowTravelMode] = useState(false) // 控制路线选择框显示
  const [selectedTravelMode, setSelectedTravelMode] = useState('') // 选中的交通方式

  // 更新搜索框值的方法
  const updateSearchBoxValue = (value) => {
    setSearchBoxValue(value)
    // 通过全局方法更新 SearchBox 组件
    if (window.updateSearchBoxInput) {
      window.updateSearchBoxInput(value)
    }
  }

  // 路线相关的状态
  const routeRef = useRef(null) // 路线实例（Driving/Walking/Riding/Transit）
  // 注意：不再需要 routeMarkersRef，因为插件会自动管理标记

  // 处理点击地图事件：设置终点
  const handleMapClick = (e) => {
    if (!mapRef.current) return

    const clickPosition = e.lnglat

    // 使用逆地理编码获取点击位置的地址信息
    window.AMap.plugin('AMap.Geocoder', () => {
      const geocoder = new window.AMap.Geocoder({
        radius: 100, // 搜索半径
        extensions: 'all'
      })

      geocoder.getAddress(clickPosition, (status, result) => {
        if (status === 'complete' && result?.regeocode) {
          const addressInfo = result.regeocode
          const poi = {
            location: clickPosition,
            name: addressInfo.formattedAddress || '点击位置',
            address: addressInfo.formattedAddress,
            type: '手动选择'
          }

          // 清除之前的搜索结果和路线
          clearRoute()
          setSearchEndPoint(poi)
          setCurrentTravelMode(null)
          setShowTravelMode(true) // 显示路线选择框
          setSelectedTravelMode('') // 重置选中的交通方式

          // 移除之前的搜索标记
          if (searchMarkerRef.current) {
            mapRef.current.remove(searchMarkerRef.current)
            searchMarkerRef.current = null
          }

          // 创建新的搜索标记
          searchMarkerRef.current = new window.AMap.Marker({
            position: clickPosition,
            title: poi.name,
            animation: 'AMAP_ANIMATION_DROP',
            map: mapRef.current,
            label: {
              content: poi.name,
              direction: 'top',
            }
          })

          // 添加信息窗口
          const infoWindow = new window.AMap.InfoWindow({
            content: `
              <div style="padding: 10px; font-size: 14px;">
                <div style="font-weight: bold; margin-bottom: 5px;">${poi.name}</div>
                <div style="color: #666;">${poi.address || '地址未知'}</div>
                <div style="color: #999; font-size: 12px; margin-top: 5px;">
                  类型: ${poi.type || '未知'}
                </div>
              </div>
            `,
            offset: new window.AMap.Pixel(0, -30),
            closeWhenClickMap: true,
          })

          // 点击标记显示信息窗口
          searchMarkerRef.current.on('click', () => {
            infoWindow.open(mapRef.current, clickPosition)
          })

          // 将地图中心移动到点击位置
          mapRef.current.setCenter(clickPosition)
          mapRef.current.setZoom(16)

          // 更新搜索框的值
          setSearchBoxValue(poi.name)

          // 通过 window 对象更新搜索框，使用地图专用方法
          if (window.updateSearchBoxInputFromMap) {
            window.updateSearchBoxInputFromMap(poi.name)
          }
        } else {
          console.error('逆地理编码失败', result)
        }
      })
    })
  }

  // 处理搜索完成回调：添加标记
  const handleSearchComplete = (poi) => {
    if (!mapRef.current || !poi) return

    // 清除之前的路线
    clearRoute()
    setSearchEndPoint(poi)
    setCurrentTravelMode(null)
    setShowTravelMode(true) // 显示路线选择框
    setSelectedTravelMode('') // 重置选中的交通方式

    // 移除之前的搜索标记
    if (searchMarkerRef.current) {
      mapRef.current.remove(searchMarkerRef.current)
      searchMarkerRef.current = null
    }

    // 创建新的搜索标记
    searchMarkerRef.current = new AMap.Marker({
      position: poi.location,
      title: poi.name,
      animation: 'AMAP_ANIMATION_DROP',
      map: mapRef.current,
      label: {
        content: poi.name,
        direction: 'top',
      }
    })

    // 添加信息窗口
    const infoWindow = new AMap.InfoWindow({
      content: `
        <div style="padding: 10px; font-size: 14px;">
          <div style="font-weight: bold; margin-bottom: 5px;">${poi.name}</div>
          <div style="color: #666;">${poi.address || '地址未知'}</div>
          <div style="color: #999; font-size: 12px; margin-top: 5px;">
            类型: ${poi.type || '未知'}
          </div>
        </div>
      `,
      offset: new AMap.Pixel(0, -30),
      closeWhenClickMap: true,
    })

    // 点击标记显示信息窗口
    searchMarkerRef.current.on('click', () => {
      infoWindow.open(mapRef.current, poi.location)
    })

    // 将地图中心移动到搜索结果
    mapRef.current.setCenter(poi.location)
    mapRef.current.setZoom(16)
  }

  // 清除之前的路线和标记
  const clearRoute = () => {
    // 清除搜索标记
    if (searchMarkerRef.current) {
      if (mapRef.current) {
        try {
          mapRef.current.remove(searchMarkerRef.current)
        } catch (e) {
          console.error('清除搜索标记失败:', e)
        }
      }
      searchMarkerRef.current = null
    }

    // 清除路线实例（插件会自动清除相关的标记和路线）
    if (routeRef.current) {
      try {
        routeRef.current.clear()
      } catch (e) {
        console.error('清除路线失败:', e)
      }
      routeRef.current = null
    }
  }

  // 处理交通方式选择，开始规划路线
  const handleTravelModeChange = async (travelMode) => {
    console.log('=== handleTravelModeChange 被调用 ===')
    console.log('交通方式:', travelMode)
    console.log('searchEndPoint:', searchEndPoint)

    if (!mapRef.current || !searchEndPoint?.location) {
      console.log('检查失败: mapRef.current 或 searchEndPoint.location 不存在')
      return
    }

    // 总是清除之前的路线，确保干净的状态
    clearRoute()
    setCurrentTravelMode(travelMode)

    // 获取当前位置作为起点
    let startPoint
    try {
      const currentPosition = await getCurrentPosition()
      startPoint = {
        location: currentPosition,
        name: '当前位置',
      }
    } catch (err) {
      console.error('获取当前位置失败', err)
      alert('无法获取当前位置')
      return
    }

    if (!startPoint?.location) {
      alert('无法获取起点位置')
      return
    }

    // 根据交通方式选择相应的插件
    const pluginMap = {
      driving: 'AMap.Driving',
      walking: 'AMap.Walking',
      riding: 'AMap.Riding',
      transit: 'AMap.Transfer',
    }

    const modeLabelMap = {
      driving: '驾车',
      walking: '步行',
      riding: '骑行',
      transit: '地铁',
    }

    const plugin = pluginMap[travelMode]
    const modeLabel = modeLabelMap[travelMode]
    if (!plugin) {
      console.error('不支持的交通方式:', travelMode)
      return
    }

    // 加载路线规划插件
    AMapLoader.load({
      key: KEY,
      version: '2.0',
      plugins: [plugin, 'AMap.Geocoder'],
    })
      .then((AMap) => {
        if (!mapRef.current) return

        let route

        // 公交规划需要获取城市
        const handleTransitSearch = () => {
          const geocoder = new AMap.Geocoder()
          geocoder.getAddress(searchEndPoint.location, (status, result) => {
            if (status === 'complete' && result?.regeocode?.addressComponent?.city) {
              const city = result.regeocode.addressComponent.city
              route = new AMap.Transfer({
                map: mapRef.current,
                city: city,
              })
              route.search(startPoint.location, searchEndPoint.location, (status, result) => {
                if (status === 'complete') {
                  console.log(`=== ${modeLabel}路线规划成功 ===`)
                  console.log('起点:', startPoint)
                  console.log('终点:', searchEndPoint)
                  console.log('方案数:', result.plans?.length)
                  if (result.plans?.length > 0) {
                    const firstPlan = result.plans[0]
                    console.log('首选方案:')
                    console.log('  总距离:', firstPlan.distance, '米')
                    console.log('  总时间:', firstPlan.time, '秒')
                    console.log('  票价:', firstPlan.cost, '元')
                    console.log('  换乘次数:', firstPlan.transfers)
                  }
                  console.log('完整结果:', result)
                  console.log('========================')
                } else {
                  console.error(`${modeLabel}路线规划失败`, result)
                }
              })
            } else {
              console.error('获取城市信息失败', result)
            }
          })
        }

        switch (travelMode) {
          case 'driving':
            route = new AMap.Driving({
              map: mapRef.current,
              panel: null,
            })
            route.search(startPoint.location, searchEndPoint.location, (status, result) => {
              if (status === 'complete') {
                console.log(`=== ${modeLabel}路线规划成功 ===`)
                console.log('起点:', startPoint)
                console.log('终点:', searchEndPoint)
                console.log('总距离:', result.routes?.[0]?.distance, '米')
                console.log('总时间:', result.routes?.[0]?.time, '秒')
                console.log('完整结果:', result)
                console.log('========================')
              } else {
                console.error(`${modeLabel}路线规划失败`, result)
              }
            })
            break
          case 'walking':
            route = new AMap.Walking({
              map: mapRef.current,
            })
            route.search(startPoint.location, searchEndPoint.location, (status, result) => {
              if (status === 'complete') {
                console.log(`=== ${modeLabel}路线规划成功 ===`)
                console.log('起点:', startPoint)
                console.log('终点:', searchEndPoint)
                console.log('总距离:', result.routes?.[0]?.distance, '米')
                console.log('总时间:', result.routes?.[0]?.time, '秒')
                console.log('完整结果:', result)
                console.log('========================')
              } else {
                console.error(`${modeLabel}路线规划失败`, result)
              }
            })
            break
          case 'riding':
            route = new AMap.Riding({
              map: mapRef.current,
            })
            route.search(startPoint.location, searchEndPoint.location, (status, result) => {
              if (status === 'complete') {
                console.log(`=== ${modeLabel}路线规划成功 ===`)
                console.log('起点:', startPoint)
                console.log('终点:', searchEndPoint)
                console.log('总距离:', result.routes?.[0]?.distance, '米')
                console.log('总时间:', result.routes?.[0]?.time, '秒')
                console.log('完整结果:', result)
                console.log('========================')
              } else {
                console.error(`${modeLabel}路线规划失败`, result)
              }
            })
            break
          case 'transit':
            handleTransitSearch()
            return // 提前返回，因为 handleTransitSearch 会设置 route
        }

        routeRef.current = route

        // 注意：高德地图路线规划插件会自动添加起点和终点标记，无需手动添加
      })
      .catch((err) => {
        console.error('路线插件加载失败', err)
      })
  }

  // 获取当前位置
  const getCurrentPosition = () => {
    return new Promise((resolve, reject) => {
      if (!window.AMap) {
        reject(new Error('AMap 未加载'))
        return
      }

      window.AMap.plugin('AMap.Geolocation', () => {
        const geolocation = new window.AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
        })
        geolocation.getCurrentPosition((status, result) => {
          if (status === 'complete' && result?.position) {
            resolve(result.position)
          } else {
            reject(new Error('定位失败'))
          }
        })
      })
    })
  }

  useEffect(() => {
    if (!KEY) return

    if (SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: SECURITY_CODE }
    }

    let cancelled = false

    AMapLoader.load({
      key: KEY,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.Geolocation'],
    })
      .then((AMap) => {
        if (cancelled || !containerRef.current) return

        mapRef.current = new AMap.Map(containerRef.current, {
          zoom,
          center,
          viewMode: '2D',
        })
        mapRef.current.addControl(new AMap.Scale())

        // 添加点击地图事件
        mapRef.current.on('click', handleMapClick)

        AMap.plugin('AMap.Geolocation', () => {
          if (cancelled || !mapRef.current) return
          const geolocation = new AMap.Geolocation({
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
            convert: true,
            showButton: showLocateButton,
            buttonPosition: 'RB',
            buttonOffset: new AMap.Pixel(10, 20),
            showMarker: true,
            showCircle: true,
            panToLocation: true,
            zoomToAccuracy: true,
          })
          mapRef.current.addControl(geolocation)

          if (autoLocate) {
            geolocation.getCurrentPosition((status, result) => {
              if (cancelled || !mapRef.current) return
              if (status === 'complete' && result?.position) {
                mapRef.current.setCenter(result.position)
              } else {
                console.warn('定位未完成或失败', status, result)
              }
            })
          }
        })
      })
      .catch((err) => {
        console.error('高德地图加载失败', err)
      })

    return () => {
      cancelled = true
      if (mapRef.current) {
        // 移除搜索标记
        if (searchMarkerRef.current) {
          mapRef.current.remove(searchMarkerRef.current)
          searchMarkerRef.current = null
        }
        // 清除路线
        clearRoute()
        mapRef.current.destroy()
        mapRef.current = null
      }
    }
  }, [zoom, center[0], center[1], showLocateButton, autoLocate])

  if (!KEY) {
    return (
      <div className={`amap-map amap-map--placeholder ${className ?? ''}`}>
        <p>
          请在项目根目录创建 <code>.env</code>，并设置{' '}
          <code>VITE_AMAP_KEY</code>（在{' '}
          <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noreferrer">
            高德开放平台
          </a>{' '}
          申请 Web 端 Key）。
        </p>
        <p>
          若控制台提示需要安全密钥，可同时配置 <code>VITE_AMAP_SECURITY_CODE</code>。
        </p>
      </div>
    )
  }

  return (
    <div className={`amap-map-container ${className ?? ''}`} role="application" aria-label="地图">
      <SearchBox onSearchComplete={handleSearchComplete} onTravelModeChange={handleTravelModeChange} onValueUpdate={setSearchBoxValue} showTravelMode={showTravelMode} selectedTravelMode={selectedTravelMode} onTravelModeSelect={setSelectedTravelMode} />
      <div ref={containerRef} className="amap-map" />
    </div>
  )
}

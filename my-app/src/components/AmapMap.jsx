import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import { SearchBox } from './SearchBox'

/**
 * 高德地图接入（基础）：底图 + 比例尺 + 定位控件。
 * 地图为命令式 API，用 ref 挂 DOM，在 useEffect 里创建/销毁实例。
 */


/**
 * 1.渲染地图
 * 2.点击地图触发回调函数 handleMapClick
 * 3.点击搜索框触发回调函数 handleSearchComplete
 * 4.点击交通方式选择触发回调函数 handleTravelModeChange
 * 5.点击位置信息触发回调函数 displayLocation
 * 6.点击当前位置触发回调函数 centerOnLocation
 * 7.点击收藏地点触发回调函数 showLocation
 * 8.点击手动选择触发回调函数 handleMapClick
 * 9.点击路线规划触发回调函数 handleTravelModeChange
 * 10.点击路线规划触发回调函数 handleTravelModeChange
 * 
 * 点击地图任意位置
 * 搜索框
 */

const KEY = import.meta.env.VITE_AMAP_KEY
const SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE

/** 默认中心 [lng, lat]，GCJ-02 */
const DEFAULT_CENTER = [116.397428, 39.90923]

const normalizeLocation = (location) => {
  if (!location) return null

  if (Array.isArray(location) && location.length >= 2) {
    return {
      lng: Number(location[0]),
      lat: Number(location[1])
    }
  }

  if (typeof location.getLng === 'function' && typeof location.getLat === 'function') {
    return {
      lng: Number(location.getLng()),
      lat: Number(location.getLat())
    }
  }

  if ('lng' in location && 'lat' in location) {
    return {
      lng: Number(location.lng),
      lat: Number(location.lat)
    }
  }

  return null
}

const toAMapPosition = (location) => {
  const normalizedLocation = normalizeLocation(location)
  return normalizedLocation ? [normalizedLocation.lng, normalizedLocation.lat] : null
}

/** 驾车/步行/骑行 route.search 需要 AMap.LngLat；直接传 { lng, lat } 会得到 NO_PARAMS */
const toAMapLngLat = (AMap, location) => {
  const normalized = normalizeLocation(location)
  if (!normalized || !AMap?.LngLat) return null
  return new AMap.LngLat(normalized.lng, normalized.lat)
}

export const AmapMap = forwardRef(function AmapMap({
  zoom = 11,
  center = DEFAULT_CENTER,
  className,
  showLocateButton = true,
  autoLocate = true,
  onLocationSelect,
}, ref) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const searchMarkerRef = useRef(null)
  const routeRef = useRef(null)

  const [searchEndPoint, setSearchEndPoint] = useState(null)
  const [showTravelMode, setShowTravelMode] = useState(false)
  const [selectedTravelMode, setSelectedTravelMode] = useState('')

  const clearRoute = useCallback(() => {
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

    if (routeRef.current) {
      try {
        routeRef.current.clear()
      } catch (e) {
        console.error('清除路线失败:', e)
      }
      routeRef.current = null
    }
  }, [])

  const centerOnLocation = useCallback((location) => {
    const position = toAMapPosition(location)

    if (mapRef.current && position) {
      mapRef.current.setCenter(position)
      mapRef.current.setZoom(16)
    }
  }, [])

  const displayLocation = useCallback((poi) => {
    const normalizedLocation = normalizeLocation(poi?.location)
    const position = toAMapPosition(poi?.location)

    if (!mapRef.current || !normalizedLocation || !position || !window.AMap) return
    // 清除路线
    clearRoute()
    // 设置终点
    setSearchEndPoint({
      ...poi,
      location: normalizedLocation
    })
    // 显示交通方式选择
    setShowTravelMode(true)
    // 清空交通方式选择
    setSelectedTravelMode('')

    searchMarkerRef.current = new window.AMap.Marker({
      position,
      title: poi.name,
      animation: 'AMAP_ANIMATION_DROP',
      map: mapRef.current,
      label: {
        content: poi.name,
        direction: 'top',
      }
    })

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

    searchMarkerRef.current.on('click', () => {
      infoWindow.open(mapRef.current, position)
    })

    centerOnLocation(normalizedLocation)

    if (window.updateSearchBoxInputFromMap) {
      window.updateSearchBoxInputFromMap(poi.name)
    }
  }, [centerOnLocation, clearRoute])

  const showLocation = useCallback((locationData) => {
    const normalizedLocation = normalizeLocation(locationData?.location)
    if (!normalizedLocation) return

    displayLocation({
      name: locationData.name || locationData.address || '收藏地点',
      address: locationData.address || '地址未知',
      location: normalizedLocation,
      type: locationData.type || '收藏地点'
    })
  }, [displayLocation])

  useImperativeHandle(ref, () => ({
    centerOnLocation,
    showLocation
  }), [centerOnLocation, showLocation])

  const handleMapClick = useCallback((e) => {
    // 经纬度坐标
    const clickPosition = e.lnglat
    if (!clickPosition || !window.AMap) return
    // 插件 逆地理编码 将经纬度坐标转换为地址信息
    window.AMap.plugin('AMap.Geocoder', () => {
      const geocoder = new window.AMap.Geocoder({
        radius: 100,
        extensions: 'all'
      })

      geocoder.getAddress(clickPosition, (status, result) => {
        if (status === 'complete' && result?.regeocode) {
          const addressInfo = result.regeocode
          const locationData = {
            name: addressInfo.formattedAddress || '点击位置',
            address: addressInfo.formattedAddress,
            location: normalizeLocation(clickPosition)
          }
          // 父组件回调函数 设置终点
          onLocationSelect?.(locationData)
          // 显示位置信息
          displayLocation({
            ...locationData,
            type: '手动选择'
          })
        } else {
          console.error('逆地理编码失败', result)
        }
      })
    })
  }, [displayLocation, onLocationSelect])

  const handleSearchComplete = useCallback((poi) => {
    const normalizedLocation = normalizeLocation(poi?.location)
    if (!normalizedLocation) return

    onLocationSelect?.({
      name: poi.name,
      address: poi.address,
      location: normalizedLocation
    })

    displayLocation({
      ...poi,
      location: normalizedLocation
    })
  }, [displayLocation, onLocationSelect])

  const handleTravelModeChange = async (travelMode) => {
    console.log('=== handleTravelModeChange 被调用 ===')
    console.log('交通方式:', travelMode)
    console.log('searchEndPoint:', searchEndPoint)

    if (!mapRef.current || !searchEndPoint?.location) {
      console.log('检查失败: mapRef.current 或 searchEndPoint.location 不存在')
      return
    }

    clearRoute()

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

    AMapLoader.load({
      key: KEY,
      version: '2.0',
      plugins: [plugin, 'AMap.Geocoder'],
    })
      .then((AMap) => {
        if (!mapRef.current) return

        const startLngLat = toAMapLngLat(AMap, startPoint.location)
        const endLngLat = toAMapLngLat(AMap, searchEndPoint.location)
        if (!startLngLat || !endLngLat) {
          console.error('路线规划：起点或终点坐标无效', { startPoint, searchEndPoint })
          return
        }

        let route

        const handleTransitSearch = () => {
          const geocoder = new AMap.Geocoder()
          geocoder.getAddress(endLngLat, (status, result) => {
            if (status === 'complete' && result?.regeocode?.addressComponent?.city) {
              const city = result.regeocode.addressComponent.city
              route = new AMap.Transfer({
                map: mapRef.current,
                city,
              })
              routeRef.current = route
              route.search(startLngLat, endLngLat, (transitStatus, transitResult) => {
                if (transitStatus === 'complete') {
                  console.log(`=== ${modeLabel}路线规划成功 ===`)
                  console.log('起点:', startPoint)
                  console.log('终点:', searchEndPoint)
                  console.log('方案数:', transitResult.plans?.length)
                  if (transitResult.plans?.length > 0) {
                    const firstPlan = transitResult.plans[0]
                    console.log('首选方案:')
                    console.log('  总距离:', firstPlan.distance, '米')
                    console.log('  总时间:', firstPlan.time, '秒')
                    console.log('  票价:', firstPlan.cost, '元')
                    console.log('  换乘次数:', firstPlan.transfers)
                  }
                  console.log('完整结果:', transitResult)
                  console.log('========================')
                } else {
                  console.error(`${modeLabel}路线规划失败`, transitResult)
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
            route.search(startLngLat, endLngLat, (status, result) => {
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
            route.search(startLngLat, endLngLat, (status, result) => {
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
            route.search(startLngLat, endLngLat, (status, result) => {
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
            return
        }

        routeRef.current = route
      })
      .catch((err) => {
        console.error('路线插件加载失败', err)
      })
  }

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
        // 点击地图触发回调函数handleMapClick
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
        mapRef.current.off('click', handleMapClick)
        clearRoute()
        mapRef.current.destroy()
        mapRef.current = null
      }
    }
  }, [autoLocate, center, clearRoute, handleMapClick, showLocateButton, zoom])

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
      <SearchBox
        onSearchComplete={handleSearchComplete}
        onTravelModeChange={handleTravelModeChange}
        showTravelMode={showTravelMode}
        selectedTravelMode={selectedTravelMode}
        onTravelModeSelect={setSelectedTravelMode}
      />
      <div ref={containerRef} className="amap-map" />
    </div>
  )
})

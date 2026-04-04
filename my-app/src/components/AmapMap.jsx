import { useEffect, useRef } from 'react'
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

  // 搜索和定位相关的状态
  const searchMarkerRef = useRef(null)

  // 处理搜索完成回调：添加标记并移动地图
  const handleSearchComplete = (poi) => {
    if (!mapRef.current || !poi) return

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
      <SearchBox onSearchComplete={handleSearchComplete} />
      <div ref={containerRef} className="amap-map" />
    </div>
  )
}

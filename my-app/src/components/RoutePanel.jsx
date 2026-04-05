import { useState, useRef, useEffect } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'
import './RoutePanel.css'

const KEY = import.meta.env.VITE_AMAP_KEY
const SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE

const TRAVEL_MODES = [
  { key: 'driving', label: '驾车', icon: '🚗' },
  { key: 'walking', label: '步行', icon: '🚶' },
  { key: 'transit', label: '公交', icon: '🚌' },
]

/**
 * 路线规划面板
 * - 支持交通方式切换（驾车/步行/公交）
 * - 起点支持手动输入（AutoComplete）、定位、地图选点
 * - 可折叠/关闭
 */
export function RoutePanel({ endPoint, onRouteStart, onClose }) {
  const [travelMode, setTravelMode] = useState('driving')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [startPoint, setStartPoint] = useState(null)
  const [startInput, setStartInput] = useState('')
  const [useCurrentLocation, setUseCurrentLocation] = useState(true)
  const [loading, setLoading] = useState(false)

  const startInputRef = useRef(null)
  const autoCompleteRef = useRef(null)

  // 加载 AutoComplete
  useEffect(() => {
    if (!KEY || !startInputRef.current) return

    if (SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: SECURITY_CODE }
    }

    let cancelled = false
    let placeSearch = null

    AMapLoader.load({
      key: KEY,
      version: '2.0',
      plugins: ['AMap.AutoComplete', 'AMap.PlaceSearch'],
    })
      .then((AMap) => {
        if (cancelled || !startInputRef.current) return

        placeSearch = new AMap.PlaceSearch({ city: '全国', pageSize: 1 })

        autoCompleteRef.current = new AMap.AutoComplete({
          input: startInputRef.current,
          city: '全国',
        })

        autoCompleteRef.current.on('select', (e) => {
          const poi = e.poi
          setStartInput(poi.name)
          setUseCurrentLocation(false)

          if (!poi.location) {
            placeSearch.search(poi.name, (status, result) => {
              if (status === 'complete' && result?.poiList?.pois?.length > 0) {
                setStartPoint({
                  ...poi,
                  location: result.poiList.pois[0].location,
                  address: result.poiList.pois[0].address,
                })
              }
            })
          } else {
            setStartPoint(poi)
          }
        })
      })
      .catch((err) => {
        console.error('起点 AutoComplete 加载失败', err)
      })

    return () => {
      cancelled = true
      autoCompleteRef.current = null
      placeSearch = null
    }
  }, [])

  // 设置起点为地图选点
  const handleMapClick = (location) => {
    setStartPoint({ location, name: '地图选点' })
    setStartInput('地图选点')
    setUseCurrentLocation(false)
  }

  // 暴露给父组件的地图点击处理
  useEffect(() => {
    window.handleRoutePanelMapClick = handleMapClick
    return () => {
      window.handleRoutePanelMapClick = null
    }
  }, [])

  // 获取当前位置
  const handleGetCurrentLocation = () => {
    setLoading(true)
    if (!window.AMap) {
      setLoading(false)
      return
    }

    window.AMap.plugin('AMap.Geolocation', () => {
      const geolocation = new window.AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 10000,
      })
      geolocation.getCurrentPosition((status, result) => {
        setLoading(false)
        if (status === 'complete' && result?.position) {
          setStartPoint({
            location: result.position,
            name: '当前位置',
            address: result.formattedAddress,
          })
          setStartInput('当前位置')
          setUseCurrentLocation(true)
        } else {
          console.warn('定位失败', status, result)
        }
      })
    })
  }

  // 开始规划路线
  const handleStartRoute = () => {
    if (!endPoint?.location) {
      alert('请先选择终点')
      return
    }

    const start = useCurrentLocation ? null : startPoint
    onRouteStart({
      start,
      end: endPoint,
      travelMode,
    })
  }

  if (isCollapsed) {
    return (
      <div className="route-panel route-panel--collapsed">
        <button
          className="route-panel__expand"
          onClick={() => setIsCollapsed(false)}
        >
          路线规划
        </button>
      </div>
    )
  }

  return (
    <div className="route-panel">
      <div className="route-panel__header">
        <h3 className="route-panel__title">路线规划</h3>
        <div className="route-panel__actions">
          <button
            className="route-panel__collapse"
            onClick={() => setIsCollapsed(true)}
            aria-label="折叠"
          >
            −
          </button>
          <button
            className="route-panel__close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      </div>

      <div className="route-panel__modes">
        {TRAVEL_MODES.map((mode) => (
          <button
            key={mode.key}
            className={`route-panel__mode ${
              travelMode === mode.key ? 'route-panel__mode--active' : ''
            }`}
            onClick={() => setTravelMode(mode.key)}
          >
            <span className="route-panel__mode-icon">{mode.icon}</span>
            {mode.label}
          </button>
        ))}
      </div>

      <div className="route-panel__points">
        <div className="route-panel__point route-panel__point--start">
          <label className="route-panel__label">起点</label>
          <div className="route-panel__input-wrapper">
            <input
              ref={startInputRef}
              className="route-panel__input"
              placeholder="输入起点或使用定位"
              value={startInput}
              onChange={(e) => {
                setStartInput(e.target.value)
                setUseCurrentLocation(false)
              }}
            />
            <button
              className={`route-panel__locate ${
                useCurrentLocation ? 'route-panel__locate--active' : ''
              }`}
              onClick={handleGetCurrentLocation}
              disabled={loading}
              title="获取当前位置"
            >
              📍
            </button>
          </div>
        </div>

        <div className="route-panel__divider">↓</div>

        <div className="route-panel__point route-panel__point--end">
          <label className="route-panel__label">终点</label>
          <div className="route-panel__end-point">
            <span className="route-panel__end-name">{endPoint?.name || '请先搜索终点'}</span>
            {endPoint?.address && (
              <span className="route-panel__end-address">{endPoint.address}</span>
            )}
          </div>
        </div>
      </div>

      <button
        className="route-panel__start"
        onClick={handleStartRoute}
        disabled={!endPoint?.location}
      >
        开始规划
      </button>

      <div className="route-panel__tip">
        提示：点击地图可选择起点位置
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'

/**
 * 搜索框组件：集成高德地图 AutoComplete 功能
 * 支持搜索后选择交通方式规划路线
 */

const KEY = import.meta.env.VITE_AMAP_KEY
const SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE

const TRAVEL_MODES = [
  { key: 'driving', label: '驾车' },
  { key: 'walking', label: '步行' },
  { key: 'riding', label: '骑行' },
  { key: 'transit', label: '地铁' },
]

export function SearchBox({ onSearchComplete, onTravelModeChange, onValueUpdate, showTravelMode: externalShowTravelMode, selectedTravelMode: externalSelectedTravelMode, onTravelModeSelect }) {
  const inputRef = useRef(null)
  const autoCompleteRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [showTravelMode, setShowTravelMode] = useState(false)
  const [selectedMode, setSelectedMode] = useState('')

  // 使用外部控制的状态
  const effectiveShowTravelMode = externalShowTravelMode !== undefined ? externalShowTravelMode : showTravelMode
  const effectiveSelectedMode = externalSelectedTravelMode !== undefined ? externalSelectedTravelMode : selectedMode

  useEffect(() => {
    if (!KEY || !inputRef.current) return

    if (SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: SECURITY_CODE }
    }

    let cancelled = false
    let placeSearch = null

    // 加载 AMap API 和相关插件
    AMapLoader.load({
      key: KEY,
      version: '2.0',
      plugins: ['AMap.AutoComplete', 'AMap.PlaceSearch'],
    })
      .then((AMap) => {
        if (cancelled || !inputRef.current) return

        // 初始化 PlaceSearch，用于获取地点详情和坐标
        placeSearch = new AMap.PlaceSearch({
          city: '全国',
          pageSize: 1,
        })

        // 添加一个标志，用于区分是否是点击地图触发的更新
        let isMapClickUpdate = false

        autoCompleteRef.current = new AMap.AutoComplete({
          input: inputRef.current,
          city: '全国',
        })

        // 监听选择事件
        autoCompleteRef.current.on('select', (e) => {
          const poi = e.poi

          console.log('=== 搜索选择 ===')
          console.log('完整事件对象 e:', e)
          console.log('e.poi:', poi)
          console.log('e.poi.location:', poi?.location)

          // 如果 AutoComplete 没有返回坐标，用 PlaceSearch 搜索
          if (!poi.location) {
            console.log('AutoComplete 没有返回坐标，使用 PlaceSearch 搜索')
            placeSearch.search(poi.name, (status, result) => {
              if (status === 'complete' && result?.poiList?.pois?.length > 0) {
                const firstPoi = result.poiList.pois[0]
                console.log('PlaceSearch 搜索结果:', firstPoi)
                // 合并 AutoComplete 的信息和 PlaceSearch 的坐标，然后调用 handleSearchComplete
                const finalPoi = {
                  ...poi,
                  location: firstPoi.location,
                  address: firstPoi.address,
                  type: firstPoi.type,
                }
                handleSearchComplete(finalPoi)
                // 更新输入框值
                if (onValueUpdate) {
                  onValueUpdate(finalPoi.name)
                }
              } else {
                console.warn('PlaceSearch 搜索失败:', status, result)
              }
            })
          } else {
            // 有坐标，直接调用 handleSearchComplete
            handleSearchComplete(poi)
            // 更新输入框值
            if (onValueUpdate) {
              onValueUpdate(poi.name)
            }
          }
          console.log('================')
        })

        setReady(true)
      })
      .catch((err) => {
        console.error('AutoComplete 加载失败', err)
      })

    return () => {
      cancelled = true
      autoCompleteRef.current = null
      placeSearch = null
    }
  }, [onSearchComplete])

  const handleSearchComplete = (poi) => {
    setShowTravelMode(true)
    setSelectedMode('')
    onSearchComplete(poi)
  }

  // 更新搜索框的值
  const updateInputValue = (value, isFromMap = false) => {
    if (inputRef.current) {
      inputRef.current.value = value
      // 如果是来自地图点击，延迟触发input事件，避免立即触发搜索
      if (isFromMap) {
        setTimeout(() => {
          if (inputRef.current) {
            const event = new Event('input', { bubbles: true })
            inputRef.current.dispatchEvent(event)
          }
        }, 300) // 延迟300ms，给用户时间观察
      } else {
        // 正常更新立即触发
        const event = new Event('input', { bubbles: true })
        inputRef.current.dispatchEvent(event)
      }
    }
  }

  // 监听全局更新事件
  useEffect(() => {
    const handleUpdate = (value) => {
      updateInputValue(value)
    }

    window.updateSearchBoxInput = handleUpdate
    return () => {
      delete window.updateSearchBoxInput
    }
  }, [])

  // 新增：专门用于地图点击的更新方法
  const updateInputValueFromMap = (value) => {
    // 直接设置值，不触发 input 事件，避免弹出建议列表
    if (inputRef.current) {
      inputRef.current.value = value
    }
  }

  // 暴露地图更新方法到全局
  useEffect(() => {
    window.updateSearchBoxInputFromMap = updateInputValueFromMap
    return () => {
      delete window.updateSearchBoxInputFromMap
    }
  }, [])

  const handleTravelModeChange = (e) => {
    const mode = e.target.value
    console.log('=== SearchBox handleTravelModeChange ===')
    console.log('选择的值:', mode)

    // 更新外部状态
    if (onTravelModeSelect) {
      onTravelModeSelect(mode)
    } else {
      setSelectedMode(mode)
    }
    if (onTravelModeChange && mode) {
      console.log('调用 onTravelModeChange:', mode)
      onTravelModeChange(mode)
    } else {
      console.log('onTravelModeChange 条件不满足')
    }
  }

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="text"
        placeholder={ready ? '搜索地点...' : '加载中...'}
        className="search-input"
        disabled={!ready}
      />
      {effectiveShowTravelMode && (
        <select
          className="travel-mode-select"
          value={effectiveSelectedMode}
          onChange={handleTravelModeChange}
        >
          <option value="" disabled className="placeholder-option">路线</option>
          {TRAVEL_MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

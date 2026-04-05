import { useCallback, useEffect, useRef, useState } from 'react'
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

export function SearchBox({ onSearchComplete, onTravelModeChange, showTravelMode: externalShowTravelMode, selectedTravelMode: externalSelectedTravelMode, onTravelModeSelect }) {
  const inputRef = useRef(null)
  const autoCompleteRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [showTravelMode, setShowTravelMode] = useState(false)
  const [selectedMode, setSelectedMode] = useState('')

  const effectiveShowTravelMode = externalShowTravelMode !== undefined ? externalShowTravelMode : showTravelMode
  const effectiveSelectedMode = externalSelectedTravelMode !== undefined ? externalSelectedTravelMode : selectedMode

  const handleSearchComplete = useCallback((poi) => {
    setShowTravelMode(true)
    setSelectedMode('')
    onSearchComplete(poi)
  }, [onSearchComplete])

  const updateInputValue = useCallback((value, isFromMap = false) => {
    if (inputRef.current) {
      inputRef.current.value = value
      if (isFromMap) {
        setTimeout(() => {
          if (inputRef.current) {
            const event = new Event('input', { bubbles: true })
            inputRef.current.dispatchEvent(event)
          }
        }, 300)
      } else {
        const event = new Event('input', { bubbles: true })
        inputRef.current.dispatchEvent(event)
      }
    }
  }, [])

  const updateInputValueFromMap = useCallback((value) => {
    if (inputRef.current) {
      inputRef.current.value = value
    }
  }, [])

  useEffect(() => {
    if (!KEY || !inputRef.current) return

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
        if (cancelled || !inputRef.current) return

        placeSearch = new AMap.PlaceSearch({
          city: '全国',
          pageSize: 1,
        })

        autoCompleteRef.current = new AMap.AutoComplete({
          input: inputRef.current,
          city: '全国',
        })

        autoCompleteRef.current.on('select', (e) => {
          const poi = e.poi

          console.log('=== 搜索选择 ===')
          console.log('完整事件对象 e:', e)
          console.log('e.poi:', poi)
          console.log('e.poi.location:', poi?.location)

          if (!poi.location) {
            console.log('AutoComplete 没有返回坐标，使用 PlaceSearch 搜索')
            placeSearch.search(poi.name, (status, result) => {
              if (status === 'complete' && result?.poiList?.pois?.length > 0) {
                const firstPoi = result.poiList.pois[0]
                console.log('PlaceSearch 搜索结果:', firstPoi)
                handleSearchComplete({
                  ...poi,
                  location: firstPoi.location,
                  address: firstPoi.address,
                  type: firstPoi.type,
                })
              } else {
                console.warn('PlaceSearch 搜索失败:', status, result)
              }
            })
          } else {
            handleSearchComplete(poi)
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
  }, [handleSearchComplete])

  useEffect(() => {
    const handleUpdate = (value) => {
      updateInputValue(value)
    }

    window.updateSearchBoxInput = handleUpdate
    return () => {
      delete window.updateSearchBoxInput
    }
  }, [updateInputValue])

  useEffect(() => {
    window.updateSearchBoxInputFromMap = updateInputValueFromMap
    return () => {
      delete window.updateSearchBoxInputFromMap
    }
  }, [updateInputValueFromMap])

  const handleTravelModeChange = (e) => {
    const mode = e.target.value
    console.log('=== SearchBox handleTravelModeChange ===')
    console.log('选择的值:', mode)

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

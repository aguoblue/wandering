import { useEffect, useRef, useState } from 'react'
import AMapLoader from '@amap/amap-jsapi-loader'

/**
 * 搜索框组件：集成高德地图 AutoComplete 功能
 */

const KEY = import.meta.env.VITE_AMAP_KEY
const SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE

export function SearchBox({ onSearchComplete }) {
  const inputRef = useRef(null)
  const autoCompleteRef = useRef(null)
  const [ready, setReady] = useState(false)

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
                // 合并 AutoComplete 的信息和 PlaceSearch 的坐标
                onSearchComplete({
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
            onSearchComplete(poi)
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

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="text"
        placeholder={ready ? '搜索地点...' : '加载中...'}
        className="search-input"
        disabled={!ready}
      />
    </div>
  )
}
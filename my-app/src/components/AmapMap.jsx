import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
const ORIGIN_NODE_ID = 'origin:current-location'

const MARKER_STYLE_MAP = {
  default: { opacity: 1, zIndex: 110 },
  connected: { opacity: 1, zIndex: 120 },
  active: { opacity: 1, zIndex: 140 },
  dimmed: { opacity: 0.28, zIndex: 80 },
}

const EDGE_STYLE_MAP = {
  default: { strokeColor: '#1e8de8', strokeWeight: 6, strokeOpacity: 0.82 },
  active: { strokeColor: '#ff6a00', strokeWeight: 8, strokeOpacity: 0.96 },
  dimmed: { strokeColor: '#8aa0b6', strokeWeight: 4, strokeOpacity: 0.2 },
}

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

const toPathPosition = (point) => {
  const normalized = normalizeLocation(point)
  return normalized ? [normalized.lng, normalized.lat] : null
}

const makeLocationNodeId = (location) => {
  const normalized = normalizeLocation(location)
  if (!normalized) return null
  return `destination:${normalized.lng.toFixed(6)},${normalized.lat.toFixed(6)}`
}

const renderMarkerContent = (state, kind = 'destination') => {
  const safeState = ['default', 'connected', 'active', 'dimmed'].includes(state) ? state : 'default'
  const safeKind = kind === 'origin' ? 'origin' : 'destination'
  return `<div class="map-node map-node--${safeKind} map-node--${safeState}"></div>`
}

const buildInfoWindowContent = (poi) => {
  return `
    <div style="padding: 10px; font-size: 14px;">
      <div style="font-weight: bold; margin-bottom: 5px;">${poi.name}</div>
      <div style="color: #666;">${poi.address || '地址未知'}</div>
      <div style="color: #999; font-size: 12px; margin-top: 5px;">
        类型: ${poi.type || '未知'}
      </div>
    </div>
  `
}

const extractRoutePath = (travelMode, result, startPosition, endPosition) => {
  const routes = result?.routes || []
  const firstRoute = routes[0]

  if (!firstRoute) {
    return [startPosition, endPosition]
  }

  const appendSegment = (target, segment = []) => {
    segment.forEach((point) => {
      const position = toPathPosition(point)
      if (position) {
        target.push(position)
      }
    })
  }

  const path = []

  if (travelMode === 'riding') {
    if (Array.isArray(firstRoute.rides)) {
      firstRoute.rides.forEach((ride) => appendSegment(path, ride?.path))
    }

    if (path.length === 0 && Array.isArray(firstRoute.steps)) {
      firstRoute.steps.forEach((step) => appendSegment(path, step?.path))
    }
  } else {
    if (Array.isArray(firstRoute.steps)) {
      firstRoute.steps.forEach((step) => appendSegment(path, step?.path))
    }
  }

  if (path.length === 0) {
    return [startPosition, endPosition]
  }

  const withEndpoints = [startPosition, ...path, endPosition].filter(Boolean)

  return withEndpoints.filter((position, index, arr) => {
    if (index === 0) return true
    const previous = arr[index - 1]
    return previous[0] !== position[0] || previous[1] !== position[1]
  })
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
  const nodesRef = useRef(new Map())
  const edgesRef = useRef(new Map())
  const routeServiceRef = useRef(null)
  const activeNodeIdRef = useRef(null)

  const [searchEndPoint, setSearchEndPoint] = useState(null)
  const [showTravelMode, setShowTravelMode] = useState(false)
  const [selectedTravelMode, setSelectedTravelMode] = useState('')

  const setMarkerVisualState = useCallback((node, state) => {
    if (!node?.marker) return
    const style = MARKER_STYLE_MAP[state] || MARKER_STYLE_MAP.default

    node.marker.setContent(renderMarkerContent(state, node.kind))
    node.marker.setOpacity(style.opacity)
    node.marker.setzIndex(style.zIndex)
    node.marker.setAnimation(state === 'active' ? 'AMAP_ANIMATION_BOUNCE' : null)
  }, [])

  const setEdgeVisualState = useCallback((edge, state) => {
    if (!edge?.polyline) return
    const style = EDGE_STYLE_MAP[state] || EDGE_STYLE_MAP.default

    edge.polyline.setOptions({
      strokeColor: style.strokeColor,
      strokeWeight: style.strokeWeight,
      strokeOpacity: style.strokeOpacity,
    })
  }, [])

  const collectConnectedNodeIds = useCallback((nodeId) => {
    const connectedNodeIds = new Set([nodeId])

    edgesRef.current.forEach((edge) => {
      if (edge.fromId === nodeId || edge.toId === nodeId) {
        connectedNodeIds.add(edge.fromId)
        connectedNodeIds.add(edge.toId)
      }
    })

    return connectedNodeIds
  }, [])

  const applyFocusStyles = useCallback((focusedNodeId) => {
    activeNodeIdRef.current = focusedNodeId || null

    if (!focusedNodeId) {
      nodesRef.current.forEach((node) => setMarkerVisualState(node, 'default'))
      edgesRef.current.forEach((edge) => setEdgeVisualState(edge, 'default'))
      return
    }

    const connectedNodeIds = collectConnectedNodeIds(focusedNodeId)

    nodesRef.current.forEach((node, nodeId) => {
      if (nodeId === focusedNodeId) {
        setMarkerVisualState(node, 'active')
      } else if (connectedNodeIds.has(nodeId)) {
        setMarkerVisualState(node, 'connected')
      } else {
        setMarkerVisualState(node, 'dimmed')
      }
    })

    edgesRef.current.forEach((edge) => {
      const isFocusedEdge = edge.fromId === focusedNodeId || edge.toId === focusedNodeId
      setEdgeVisualState(edge, isFocusedEdge ? 'active' : 'dimmed')
    })
  }, [collectConnectedNodeIds, setEdgeVisualState, setMarkerVisualState])

  const removeEdge = useCallback((edgeId) => {
    const edge = edgesRef.current.get(edgeId)
    if (!edge) return

    if (mapRef.current && edge.polyline) {
      mapRef.current.remove(edge.polyline)
    }

    edgesRef.current.delete(edgeId)
  }, [])

  const removeNode = useCallback((nodeId) => {
    const node = nodesRef.current.get(nodeId)
    if (!node) return

    if (node.clickHandler) {
      node.marker.off('click', node.clickHandler)
    }

    if (mapRef.current && node.marker) {
      mapRef.current.remove(node.marker)
    }

    nodesRef.current.delete(nodeId)
  }, [])

  const upsertNode = useCallback((nodePayload) => {
    if (!mapRef.current || !window.AMap) return null

    const normalizedLocation = normalizeLocation(nodePayload.location)
    if (!normalizedLocation) return null

    const position = [normalizedLocation.lng, normalizedLocation.lat]
    const nodeId = nodePayload.id

    if (!nodeId) return null

    const existedNode = nodesRef.current.get(nodeId)

    if (existedNode) {
      existedNode.location = normalizedLocation
      existedNode.name = nodePayload.name
      existedNode.address = nodePayload.address
      existedNode.type = nodePayload.type
      existedNode.kind = nodePayload.kind || 'destination'
      existedNode.marker.setPosition(position)
      existedNode.marker.setTitle(nodePayload.name)
      existedNode.marker.setLabel({
        content: nodePayload.name,
        direction: 'top',
      })
      if (existedNode.infoWindow) {
        existedNode.infoWindow.setContent(buildInfoWindowContent(nodePayload))
      }
      return existedNode
    }

    const marker = new window.AMap.Marker({
      position,
      title: nodePayload.name,
      map: mapRef.current,
      animation: 'AMAP_ANIMATION_DROP',
      content: renderMarkerContent('default', nodePayload.kind),
      offset: new window.AMap.Pixel(-10, -10),
      label: {
        content: nodePayload.name,
        direction: 'top',
      }
    })

    const infoWindow = new window.AMap.InfoWindow({
      content: buildInfoWindowContent(nodePayload),
      offset: new window.AMap.Pixel(0, -30),
      closeWhenClickMap: true,
    })

    const nextNode = {
      id: nodeId,
      location: normalizedLocation,
      marker,
      infoWindow,
      name: nodePayload.name,
      address: nodePayload.address,
      type: nodePayload.type,
      kind: nodePayload.kind || 'destination',
      clickHandler: null,
    }

    const clickHandler = () => {
      infoWindow.open(mapRef.current, position)
      applyFocusStyles(nodeId)
    }

    marker.on('click', clickHandler)
    nextNode.clickHandler = clickHandler

    nodesRef.current.set(nodeId, nextNode)
    return nextNode
  }, [applyFocusStyles])

  const addOrUpdateEdge = useCallback(({ edgeId, fromId, toId, path, travelMode }) => {
    if (!mapRef.current || !window.AMap || !edgeId || !fromId || !toId) return

    const existedEdge = edgesRef.current.get(edgeId)
    if (existedEdge) {
      existedEdge.path = path
      existedEdge.travelMode = travelMode
      existedEdge.polyline.setPath(path)
      return
    }

    const polyline = new window.AMap.Polyline({
      path,
      map: mapRef.current,
      strokeColor: EDGE_STYLE_MAP.default.strokeColor,
      strokeOpacity: EDGE_STYLE_MAP.default.strokeOpacity,
      strokeWeight: EDGE_STYLE_MAP.default.strokeWeight,
      lineJoin: 'round',
      lineCap: 'round',
      showDir: true,
      zIndex: 90,
    })

    polyline.on('click', () => {
      applyFocusStyles(toId)
    })

    edgesRef.current.set(edgeId, {
      id: edgeId,
      fromId,
      toId,
      path,
      travelMode,
      polyline,
    })
  }, [applyFocusStyles])

  const clearTransitRouteService = useCallback(() => {
    if (!routeServiceRef.current) return

    try {
      routeServiceRef.current.clear()
    } catch (e) {
      console.error('清除地铁路线失败:', e)
    }

    routeServiceRef.current = null
  }, [])

  const clearAllRoutes = useCallback(() => {
    clearTransitRouteService()

    const currentEdgeIds = Array.from(edgesRef.current.keys())
    currentEdgeIds.forEach((edgeId) => removeEdge(edgeId))

    removeNode(ORIGIN_NODE_ID)

    if (activeNodeIdRef.current === ORIGIN_NODE_ID) {
      applyFocusStyles(null)
    }
  }, [applyFocusStyles, clearTransitRouteService, removeEdge, removeNode])

  const clearAllMapOverlays = useCallback(() => {
    clearTransitRouteService()

    const edgeIds = Array.from(edgesRef.current.keys())
    edgeIds.forEach((edgeId) => removeEdge(edgeId))

    const nodeIds = Array.from(nodesRef.current.keys())
    nodeIds.forEach((nodeId) => removeNode(nodeId))

    applyFocusStyles(null)
    setSearchEndPoint(null)
    setShowTravelMode(false)
    setSelectedTravelMode('')
  }, [applyFocusStyles, clearTransitRouteService, removeEdge, removeNode])

  const centerOnLocation = useCallback((location) => {
    const position = toAMapPosition(location)

    if (mapRef.current && position) {
      mapRef.current.setCenter(position)
      mapRef.current.setZoom(16)
    }
  }, [])

  const displayLocation = useCallback((poi, options = {}) => {
    const { replaceExisting = false } = options
    const normalizedLocation = normalizeLocation(poi?.location)

    if (!mapRef.current || !normalizedLocation || !window.AMap) return

    if (replaceExisting) {
      clearAllMapOverlays()
    }

    const nodeId = makeLocationNodeId(normalizedLocation)
    if (!nodeId) return

    const locationPayload = {
      ...poi,
      location: normalizedLocation,
      id: nodeId,
      kind: 'destination',
      name: poi.name || poi.address || '选中地点',
      address: poi.address || '地址未知',
      type: poi.type || '未知',
    }

    upsertNode(locationPayload)

    setSearchEndPoint({
      ...locationPayload,
      nodeId,
    })

    setShowTravelMode(true)
    setSelectedTravelMode('')

    centerOnLocation(normalizedLocation)

    if (window.updateSearchBoxInputFromMap) {
      window.updateSearchBoxInputFromMap(locationPayload.name)
    }

    applyFocusStyles(nodeId)
  }, [applyFocusStyles, centerOnLocation, clearAllMapOverlays, upsertNode])

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
    const clickPosition = e.lnglat
    if (!clickPosition || !window.AMap) return

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

          onLocationSelect?.(locationData)

          displayLocation({
            ...locationData,
            type: '手动选择'
          }, { replaceExisting: true })
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

  const getCurrentPosition = useCallback(() => {
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
  }, [])

  const handleTravelModeChange = useCallback(async (travelMode) => {
    if (!mapRef.current || !searchEndPoint?.location || !searchEndPoint?.nodeId) {
      return
    }

    clearTransitRouteService()

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

    const plugin = pluginMap[travelMode]
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

        const startPosition = toAMapPosition(startPoint.location)
        const endPosition = toAMapPosition(searchEndPoint.location)
        if (!startPosition || !endPosition) return

        upsertNode({
          id: ORIGIN_NODE_ID,
          location: startPoint.location,
          name: '当前位置',
          address: '路线起点',
          type: '起点',
          kind: 'origin',
        })

        const edgeId = `${travelMode}:${ORIGIN_NODE_ID}->${searchEndPoint.nodeId}`
        const removableEdgeIds = []
        edgesRef.current.forEach((edge, candidateEdgeId) => {
          if (edge.toId === searchEndPoint.nodeId) {
            removableEdgeIds.push(candidateEdgeId)
          }
        })
        removableEdgeIds.forEach((candidateEdgeId) => removeEdge(candidateEdgeId))

        const drawRouteResult = (result) => {
          const path = extractRoutePath(travelMode, result, startPosition, endPosition)
          addOrUpdateEdge({
            edgeId,
            fromId: ORIGIN_NODE_ID,
            toId: searchEndPoint.nodeId,
            path,
            travelMode,
          })
          applyFocusStyles(searchEndPoint.nodeId)
        }

        if (travelMode === 'transit') {
          const geocoder = new AMap.Geocoder()
          geocoder.getAddress(endLngLat, (status, result) => {
            if (status !== 'complete' || !result?.regeocode?.addressComponent?.city) {
              console.error('获取城市信息失败', result)
              return
            }

            const city = result.regeocode.addressComponent.city
            const transfer = new AMap.Transfer({
              map: null,
              city,
            })
            routeServiceRef.current = transfer

            transfer.search(startLngLat, endLngLat, (transitStatus, transitResult) => {
              if (transitStatus === 'complete') {
                drawRouteResult(transitResult)
              } else {
                console.error('地铁路线规划失败', transitResult)
              }
            })
          })
          return
        }

        const routeBuilders = {
          driving: () => new AMap.Driving({ map: null, panel: null }),
          walking: () => new AMap.Walking({ map: null }),
          riding: () => new AMap.Riding({ map: null }),
        }

        const route = routeBuilders[travelMode]?.()
        if (!route) return

        route.search(startLngLat, endLngLat, (status, result) => {
          if (status === 'complete') {
            drawRouteResult(result)
          } else {
            console.error(`${travelMode}路线规划失败`, result)
          }
        })
      })
      .catch((err) => {
        console.error('路线插件加载失败', err)
      })
  }, [addOrUpdateEdge, applyFocusStyles, clearTransitRouteService, getCurrentPosition, removeEdge, searchEndPoint, upsertNode])

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

    const nodesStore = nodesRef.current

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.off('click', handleMapClick)
        clearAllRoutes()

        const nodeIds = Array.from(nodesStore.keys())
        nodeIds.forEach((nodeId) => removeNode(nodeId))

        mapRef.current.destroy()
        mapRef.current = null
      }
    }
  }, [autoLocate, center, clearAllRoutes, handleMapClick, removeNode, showLocateButton, zoom])

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

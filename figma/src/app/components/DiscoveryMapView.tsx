import { useCallback, useEffect, useRef, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { locateCenterByLocation, searchNearbyPois, type DiscoveryCenter, type NearbyPoi } from '../services/amapDiscoveryClient';
import { MapPin, Utensils, Mountain, X } from 'lucide-react';

interface DiscoveryMapViewProps {
  center: DiscoveryCenter | null;
  nearbyPois?: NearbyPoi[];
  selectedPoiIds?: string[];
  onNearbyPoisChange?: (pois: NearbyPoi[]) => void;
  onTogglePoiSelect?: (poi: NearbyPoi) => void;
  onLocate?: (center: DiscoveryCenter) => void;
  onLocateError?: (message: string) => void;
}

const asLocationTuple = (location: any): [number, number] | null => {
  if (!location) return null;

  if (Array.isArray(location) && location.length >= 2) {
    const lngFromArray = Number(location[0]);
    const latFromArray = Number(location[1]);
    if (Number.isFinite(lngFromArray) && Number.isFinite(latFromArray)) {
      return [lngFromArray, latFromArray];
    }
  }

  if (typeof location === 'string' && location.includes(',')) {
    const [lngText, latText] = location.split(',');
    const lngFromText = Number(lngText);
    const latFromText = Number(latText);
    if (Number.isFinite(lngFromText) && Number.isFinite(latFromText)) {
      return [lngFromText, latFromText];
    }
  }

  const lng = Number(location.lng ?? location.getLng?.());
  const lat = Number(location.lat ?? location.getLat?.());

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [lng, lat];
};

let amapPromise: Promise<any> | null = null;

const ensureAmap = async () => {
  if (!amapPromise) {
    const amapKey = import.meta.env.VITE_AMAP_KEY;
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;

    if (!amapKey) {
      throw new Error('缺少 VITE_AMAP_KEY，无法加载地图。');
    }

    if (securityCode) {
      (window as Window & { _AMapSecurityConfig?: { securityJsCode: string } })._AMapSecurityConfig = {
        securityJsCode: securityCode
      };
    }

    amapPromise = AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.Geolocation', 'AMap.Geocoder', 'AMap.PlaceSearch']
    });
  }

  return amapPromise;
};

export function DiscoveryMapView({
  center,
  nearbyPois = [],
  selectedPoiIds = [],
  onNearbyPoisChange,
  onTogglePoiSelect,
  onLocate,
  onLocateError
}: DiscoveryMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const amapRef = useRef<any>(null);
  const centerMarkerRef = useRef<any>(null);
  const poiMarkerRefs = useRef<Record<string, any>>({});
  const poiRenderTimersRef = useRef<number[]>([]);
  const nearbyPoisRef = useRef<NearbyPoi[]>(nearbyPois);
  const selectedPoiIdsRef = useRef<string[]>(selectedPoiIds);
  const onLocateRef = useRef(onLocate);
  const onLocateErrorRef = useRef(onLocateError);
  const onNearbyPoisChangeRef = useRef(onNearbyPoisChange);
  const onTogglePoiSelectRef = useRef(onTogglePoiSelect);
  const poiRequestIdRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [selectedPoi, setSelectedPoi] = useState<NearbyPoi | null>(null);

  onLocateRef.current = onLocate;
  onLocateErrorRef.current = onLocateError;
  onNearbyPoisChangeRef.current = onNearbyPoisChange;
  onTogglePoiSelectRef.current = onTogglePoiSelect;
  nearbyPoisRef.current = nearbyPois;
  selectedPoiIdsRef.current = selectedPoiIds;

  const getPoiMarkerContent = useCallback((poi: NearbyPoi, isSelected: boolean) => {
    const markerColor = poi.category === 'scenic' ? '#16a34a' : '#f97316';
    const markerText = poi.category === 'scenic' ? '景' : '食';
    const borderColor = isSelected ? '#2563eb' : '#ffffff';
    const markerScale = isSelected ? 1.16 : 1;
    const markerShadow = isSelected
      ? '0 0 0 6px rgba(37,99,235,.2), 0 6px 14px rgba(37,99,235,.35)'
      : '0 2px 10px rgba(0,0,0,.2)';

    return `<div style="width:24px;height:24px;border-radius:999px;background:${markerColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid ${borderColor};box-shadow:${markerShadow};transform:scale(${markerScale});transition:all .16s ease;">${markerText}</div>`;
  }, []);

  const clearPoiRenderTimers = useCallback(() => {
    poiRenderTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    poiRenderTimersRef.current = [];
  }, []);

  const renderSingleMarker = useCallback((AMap: any, map: any, location: [number, number], title: string) => {
    if (centerMarkerRef.current) {
      centerMarkerRef.current.setMap(null);
      centerMarkerRef.current = null;
    }

    centerMarkerRef.current = new AMap.Marker({
      map,
      position: location,
      anchor: 'bottom-center',
      title,
      zIndex: 520
    });
  }, []);

  const clearPoiMarkers = useCallback(() => {
    clearPoiRenderTimers();
    Object.values(poiMarkerRefs.current).forEach((marker) => {
      marker.setMap(null);
    });
    poiMarkerRefs.current = {};
  }, [clearPoiRenderTimers]);

  const renderPoiMarkersProgressive = useCallback((AMap: any, map: any, pois: NearbyPoi[]) => {
    clearPoiMarkers();

    const sortedPois = pois
      .slice()
      .sort((a, b) => {
        const distanceA = typeof a.distance === 'number' ? a.distance : Number.MAX_SAFE_INTEGER;
        const distanceB = typeof b.distance === 'number' ? b.distance : Number.MAX_SAFE_INTEGER;
        if (distanceA !== distanceB) return distanceA - distanceB;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });

    sortedPois.forEach((poi, index) => {
      const timer = window.setTimeout(() => {
        if (!mapRef.current || !amapRef.current) return;
        const isSelected = selectedPoiIdsRef.current.includes(poi.id);
        const marker = new AMap.Marker({
          map,
          position: poi.location,
          anchor: 'center',
          zIndex: 480,
          offset: new AMap.Pixel(0, 0),
          content: getPoiMarkerContent(poi, isSelected)
        });

        marker.on('click', () => {
          setSelectedPoi(poi);
          onTogglePoiSelectRef.current?.(poi);
        });

        poiMarkerRefs.current[poi.id] = marker;
      }, index * 70);

      poiRenderTimersRef.current.push(timer);
    });
  }, [clearPoiMarkers, getPoiMarkerContent]);

  const syncPoiMarkerSelectionStyles = useCallback((pois: NearbyPoi[], selectedIds: string[]) => {
    const selectedSet = new Set(selectedIds);
    pois.forEach((poi) => {
      const marker = poiMarkerRefs.current[poi.id];
      if (!marker) return;
      marker.setContent(getPoiMarkerContent(poi, selectedSet.has(poi.id)));
    });
  }, [getPoiMarkerContent]);

  // 仅挂载一次创建地图；勿依赖 center / 父组件传入的回调，否则会销毁地图并与 marker 竞态。
  // 回调通过 ref 读取最新值。
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let destroyed = false;

    ensureAmap()
      .then((AMap) => {
        if (destroyed || !containerRef.current) return;

        const defaultCenter: [number, number] = [116.397428, 39.90923];

        const map = new AMap.Map(containerRef.current, {
          center: defaultCenter,
          zoom: 12,
          resizeEnable: true,
          mapStyle: 'amap://styles/normal'
        });

        mapRef.current = map;
        amapRef.current = AMap;
        setMapReady(true);
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ position: 'RB' }));

        const geolocation = new AMap.Geolocation({
          showButton: true,
          buttonPosition: 'RB',
          buttonOffset: new AMap.Pixel(14, 78),
          showMarker: false,
          showCircle: false,
          enableHighAccuracy: true,
          timeout: 10000,
          panToLocation: true,
          zoomToAccuracy: false
        });

        map.addControl(geolocation);

        geolocation.on('complete', (result: any) => {
          const location = asLocationTuple(result.position);
          if (!location) return;

          const city = String(result.addressComponent?.city || result.addressComponent?.province || '当前位置');
          const district = String(result.addressComponent?.district || '');
          const name = district || city || '当前位置';
          const address = String(result.formattedAddress || `${city}${district}` || '当前位置附近');

          onLocateRef.current?.({
            name,
            address,
            location
          });
        });

        geolocation.on('error', (geolocationError: any) => {
          const message = geolocationError?.message || '定位失败，请检查权限设置';
          onLocateErrorRef.current?.(message);
        });

        map.on('click', async (event: any) => {
          const location = asLocationTuple(event.lnglat);
          if (!location) return;

          clearPoiMarkers();
          onNearbyPoisChangeRef.current?.([]);
          setSelectedPoi(null);
          renderSingleMarker(AMap, map, location, '选中位置');
          map.setCenter(location);
          map.setZoom(14);

          try {
            const resolvedCenter = await locateCenterByLocation(location);
            onLocateRef.current?.(resolvedCenter);
            onLocateErrorRef.current?.('');
          } catch {
            onLocateRef.current?.({
              name: '选中位置',
              address: `${location[0].toFixed(6)}, ${location[1].toFixed(6)}`,
              location
            });
            onLocateErrorRef.current?.('点击地图已定位，但地址解析失败');
          }
        });
      })
      .catch((loadError: Error) => {
        if (destroyed) return;
        setError(loadError.message || '地图加载失败');
      });

    return () => {
      destroyed = true;
      centerMarkerRef.current = null;
      clearPoiMarkers();
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [clearPoiMarkers, renderSingleMarker]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!mapReady || !map || !AMap || !center) return;

    renderSingleMarker(AMap, map, center.location, center.name || '当前位置');
    map.setCenter(center.location);
    map.setZoom(14);
  }, [center, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!mapReady || !map || !AMap || !center) return;

    // 切换主定位点时先清空旧周边 marker，避免“旧点残留后再闪退”。
    clearPoiMarkers();
    onNearbyPoisChangeRef.current?.([]);
    setSelectedPoi(null);

    const requestId = poiRequestIdRef.current + 1;
    poiRequestIdRef.current = requestId;
    setNearbyLoading(true);
    setNearbyError(null);

    searchNearbyPois(center.location, { radius: 1800, perCategoryLimit: 10 })
      .then((pois) => {
        if (poiRequestIdRef.current !== requestId) return;
        onNearbyPoisChangeRef.current?.(pois);
      })
      .catch(() => {
        if (poiRequestIdRef.current !== requestId) return;
        clearPoiMarkers();
        onNearbyPoisChangeRef.current?.([]);
        setNearbyError('周边 POI 加载失败');
      })
      .finally(() => {
        if (poiRequestIdRef.current !== requestId) return;
        setNearbyLoading(false);
      });
  }, [center, mapReady, clearPoiMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!mapReady || !map || !AMap) return;

    if (!nearbyPois.length) {
      clearPoiMarkers();
      return;
    }

    renderPoiMarkersProgressive(AMap, map, nearbyPois);
  }, [nearbyPois, mapReady, clearPoiMarkers, renderPoiMarkersProgressive]);

  useEffect(() => {
    if (!nearbyPois.length) return;
    syncPoiMarkerSelectionStyles(nearbyPois, selectedPoiIds);
  }, [nearbyPois, selectedPoiIds, syncPoiMarkerSelectionStyles]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative" aria-label="定位地图">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 rounded-md bg-white/95 backdrop-blur px-3 py-2 text-xs shadow border">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5 text-blue-600" />
            主定位点
          </span>
          <span className="inline-flex items-center gap-1">
            <Mountain className="size-3.5 text-green-600" />
            景点
          </span>
          <span className="inline-flex items-center gap-1">
            <Utensils className="size-3.5 text-orange-600" />
            美食
          </span>
        </div>
        {(nearbyLoading || nearbyError) && (
          <p className="mt-1 text-[11px] text-slate-500">
            {nearbyLoading ? '正在搜索周边景点和美食...' : nearbyError}
          </p>
        )}
      </div>

      {selectedPoi && (
        <div className="absolute left-3 right-3 bottom-3 md:right-auto md:w-[340px] rounded-xl border bg-white shadow-xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{selectedPoi.name}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedPoi.category === 'scenic' ? '景点' : '美食'}
                {selectedPoi.type ? ` · ${selectedPoi.type}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPoi(null)}
              className="inline-flex items-center justify-center size-6 rounded hover:bg-slate-100"
              aria-label="关闭 POI 详情"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="text-sm mt-3">{selectedPoi.address || '暂无详细地址'}</p>
          <div className="mt-3 text-xs text-muted-foreground space-y-1">
            {typeof selectedPoi.distance === 'number' && (
              <p>距离中心点约：{selectedPoi.distance} 米</p>
            )}
            {selectedPoi.tel && <p>电话：{selectedPoi.tel}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { Activity } from '../data/mockPlans';
import { AlertCircle, ArrowRight, Clock3, MapPin, Navigation, Route, X } from 'lucide-react';

interface MapViewProps {
  activities: Activity[];
  planName: string;
}

type MarkerFocusState = 'normal' | 'active' | 'related' | 'dimmed';
type SegmentFocusState = 'normal' | 'active' | 'related' | 'hovered' | 'dimmed';

interface RouteSegment {
  polyline: any;
  start: number;
  end: number;
}

// 根据时间段设置不同颜色
const getPeriodColor = (period: string) => {
  switch (period) {
    case '上午':
      return '#f59e0b'; // amber
    case '中午':
      return '#f97316'; // orange
    case '下午':
      return '#3b82f6'; // blue
    case '晚上':
      return '#a855f7'; // purple
    default:
      return '#6b7280'; // gray
  }
};

const getPeriodBgColor = (period: string) => {
  switch (period) {
    case '上午':
      return 'bg-amber-500';
    case '中午':
      return 'bg-orange-500';
    case '下午':
      return 'bg-blue-500';
    case '晚上':
      return 'bg-purple-500';
    default:
      return 'bg-gray-500';
  }
};

const getMarkerFocusState = (
  index: number,
  selectedIndex: number | null,
  selectedSegmentStart: number | null,
  hoveredSegmentStart: number | null
): MarkerFocusState => {
  if (selectedIndex !== null) {
    if (index === selectedIndex) return 'active';
    if (Math.abs(index - selectedIndex) === 1) return 'related';
    return 'dimmed';
  }

  const segmentStart = selectedSegmentStart ?? hoveredSegmentStart;
  if (segmentStart !== null) {
    const isEndpoint = index === segmentStart || index === segmentStart + 1;
    if (!isEndpoint) return 'dimmed';
    if (selectedSegmentStart !== null) return 'active';
    return 'related';
  }

  return 'normal';
};

const getSegmentFocusState = (
  start: number,
  selectedIndex: number | null,
  selectedSegmentStart: number | null,
  hoveredSegmentStart: number | null
): SegmentFocusState => {
  if (selectedSegmentStart !== null) {
    if (start === selectedSegmentStart) return 'active';
    return 'dimmed';
  }

  if (selectedIndex !== null) {
    if (start === selectedIndex || start === selectedIndex - 1) return 'related';
    return 'dimmed';
  }

  if (hoveredSegmentStart !== null) {
    if (start === hoveredSegmentStart) return 'hovered';
    return 'normal';
  }

  return 'normal';
};

const getMarkerContent = (index: number, markerColor: string, state: MarkerFocusState) => {
  const stateStyle = {
    normal: {
      border: '2px solid #fff',
      boxShadow: '0 2px 10px rgba(0,0,0,.24)',
      opacity: 1,
      scale: 1,
      filter: 'none'
    },
    active: {
      border: '3px solid #ffffff',
      boxShadow: '0 0 0 8px rgba(37,99,235,.22), 0 10px 24px rgba(37,99,235,.35)',
      opacity: 1,
      scale: 1.2,
      filter: 'saturate(1.12)'
    },
    related: {
      border: '2px solid #fff',
      boxShadow: '0 6px 16px rgba(37,99,235,.22)',
      opacity: 1,
      scale: 1.08,
      filter: 'none'
    },
    dimmed: {
      border: '2px solid #fff',
      boxShadow: '0 1px 8px rgba(0,0,0,.12)',
      opacity: 0.28,
      scale: 0.94,
      filter: 'grayscale(0.32)'
    }
  }[state];

  return `<div style="width:26px;height:26px;border-radius:999px;background:${markerColor};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:${stateStyle.border};box-shadow:${stateStyle.boxShadow};opacity:${stateStyle.opacity};transform:scale(${stateStyle.scale});filter:${stateStyle.filter};transition:all .18s ease;">${index + 1}</div>`;
};

const getSegmentStyle = (state: SegmentFocusState) => {
  if (state === 'active') {
    return {
      strokeColor: '#1d4ed8',
      strokeWeight: 9,
      strokeOpacity: 1,
      zIndex: 90,
      showDir: true
    };
  }

  if (state === 'related') {
    return {
      strokeColor: '#2563eb',
      strokeWeight: 7,
      strokeOpacity: 0.95,
      zIndex: 75,
      showDir: false
    };
  }

  if (state === 'hovered') {
    return {
      strokeColor: '#3b82f6',
      strokeWeight: 7,
      strokeOpacity: 0.95,
      zIndex: 80,
      showDir: true
    };
  }

  if (state === 'dimmed') {
    return {
      strokeColor: '#94a3b8',
      strokeWeight: 4,
      strokeOpacity: 0.22,
      zIndex: 50,
      showDir: false
    };
  }

  return {
    strokeColor: '#2563eb',
    strokeWeight: 5,
    strokeOpacity: 0.85,
    zIndex: 60,
    showDir: false
  };
};

const getInfoWindowContent = (activity: Activity) => {
  return `<div style="padding:4px 2px;line-height:1.6;"><strong>${activity.title}</strong><br/>${activity.time} · ${activity.period}</div>`;
};

export function MapView({ activities, planName }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRefs = useRef<any[]>([]);
  const segmentRefs = useRef<RouteSegment[]>([]);
  const infoWindowRef = useRef<any>(null);
  const ignoreNextMapClickRef = useRef(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedSegmentStart, setSelectedSegmentStart] = useState<number | null>(null);
  const [hoveredSegmentStart, setHoveredSegmentStart] = useState<number | null>(null);

  const amapKey = import.meta.env.VITE_AMAP_KEY;
  const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;

  const points = useMemo(
    () => activities.map((activity) => [activity.coordinates[1], activity.coordinates[0]] as [number, number]),
    [activities]
  );

  const selectedSegmentDetails = useMemo(() => {
    if (selectedSegmentStart === null) return null;

    const from = activities[selectedSegmentStart];
    const to = activities[selectedSegmentStart + 1];

    if (!from || !to) return null;

    return {
      from,
      to,
      fromIndex: selectedSegmentStart,
      toIndex: selectedSegmentStart + 1
    };
  }, [activities, selectedSegmentStart]);

  const openActivityInfo = (index: number) => {
    const activity = activities[index];
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;

    if (!activity || !map || !infoWindow) return;

    infoWindow.setContent(getInfoWindowContent(activity));
    infoWindow.open(map, points[index]);
  };

  const handleSelectActivity = (index: number) => {
    setSelectedSegmentStart(null);
    setHoveredSegmentStart(null);
    setSelectedIndex(index);
    openActivityInfo(index);
  };

  const handleCloseSegmentPanel = () => {
    setSelectedSegmentStart(null);
  };

  const handleNavigateSegment = (direction: 'prev' | 'next') => {
    if (selectedSegmentStart === null) return;

    if (direction === 'prev' && selectedSegmentStart > 0) {
      setSelectedSegmentStart(selectedSegmentStart - 1);
      return;
    }

    if (direction === 'next' && selectedSegmentStart < activities.length - 2) {
      setSelectedSegmentStart(selectedSegmentStart + 1);
    }
  };

  useEffect(() => {
    setSelectedIndex(null);
    setSelectedSegmentStart(null);
    setHoveredSegmentStart(null);
  }, [activities]);

  useEffect(() => {
    markerRefs.current.forEach((marker, index) => {
      const activity = activities[index];
      if (!marker || !activity) return;

      const markerState = getMarkerFocusState(index, selectedIndex, selectedSegmentStart, hoveredSegmentStart);
      marker.setContent(getMarkerContent(index, getPeriodColor(activity.period), markerState));
      marker.setzIndex(markerState === 'active' ? 140 : markerState === 'related' ? 120 : 100);
    });

    segmentRefs.current.forEach(({ polyline, start }) => {
      if (!polyline) return;
      const segmentState = getSegmentFocusState(start, selectedIndex, selectedSegmentStart, hoveredSegmentStart);
      polyline.setOptions(getSegmentStyle(segmentState));
    });
  }, [activities, hoveredSegmentStart, selectedIndex, selectedSegmentStart]);

  useEffect(() => {
    if (!containerRef.current || activities.length === 0) return;

    setLoadError(null);
    setMapReady(false);

    if (!amapKey) {
      setLoadError('缺少 VITE_AMAP_KEY，无法加载高德地图。');
      return;
    }

    let destroyed = false;
    let map: any = null;

    if (securityCode) {
      (window as Window & { _AMapSecurityConfig?: { securityJsCode: string } })._AMapSecurityConfig = {
        securityJsCode: securityCode
      };
    }

    AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar']
    })
      .then((AMap) => {
        if (destroyed || !containerRef.current) return;

        map = new AMap.Map(containerRef.current, {
          center: points[0],
          zoom: 12,
          resizeEnable: true
        });

        mapRef.current = map;
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar());

        const infoWindow = new AMap.InfoWindow({
          offset: new AMap.Pixel(0, -24)
        });
        infoWindowRef.current = infoWindow;

        const markerList = activities.map((activity, index) => {
          const markerColor = getPeriodColor(activity.period);
          const marker = new AMap.Marker({
            map,
            position: points[index],
            title: `${index + 1}. ${activity.title}`,
            anchor: 'bottom-center',
            content: getMarkerContent(index, markerColor, 'normal'),
            zIndex: 100
          });

          marker.on('click', () => {
            ignoreNextMapClickRef.current = true;
            window.setTimeout(() => {
              ignoreNextMapClickRef.current = false;
            }, 180);

            setSelectedSegmentStart(null);
            setHoveredSegmentStart(null);
            setSelectedIndex(index);
            infoWindow.setContent(getInfoWindowContent(activity));
            infoWindow.open(map, points[index]);
          });

          return marker;
        });

        const segments: RouteSegment[] = [];
        for (let i = 0; i < points.length - 1; i += 1) {
          const polyline = new AMap.Polyline({
            map,
            path: [points[i], points[i + 1]],
            lineJoin: 'round',
            lineCap: 'round',
            ...getSegmentStyle('normal')
          });

          polyline.on('mouseover', () => {
            setHoveredSegmentStart(i);
          });

          polyline.on('mouseout', () => {
            setHoveredSegmentStart((prev) => (prev === i ? null : prev));
          });

          polyline.on('click', () => {
            ignoreNextMapClickRef.current = true;
            window.setTimeout(() => {
              ignoreNextMapClickRef.current = false;
            }, 180);

            setSelectedIndex(null);
            setSelectedSegmentStart(i);
            setHoveredSegmentStart(null);
            infoWindow.close();
          });

          segments.push({ polyline, start: i, end: i + 1 });
        }

        markerRefs.current = markerList;
        segmentRefs.current = segments;

        map.on('click', () => {
          if (ignoreNextMapClickRef.current) {
            ignoreNextMapClickRef.current = false;
            return;
          }

          setSelectedIndex(null);
          setSelectedSegmentStart(null);
          setHoveredSegmentStart(null);
          infoWindow.close();
        });

        map.setFitView(
          [...markerList, ...segments.map((segment) => segment.polyline)],
          false,
          [60, 60, 60, 60]
        );

        setMapReady(true);
      })
      .catch((error: Error) => {
        if (destroyed) return;
        setLoadError(error.message || '高德地图加载失败，请检查 Key 和网络。');
      });

    return () => {
      destroyed = true;
      markerRefs.current = [];
      segmentRefs.current = [];
      infoWindowRef.current = null;
      mapRef.current = null;
      ignoreNextMapClickRef.current = false;

      if (map) {
        map.destroy();
      }
    };
  }, [activities, amapKey, securityCode, points]);

  if (activities.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        暂无地图数据
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 bg-white rounded-lg overflow-hidden">
      {/* AMap */}
      <div className="flex-1 relative bg-gray-100">
        <div ref={containerRef} className="w-full h-full" aria-label={`${planName} 高德地图`} />

        {!mapReady && !loadError && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-lg max-w-xs">
              地图加载中...
            </div>
          </div>
        )}

        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-white/95 backdrop-blur-sm rounded-lg p-4 shadow-lg max-w-md border border-red-100">
              <div className="flex items-start gap-2 text-red-600">
                <AlertCircle className="size-4 mt-0.5" />
                <div>
                  <p className="font-medium">高德地图加载失败</p>
                  <p className="text-sm mt-1 text-red-500">{loadError}</p>
                  <p className="text-xs mt-2 text-muted-foreground">
                    请在 <code className="font-mono">figma/.env</code> 中配置 <code className="font-mono">VITE_AMAP_KEY</code>（可选 <code className="font-mono">VITE_AMAP_SECURITY_CODE</code>）。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loadError && (
          <>
            <div className="absolute top-3 left-3 pointer-events-none">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="size-5 text-blue-600" />
                <h3 className="font-semibold">高德路线预览</h3>
              </div>
              <p className="text-sm text-muted-foreground">点击点位看活动，点击线路看路段详情，点击空白重置</p>
            </div>

            {selectedSegmentDetails && (
              <div className="absolute top-3 right-3 w-[340px] max-w-[calc(100%-1.5rem)] bg-white/95 backdrop-blur-sm rounded-xl border border-blue-100 shadow-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="inline-flex items-center gap-1 text-[11px] text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 mb-2">
                      <Route className="size-3" />
                      路段详情
                    </div>
                    <h4 className="font-semibold text-sm leading-5 text-slate-900">
                      第 {selectedSegmentDetails.fromIndex + 1} 站 <ArrowRight className="inline size-3.5" /> 第 {selectedSegmentDetails.toIndex + 1} 站
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">
                      {selectedSegmentDetails.from.title} 到 {selectedSegmentDetails.to.title}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseSegmentPanel}
                    className="size-7 rounded-md border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 flex items-center justify-center"
                    aria-label="关闭路段详情"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="space-y-2 text-xs text-slate-700">
                  <div className="flex items-start gap-2">
                    <Navigation className="size-3.5 mt-0.5 text-blue-600" />
                    <div>
                      <p className="text-slate-500">推荐交通</p>
                      <p className="font-medium">{selectedSegmentDetails.to.transport}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Clock3 className="size-3.5 mt-0.5 text-amber-600" />
                    <div>
                      <p className="text-slate-500">时段衔接</p>
                      <p className="font-medium">{selectedSegmentDetails.from.time} → {selectedSegmentDetails.to.time}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-0.5">为什么这样安排</p>
                    <p className="leading-5">{selectedSegmentDetails.to.reason}</p>
                  </div>
                  {selectedSegmentDetails.to.alternatives.length > 0 && (
                    <div>
                      <p className="text-slate-500 mb-1">可替代路线</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedSegmentDetails.to.alternatives.slice(0, 3).map((item) => (
                          <span
                            key={item}
                            className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-700"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleNavigateSegment('prev')}
                    disabled={selectedSegmentStart === 0}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    上一段
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigateSegment('next')}
                    disabled={selectedSegmentStart === activities.length - 2}
                    className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    下一段
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Activity List */}
      <div className="max-h-64 overflow-y-auto px-4 pb-4">
        <h3 className="font-semibold mb-3 sticky top-0 bg-white py-2">路线点位</h3>
        <div className="space-y-2">
          {activities.map((activity, index) => {
            const markerState = getMarkerFocusState(index, selectedIndex, selectedSegmentStart, hoveredSegmentStart);
            const isDimmed = markerState === 'dimmed';
            const isActive = markerState === 'active';
            const isRelated = markerState === 'related';

            return (
              <button
                key={activity.id}
                type="button"
                onClick={() => handleSelectActivity(index)}
                className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border bg-card transition-all ${
                  isActive
                    ? 'border-blue-300 bg-blue-50/70 shadow-md ring-2 ring-blue-200'
                    : isRelated
                      ? 'border-blue-200 bg-blue-50/35'
                      : 'hover:shadow-md'
                } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
              >
                <div className="flex-shrink-0">
                  <div
                    className={`size-8 rounded-full ${getPeriodBgColor(activity.period)} flex items-center justify-center text-white font-bold text-sm ${isActive ? 'scale-110' : ''}`}
                  >
                    {index + 1}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-sm">{activity.title}</h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full text-white ${getPeriodBgColor(activity.period)}`}
                    >
                      {activity.period}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">{activity.time}</p>
                  <p className="text-sm text-muted-foreground">{activity.description}</p>

                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Navigation className="size-3" />
                      <span>{activity.duration}</span>
                    </div>
                    <div>📍 {activity.coordinates[0].toFixed(4)}, {activity.coordinates[1].toFixed(4)}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

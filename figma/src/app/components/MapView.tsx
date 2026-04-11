import { useEffect, useMemo, useRef, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { Activity } from '../data/mockPlans';
import { AlertCircle, MapPin, Navigation } from 'lucide-react';

interface MapViewProps {
  activities: Activity[];
  planName: string;
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

export function MapView({ activities, planName }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const amapKey = import.meta.env.VITE_AMAP_KEY;
  const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;

  const points = useMemo(
    () => activities.map((activity) => [activity.coordinates[1], activity.coordinates[0]] as [number, number]),
    [activities]
  );

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

        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar());

        const markerList = activities.map((activity, index) => {
          const markerColor = getPeriodColor(activity.period);
          const marker = new AMap.Marker({
            map,
            position: points[index],
            title: `${index + 1}. ${activity.title}`,
            anchor: 'bottom-center',
            content: `<div style="width:26px;height:26px;border-radius:999px;background:${markerColor};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.24);">${index + 1}</div>`
          });

          const infoWindow = new AMap.InfoWindow({
            content: `<div style="padding:4px 2px;line-height:1.6;"><strong>${activity.title}</strong><br/>${activity.time} · ${activity.period}</div>`,
            offset: new AMap.Pixel(0, -24)
          });

          marker.on('click', () => {
            infoWindow.open(map, points[index]);
          });

          return marker;
        });

        const polyline = new AMap.Polyline({
          map,
          path: points,
          strokeColor: '#2563eb',
          strokeWeight: 5,
          strokeOpacity: 0.85,
          lineJoin: 'round',
          lineCap: 'round'
        });

        map.setFitView([...markerList, polyline], false, [60, 60, 60, 60]);
        setMapReady(true);
      })
      .catch((error: Error) => {
        if (destroyed) return;
        setLoadError(error.message || '高德地图加载失败，请检查 Key 和网络。');
      });

    return () => {
      destroyed = true;
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
          <div className="absolute top-3 left-3 pointer-events-none">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="size-5 text-blue-600" />
              <h3 className="font-semibold">高德路线预览</h3>
            </div>
            <p className="text-sm text-muted-foreground">点击地图标记可查看活动信息</p>
          </div>
        )}
      </div>

      {/* Activity List */}
      <div className="max-h-64 overflow-y-auto px-4 pb-4">
        <h3 className="font-semibold mb-3 sticky top-0 bg-white py-2">路线点位</h3>
        <div className="space-y-2">
          {activities.map((activity, index) => (
            <div 
              key={activity.id}
              className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:shadow-md transition-shadow"
            >
              <div className="flex-shrink-0">
                <div 
                  className={`size-8 rounded-full ${getPeriodBgColor(activity.period)} flex items-center justify-center text-white font-bold text-sm`}
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
              
              {index < activities.length - 1 && (
                <div className="absolute left-7 top-full w-0.5 h-2 bg-gray-300" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

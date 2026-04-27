import { useEffect, useMemo, useRef, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { Footprints, LoaderCircle, MapPinned } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/dialog';
import { getVisitedPlaces, type VisitedPlace } from '../data/plansStore';

const FOOTPRINT_RADIUS_METERS = 5000;

function formatVisitedAt(timestamp: number) {
  if (!timestamp) return '未知时间';
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  });
}

function getFootprintMarkerContent() {
  return `
    <div style="
      width:30px;height:30px;border-radius:999px;background:#f59e0b;color:#fff;
      display:flex;align-items:center;justify-content:center;
      border:3px solid #fff;box-shadow:0 0 0 7px rgba(245,158,11,.22),0 8px 20px rgba(146,64,14,.32);
    ">
      <div style="width:10px;height:10px;border-radius:999px;background:#fff;"></div>
    </div>
  `;
}

function getInfoWindowContent(place: VisitedPlace) {
  return `
    <div style="padding:4px 2px;line-height:1.6;max-width:240px;">
      <strong>${place.title}</strong><br/>
      <span>去过 ${place.visitCount} 次 · ${formatVisitedAt(place.visitedAt)}</span>
    </div>
  `;
}

function FootprintMap({ places }: { places: VisitedPlace[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || places.length === 0) return;

    const amapKey = import.meta.env.VITE_AMAP_KEY;
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;

    if (!amapKey) {
      setLoadError('缺少 VITE_AMAP_KEY，无法加载足迹地图。');
      return;
    }

    if (securityCode) {
      (window as Window & { _AMapSecurityConfig?: { securityJsCode: string } })._AMapSecurityConfig = {
        securityJsCode: securityCode
      };
    }

    let destroyed = false;
    let map: any = null;

    setLoadError('');
    setMapReady(false);

    AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar']
    })
      .then((AMap) => {
        if (destroyed || !containerRef.current) return;

        const firstPlace = places[0];
        map = new AMap.Map(containerRef.current, {
          center: firstPlace.coordinates,
          zoom: 10,
          resizeEnable: true,
          mapStyle: 'amap://styles/normal'
        });
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ position: 'RB' }));

        const infoWindow = new AMap.InfoWindow({
          offset: new AMap.Pixel(0, -26)
        });

        const overlays = places.flatMap((place) => {
          const circle = new AMap.Circle({
            map,
            center: place.coordinates,
            radius: FOOTPRINT_RADIUS_METERS,
            strokeColor: '#f59e0b',
            strokeOpacity: 0.42,
            strokeWeight: 1,
            fillColor: '#fbbf24',
            fillOpacity: 0.13,
            zIndex: 80
          });

          const marker = new AMap.Marker({
            map,
            position: place.coordinates,
            title: place.title,
            anchor: 'center',
            content: getFootprintMarkerContent(),
            zIndex: 180
          });

          marker.on('click', () => {
            infoWindow.setContent(getInfoWindowContent(place));
            infoWindow.open(map, place.coordinates);
          });

          return [circle, marker];
        });

        map.setFitView(overlays, false, [64, 64, 64, 64]);
        setMapReady(true);
      })
      .catch((error: Error) => {
        if (destroyed) return;
        setLoadError(error.message || '足迹地图加载失败');
      });

    return () => {
      destroyed = true;
      if (map) {
        map.destroy();
      }
    };
  }, [places]);

  return (
    <div className="relative h-[520px] overflow-hidden rounded-lg border bg-slate-100">
      <div ref={containerRef} className="h-full w-full" />

      {!mapReady && !loadError && places.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-3 text-sm shadow-sm">
            <LoaderCircle className="size-4 animate-spin" />
            足迹地图加载中
          </div>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="max-w-sm rounded-lg border border-red-100 bg-white p-4 text-sm text-red-600 shadow-sm">
            {loadError}
          </div>
        </div>
      )}

      <div className="absolute left-3 top-3 rounded-md border bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
        金色点为去过地点，半透明圆表示约 5km 足迹覆盖范围。
      </div>
    </div>
  );
}

export function UserFootprintDialog() {
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<VisitedPlace[]>([]);

  useEffect(() => {
    if (!open) return;
    let isActive = true;
    getVisitedPlaces().then((nextPlaces) => {
      if (isActive) setPlaces(nextPlaces);
    });
    return () => {
      isActive = false;
    };
  }, [open]);

  const totalVisits = useMemo(
    () => places.reduce((sum, place) => sum + place.visitCount, 0),
    [places]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <Footprints className="size-4" />
          用户足迹
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Footprints className="size-5 text-amber-600" />
            用户足迹
          </DialogTitle>
          <DialogDescription>
            标记完成计划后，计划里的活动地点会在这里点亮。
          </DialogDescription>
        </DialogHeader>

        {places.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border bg-slate-50 px-6 text-center">
            <MapPinned className="size-10 text-slate-400" />
            <p className="mt-4 font-medium">还没有足迹</p>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              打开任意计划详情页，点击“标记已完成”，该计划里的景点就会加入足迹地图。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs text-muted-foreground">点亮地点</p>
                <p className="mt-1 text-2xl font-semibold">{places.length}</p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs text-muted-foreground">累计访问</p>
                <p className="mt-1 text-2xl font-semibold">{totalVisits}</p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3">
                <p className="text-xs text-muted-foreground">覆盖半径</p>
                <p className="mt-1 text-2xl font-semibold">5km</p>
              </div>
            </div>

            <FootprintMap places={places} />

            <div className="max-h-44 overflow-auto rounded-lg border divide-y">
              {places.map((place) => (
                <div key={place.placeKey} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <span className="mt-1 flex size-3 shrink-0 rounded-full bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.18)]">
                    <span className="sr-only">足迹点</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{place.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      去过 {place.visitCount} 次 · {formatVisitedAt(place.visitedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { Activity } from '../data/mockPlans';
import { MapPin, Navigation } from 'lucide-react';

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
  if (activities.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        暂无地图数据
      </div>
    );
  }

  // 计算地图中心点和缩放级别
  const latitudes = activities.map(a => a.coordinates[0]);
  const longitudes = activities.map(a => a.coordinates[1]);
  
  const centerLat = (Math.max(...latitudes) + Math.min(...latitudes)) / 2;
  const centerLon = (Math.max(...longitudes) + Math.min(...longitudes)) / 2;
  
  // 创建静态地图URL (使用 OpenStreetMap 静态地图API)
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(...longitudes)},${Math.min(...latitudes)},${Math.max(...longitudes)},${Math.max(...latitudes)}&layer=mapnik`;

  return (
    <div className="h-full flex flex-col gap-4 bg-white rounded-lg overflow-hidden">
      {/* Map Preview */}
      <div className="flex-1 relative bg-gray-100">
        <iframe
          src={mapUrl}
          className="w-full h-full"
          style={{ border: 0 }}
          title={`${planName} 地图`}
        />
        
        {/* Overlay with activity markers */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-lg max-w-xs pointer-events-auto">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="size-5 text-blue-600" />
              <h3 className="font-semibold">路线预览</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              查看下方活动列表了解详细路线信息
            </p>
          </div>
        </div>
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

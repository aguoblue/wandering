import { useEffect, useMemo, useRef, useState } from 'react';
import { TravelPlanCard } from '../components/TravelPlanCard';
import { Search, Filter, MapPin, LoaderCircle, Check } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { motion } from 'motion/react';
import { getAllPlans, upsertGeneratedPlan } from '../data/plansStore';
import { generatePlanWithAi } from '../services/aiPlanClient';
import {
  locateCenterByKeyword,
  locateCenterByLocation,
  searchLocationSuggestions,
  type DiscoverySuggestion,
  type DiscoveryCenter,
  type NearbyPoi
} from '../services/amapDiscoveryClient';
import { DiscoveryMapView } from '../components/DiscoveryMapView';

export function PlansListPage() {
  const [plans, setPlans] = useState(getAllPlans);
  const [keyword, setKeyword] = useState('');
  const [city, setCity] = useState('深圳');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const [searchKeyword, setSearchKeyword] = useState('');
  const [suggestions, setSuggestions] = useState<DiscoverySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [hasTriedAutoLocate, setHasTriedAutoLocate] = useState(false);
  const [locateError, setLocateError] = useState('');
  const [center, setCenter] = useState<DiscoveryCenter | null>(null);
  const [nearbyPois, setNearbyPois] = useState<NearbyPoi[]>([]);
  const [selectedPoiIds, setSelectedPoiIds] = useState<string[]>([]);
  const [poiCategoryFilter, setPoiCategoryFilter] = useState<'all' | 'scenic' | 'food'>('all');
  const suggestionRequestIdRef = useRef(0);
  const hideSuggestionTimerRef = useRef<number | null>(null);
  const isUserTypingRef = useRef(false);

  const filteredPlans = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return plans;

    return plans.filter((plan) => {
      const text = [
        plan.name,
        plan.destination,
        plan.highlight,
        ...plan.tags
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [keyword, plans]);

  const visibleNearbyPois = useMemo(() => {
    const maxDistance = Number.MAX_SAFE_INTEGER;
    return nearbyPois
      .filter((poi) => {
        if (poiCategoryFilter === 'all') return true;
        return poi.category === poiCategoryFilter;
      })
      .slice()
      .sort((a, b) => {
        const distanceA = typeof a.distance === 'number' ? a.distance : maxDistance;
        const distanceB = typeof b.distance === 'number' ? b.distance : maxDistance;
        if (distanceA !== distanceB) return distanceA - distanceB;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });
  }, [nearbyPois, poiCategoryFilter]);

  const setSearchKeywordBySystem = (value: string) => {
    isUserTypingRef.current = false;
    setSearchKeyword(value);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleGeneratePlan = async () => {
    if (!city.trim()) {
      setGenerateError('请先填写城市');
      return;
    }

    setIsGenerating(true);
    setGenerateError('');

    try {
      const result = await generatePlanWithAi({
        city: city.trim(),
        days: 1,
        activitiesPerDay: 4,
        startDate: '2026-05-01',
        budgetRange: '¥700-2200',
        style: '城市漫游、美食、海滨、拍照、轻松节奏'
      });

      const generated = result.plans[0];
      if (!generated) {
        throw new Error('未生成有效计划');
      }

      upsertGeneratedPlan(generated);
      setPlans(getAllPlans());
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : 'AI 生成失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSearchLocation = async () => {
    if (!searchKeyword.trim()) {
      setLocateError('请输入地点关键词');
      return;
    }

    setIsLocating(true);
    setLocateError('');

    try {
      const result = await locateCenterByKeyword(searchKeyword.trim());
      setCenter(result);
      setSearchKeywordBySystem(result.address || result.name);
    } catch (error) {
      setLocateError(error instanceof Error ? error.message : '定位失败，请稍后重试');
    } finally {
      setIsLocating(false);
    }
  };

  const handleSelectSuggestion = (suggestion: DiscoverySuggestion) => {
    setCenter(suggestion);
    setSearchKeywordBySystem(suggestion.address || suggestion.name);
    setLocateError('');
  };

  const togglePoiSelection = (poi: NearbyPoi) => {
    setSelectedPoiIds((previous) =>
      previous.includes(poi.id) ? previous.filter((id) => id !== poi.id) : [...previous, poi.id]
    );
  };

  useEffect(() => {
    if (center || hasTriedAutoLocate || isLocating) return;
    if (!navigator.geolocation) return;

    setHasTriedAutoLocate(true);
    setIsLocating(true);
    setLocateError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { longitude, latitude } = position.coords;
          const result = await locateCenterByLocation([longitude, latitude], {
            fromBrowserGps: true
          });
          setCenter(result);
          setSearchKeywordBySystem(result.address || result.name);
        } catch (error) {
          setLocateError(error instanceof Error ? error.message : '自动定位失败，请手动搜索地点');
        } finally {
          setIsLocating(false);
        }
      },
      () => {
        setLocateError('自动定位失败，请允许浏览器定位权限或手动搜索地点');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [center, hasTriedAutoLocate, isLocating]);

  useEffect(() => {
    if (!isUserTypingRef.current) {
      return;
    }

    const trimmedKeyword = searchKeyword.trim();
    if (!trimmedKeyword) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const requestId = suggestionRequestIdRef.current + 1;
    suggestionRequestIdRef.current = requestId;
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchLocationSuggestions(trimmedKeyword);
        if (suggestionRequestIdRef.current !== requestId) return;
        setSuggestions(result);
        setShowSuggestions(result.length > 0);
      } catch {
        if (suggestionRequestIdRef.current !== requestId) return;
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 260);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchKeyword]);

  useEffect(() => {
    return () => {
      if (hideSuggestionTimerRef.current !== null) {
        window.clearTimeout(hideSuggestionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSelectedPoiIds((previous) => previous.filter((id) => nearbyPois.some((poi) => poi.id === id)));
  }, [nearbyPois]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            AI 旅行计划精选
          </h1>
          <p className="text-muted-foreground mt-2">搜索地点定位地图，也可直接使用右下角高德定位按钮</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8 p-5 bg-white rounded-xl shadow-sm border space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="size-4 text-blue-600" />
            <h2 className="text-lg font-semibold">地点搜索与定位</h2>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative md:max-w-xl w-full">
              <Input
                value={searchKeyword}
                onChange={(event) => {
                  isUserTypingRef.current = true;
                  setSearchKeyword(event.target.value);
                }}
                onFocus={() => {
                  if (isUserTypingRef.current && suggestions.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  hideSuggestionTimerRef.current = window.setTimeout(() => {
                    setShowSuggestions(false);
                  }, 120);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleSearchLocation();
                  }
                }}
                placeholder="搜索地点，如：上海武康路、杭州西湖"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-2 w-full rounded-lg border bg-white shadow-lg z-20 overflow-hidden">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => handleSelectSuggestion(suggestion)}
                    >
                      <p className="text-sm font-medium truncate">{suggestion.name}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{suggestion.address}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button onClick={() => void handleSearchLocation()} disabled={isLocating}>
              {isLocating ? (
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin" />
                  定位中...
                </span>
              ) : (
                '搜索并定位'
              )}
            </Button>
          </div>

          {isLocating && (
            <p className="text-sm text-blue-600 inline-flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />
              正在定位当前位置...
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            地图右下角已启用高德官方定位按钮，可随时获取当前定位。
          </p>

          <div className="h-[420px] rounded-xl overflow-hidden border bg-gray-100">
            <DiscoveryMapView
              center={center}
              nearbyPois={nearbyPois}
              selectedPoiIds={selectedPoiIds}
              onNearbyPoisChange={(pois) => {
                setNearbyPois(pois);
              }}
              onTogglePoiSelect={(poi) => {
                togglePoiSelection(poi);
              }}
              onLocate={(nextCenter) => {
                setCenter(nextCenter);
                setSearchKeywordBySystem(nextCenter.address || nextCenter.name);
                setLocateError('');
              }}
              onLocateError={(message) => {
                if (message) {
                  setLocateError(message);
                  return;
                }
                setLocateError('');
              }}
            />
          </div>

          {center && (
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-sm font-semibold">当前定位：{center.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{center.address}</p>
            </div>
          )}

          {center && (
            <div className="rounded-lg border bg-white">
              <div className="p-3 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">周边 POI（按距离排序）</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    已选 {selectedPoiIds.length} 个，可继续在地图或列表中勾选/取消
                  </p>
                </div>
                <div className="inline-flex rounded-md border overflow-hidden self-start">
                  {[
                    { key: 'all', label: '全部' },
                    { key: 'scenic', label: '景点' },
                    { key: 'food', label: '美食' }
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setPoiCategoryFilter(item.key as 'all' | 'scenic' | 'food')}
                      className={`px-3 py-1.5 text-xs ${
                        poiCategoryFilter === item.key ? 'bg-blue-600 text-white' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-72 overflow-auto divide-y">
                {visibleNearbyPois.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    暂无周边结果，请换个地点重试。
                  </div>
                )}
                {visibleNearbyPois.map((poi) => {
                  const checked = selectedPoiIds.includes(poi.id);
                  return (
                    <button
                      key={poi.id}
                      type="button"
                      onClick={() => togglePoiSelection(poi)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${
                        checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 size-5 rounded border inline-flex items-center justify-center ${
                            checked ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-transparent'
                          }`}
                        >
                          <Check className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{poi.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {poi.category === 'scenic' ? '景点' : '美食'}{poi.type ? ` · ${poi.type}` : ''}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {poi.address || '暂无详细地址'}
                          </p>
                        </div>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {typeof poi.distance === 'number' ? `${poi.distance}m` : '--'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
            <Input
              placeholder="搜索目的地、标签..."
              className="pl-10"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2">
            <Filter className="size-4" />
            筛选
          </Button>
        </div>

        <div className="mb-8 p-4 bg-white rounded-lg shadow-sm border">
          <div className="flex flex-col md:flex-row gap-3">
            <Input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="输入城市，如：深圳"
              className="md:max-w-xs"
            />
            <Button onClick={handleGeneratePlan} disabled={isGenerating}>
              {isGenerating ? 'AI 生成中...' : 'AI 生成一条计划'}
            </Button>
          </div>
          {generateError && (
            <p className="text-sm text-red-500 mt-2">{generateError}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            会调用本地 /api/ai/generate-plan，并把结果加入当前列表与本地存储。
          </p>
        </div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {filteredPlans.map((plan, index) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <TravelPlanCard plan={plan} />
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-6 rounded-lg bg-white shadow-sm">
            <div className="text-3xl font-bold text-blue-600">{plans.length}</div>
            <div className="text-sm text-muted-foreground mt-1">精选计划</div>
          </div>
          <div className="text-center p-6 rounded-lg bg-white shadow-sm">
            <div className="text-3xl font-bold text-purple-600">
              {plans.reduce((sum, plan) => sum + plan.days.length, 0)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">天数</div>
          </div>
          <div className="text-center p-6 rounded-lg bg-white shadow-sm">
            <div className="text-3xl font-bold text-green-600">
              {plans.reduce((sum, plan) =>
                sum + plan.days.reduce((daySum, day) => daySum + day.activities.length, 0), 0
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-1">个活动</div>
          </div>
        </div>
      </div>
    </div>
  );
}

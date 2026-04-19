import { useParams, useNavigate } from 'react-router';
import { DayItinerary } from '../components/DayItinerary';
import { MapView } from '../components/MapView';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Calendar, TrendingUp, Wallet, MapIcon, List } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { getAllPlans } from '../data/plansStore';
import { TravelChatPanel } from '../components/TravelChatPanel';

export function PlanDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeDay, setActiveDay] = useState(0);
  const [, setPlansVersion] = useState(0);
  
  const plan = getAllPlans().find(p => p.id === id);
  
  if (!plan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">计划未找到</h2>
          <Button onClick={() => navigate('/')}>返回首页</Button>
        </div>
      </div>
    );
  }

  // 获取所有活动用于地图显示
  const allActivities = plan.days.flatMap(day => day.activities);
  const currentDayActivities = plan.days[activeDay]?.activities || [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Hero Section */}
      <div className="relative h-80 overflow-hidden">
        <img 
          src={plan.image} 
          alt={plan.name}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />
        
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-7xl mx-auto px-4 pb-8 w-full">
            <Button 
              variant="secondary" 
              size="sm"
              onClick={() => navigate('/')}
              className="mb-4 gap-2"
            >
              <ArrowLeft className="size-4" />
              返回列表
            </Button>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="flex flex-wrap gap-2 mb-3">
                {plan.tags.map((tag, index) => (
                  <Badge key={index} variant="secondary" className="bg-white/90 backdrop-blur-sm">
                    {tag}
                  </Badge>
                ))}
              </div>
              <h1 className="text-4xl font-bold text-white mb-2">{plan.name}</h1>
              <p className="text-white/90 text-lg">{plan.highlight}</p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Info Bar */}
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-blue-600" />
              <span className="font-medium">时长：</span>
              <span>{plan.duration}</span>
            </div>
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-green-600" />
              <span className="font-medium">预算：</span>
              <span>{plan.budget}</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-orange-600" />
              <span className="font-medium">强度：</span>
              <span>{plan.walkingIntensity}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 py-8">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <Tabs defaultValue="itinerary" className="space-y-6">
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="itinerary" className="gap-2">
                  <List className="size-4" />
                  行程详情
                </TabsTrigger>
                <TabsTrigger value="map" className="gap-2">
                  <MapIcon className="size-4" />
                  地图模式
                </TabsTrigger>
              </TabsList>

              {/* Itinerary Tab */}
              <TabsContent value="itinerary" className="space-y-6">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  {plan.days.map((day, index) => (
                    <motion.div
                      key={day.day}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                    >
                      <DayItinerary day={day} />
                    </motion.div>
                  ))}
                </motion.div>
              </TabsContent>

              {/* Map Tab */}
              <TabsContent value="map" className="space-y-4">
                {/* Day Selector */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant={activeDay === -1 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveDay(-1)}
                  >
                    完整路线
                  </Button>
                  {plan.days.map((day, index) => (
                    <Button
                      key={day.day}
                      variant={activeDay === index ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveDay(index)}
                    >
                      第 {day.day} 天
                    </Button>
                  ))}
                </div>

                {/* Map Legend */}
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h3 className="font-semibold mb-3">图例说明</h3>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full bg-amber-500" />
                      <span>上午</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full bg-orange-500" />
                      <span>中午</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full bg-blue-500" />
                      <span>下午</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full bg-purple-500" />
                      <span>晚上</span>
                    </div>
                  </div>
                </div>

                {/* Map Container */}
                <motion.div
                  className="h-[600px] rounded-lg overflow-hidden shadow-lg"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  <MapView
                    activities={activeDay === -1 ? allActivities : currentDayActivities}
                    planName={plan.name}
                  />
                </motion.div>

                {/* Activity List for Selected Day */}
                {activeDay !== -1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <h3 className="font-semibold mb-4">第 {activeDay + 1} 天活动</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                      {currentDayActivities.map((activity, index) => (
                        <div
                          key={activity.id}
                          className="p-3 rounded-lg border bg-white hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start gap-2">
                            <div
                              className="flex-shrink-0 flex items-center justify-center size-6 rounded-full text-xs font-bold text-white"
                              style={{
                                backgroundColor: (() => {
                                  switch (activity.period) {
                                    case '上午':
                                      return '#f59e0b';
                                    case '中午':
                                      return '#f97316';
                                    case '下午':
                                      return '#3b82f6';
                                    case '晚上':
                                      return '#a855f7';
                                    default:
                                      return '#6b7280';
                                  }
                                })()
                              }}
                            >
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-sm truncate">{activity.title}</h4>
                              <p className="text-xs text-muted-foreground mt-1">{activity.time}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <TravelChatPanel
            relatedPlan={plan}
            onPlanGenerated={() => {
              setPlansVersion((current) => current + 1);
            }}
          />
        </div>
      </div>
    </div>
  );
}

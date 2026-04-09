import { mockPlans } from '../data/mockPlans';
import { TravelPlanCard } from '../components/TravelPlanCard';
import { Search, Filter } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { motion } from 'motion/react';

export function PlansListPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            AI 旅行计划精选
          </h1>
          <p className="text-muted-foreground mt-2">探索精心策划的旅行路线，开启你的完美旅程</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Search and Filter */}
        <div className="flex gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
            <Input 
              placeholder="搜索目的地、标签..." 
              className="pl-10"
            />
          </div>
          <Button variant="outline" className="gap-2">
            <Filter className="size-4" />
            筛选
          </Button>
        </div>

        {/* Plans Grid */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          {mockPlans.map((plan, index) => (
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

        {/* Stats */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-6 rounded-lg bg-white shadow-sm">
            <div className="text-3xl font-bold text-blue-600">{mockPlans.length}</div>
            <div className="text-sm text-muted-foreground mt-1">精选计划</div>
          </div>
          <div className="text-center p-6 rounded-lg bg-white shadow-sm">
            <div className="text-3xl font-bold text-purple-600">
              {mockPlans.reduce((sum, plan) => sum + plan.days.length, 0)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">天数</div>
          </div>
          <div className="text-center p-6 rounded-lg bg-white shadow-sm">
            <div className="text-3xl font-bold text-green-600">
              {mockPlans.reduce((sum, plan) => 
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

import { useMemo, useState } from 'react';
import { TravelPlanCard } from '../components/TravelPlanCard';
import { Search, Filter } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { motion } from 'motion/react';
import { getAllPlans, upsertGeneratedPlan } from '../data/plansStore';
import { generatePlanWithAi } from '../services/aiPlanClient';

export function PlansListPage() {
  const [plans, setPlans] = useState(getAllPlans);
  const [keyword, setKeyword] = useState('');
  const [city, setCity] = useState('深圳');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

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
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2">
            <Filter className="size-4" />
            筛选
          </Button>
        </div>

        {/* AI Generate */}
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

        {/* Plans Grid */}
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

        {/* Stats */}
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

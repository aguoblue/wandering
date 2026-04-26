import { Card, CardContent, CardHeader } from './ui/card';
import { Badge } from './ui/badge';
import { Calendar, TrendingUp, MapPin, Trash2 } from 'lucide-react';
import type { TravelPlan } from '../data/mockPlans';
import { Link } from 'react-router';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { Button } from './ui/button';

interface TravelPlanCardProps {
  plan: TravelPlan;
  onDelete?: (plan: TravelPlan) => void;
}

export function TravelPlanCard({ plan, onDelete }: TravelPlanCardProps) {
  return (
    <div className="relative group">
      {onDelete && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="absolute top-3 left-3 z-10 size-9 bg-white/90 text-slate-600 shadow-sm backdrop-blur-sm hover:bg-red-50 hover:text-red-600"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(plan);
          }}
          aria-label={`删除计划 ${plan.name}`}
          title="删除计划"
        >
          <Trash2 className="size-4" />
        </Button>
      )}
      <Link to={`/plan/${plan.id}`} className="block">
        <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
          <div className="relative h-48 overflow-hidden">
            <ImageWithFallback
              src={plan.image}
              alt={plan.name}
              className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute top-3 right-3 flex gap-2">
              {plan.tags.map((tag, index) => (
                <Badge key={index} variant="secondary" className="bg-white/90 backdrop-blur-sm">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          <CardHeader className="pb-3">
            <h3 className="text-xl font-semibold">{plan.name}</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{plan.highlight}</p>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Calendar className="size-4" />
                <span>{plan.duration}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <TrendingUp className="size-4" />
              <span>步行强度：{plan.walkingIntensity}</span>
            </div>

            <div className="flex items-center gap-1.5 text-sm text-blue-600">
              <MapPin className="size-4" />
              <span>{plan.destination}</span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

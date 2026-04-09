import { Card, CardContent, CardHeader } from './ui/card';
import { Badge } from './ui/badge';
import { Calendar, TrendingUp, Wallet, MapPin } from 'lucide-react';
import { TravelPlan } from '../data/mockPlans';
import { Link } from 'react-router';

interface TravelPlanCardProps {
  plan: TravelPlan;
}

export function TravelPlanCard({ plan }: TravelPlanCardProps) {
  return (
    <Link to={`/plan/${plan.id}`} className="block">
      <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
        <div className="relative h-48 overflow-hidden">
          <img 
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
            <div className="flex items-center gap-1.5">
              <Wallet className="size-4" />
              <span>{plan.budget}</span>
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
  );
}

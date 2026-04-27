import { Day } from '../data/mockPlans';
import { ActivityItem } from './ActivityItem';
import { Card, CardContent, CardHeader } from './ui/card';
import { Calendar } from 'lucide-react';

interface DayItineraryProps {
  day: Day;
  activityNotes?: Record<string, string>;
  onActivityNoteChange?: (activityId: string, note: string) => void;
}

export function DayItinerary({ day, activityNotes = {}, onActivityNoteChange }: DayItineraryProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-12 rounded-full bg-white shadow-sm">
            <span className="text-xl font-bold text-blue-600">D{day.day}</span>
          </div>
          <div>
            <h3 className="text-lg font-semibold">第 {day.day} 天</h3>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <Calendar className="size-4" />
              <span>{new Date(day.date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-3">
        {day.activities.map((activity) => (
          <ActivityItem
            key={activity.id}
            activity={activity}
            note={activityNotes[activity.id] || ''}
            onNoteChange={(note) => onActivityNoteChange?.(activity.id, note)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

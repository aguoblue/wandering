import { Activity } from '../data/mockPlans';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { ChevronDown, Clock, MapPin, Repeat, Lightbulb, NotebookPen } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Textarea } from './ui/textarea';

interface ActivityItemProps {
  activity: Activity;
  note?: string;
  onNoteChange?: (note: string) => void;
}

export function ActivityItem({ activity, note = '', onNoteChange }: ActivityItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const alternatives = Array.isArray(activity.alternatives) ? activity.alternatives : [];
  
  const periodColors = {
    '上午': 'bg-amber-100 text-amber-800 border-amber-300',
    '中午': 'bg-orange-100 text-orange-800 border-orange-300',
    '下午': 'bg-blue-100 text-blue-800 border-blue-300',
    '晚上': 'bg-purple-100 text-purple-800 border-purple-300',
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <motion.div 
          className="flex items-start gap-3 p-4 rounded-lg bg-card hover:bg-accent transition-colors border"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <div className="flex-shrink-0 mt-1">
            <div className={`px-3 py-1 rounded-full text-xs font-medium border ${periodColors[activity.period as keyof typeof periodColors]}`}>
              {activity.period}
            </div>
          </div>
          
          <div className="flex-1 text-left">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-semibold">{activity.title}</h4>
                <p className="text-sm text-muted-foreground mt-1">{activity.time}</p>
              </div>
              <ChevronDown className={`size-5 text-muted-foreground transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
            </div>
            <p className="text-sm text-muted-foreground mt-2">{activity.description}</p>
          </div>
        </motion.div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <motion.div 
          className="mt-2 ml-3 p-4 border border-t-0 rounded-b-lg bg-muted/30 space-y-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Lightbulb className="size-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">为什么推荐</p>
                <p className="text-sm text-muted-foreground mt-1">{activity.reason}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-2">
              <Clock className="size-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">停留时间</p>
                <p className="text-sm text-muted-foreground mt-1">{activity.duration}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-2">
              <MapPin className="size-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">交通方式</p>
                <p className="text-sm text-muted-foreground mt-1">{activity.transport}</p>
              </div>
            </div>
            
            {alternatives.length > 0 && (
              <div className="flex items-start gap-2">
                <Repeat className="size-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">替代选项</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {alternatives.map((alt, index) => (
                      <span 
                        key={index}
                        className="text-xs px-2 py-1 rounded-full bg-background border"
                      >
                        {alt}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 border-t pt-4">
            <NotebookPen className="size-4 text-slate-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">我的感受</p>
              <Textarea
                value={note}
                onChange={(event) => onNoteChange?.(event.target.value)}
                className="mt-2 min-h-24 resize-y bg-background text-sm"
                placeholder="写下这个活动的感受、踩坑、下次想怎么安排..."
              />
            </div>
          </div>
        </motion.div>
      </CollapsibleContent>
    </Collapsible>
  );
}

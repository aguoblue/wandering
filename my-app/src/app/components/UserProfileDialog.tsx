import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw, Save, UserRound } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/dialog';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import {
  getUserProfile,
  saveUserProfile,
  setUserProfileAutoUpdate,
  summarizeUserProfile,
  type UserProfile
} from '../services/userProfileClient';

function formatProfileTime(timestamp: number) {
  if (!timestamp) return '尚未更新';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function UserProfileDialog() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState('');
  const [pendingMessageCount, setPendingMessageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadProfile = async () => {
    setIsLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await getUserProfile();
      setProfile(data.profile);
      setDraft(data.profile.profileMarkdown);
      setPendingMessageCount(data.pendingMessageCount);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载用户画像失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadProfile();
  }, [open]);

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setNotice('');
    try {
      const nextProfile = await saveUserProfile(draft);
      setProfile(nextProfile);
      setDraft(nextProfile.profileMarkdown);
      setNotice(`已保存为 v${nextProfile.currentVersion}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存用户画像失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoUpdateChange = async (checked: boolean) => {
    if (!profile) return;
    setError('');
    setNotice('');
    setProfile({ ...profile, autoUpdateEnabled: checked });
    try {
      const nextProfile = await setUserProfileAutoUpdate(checked);
      setProfile(nextProfile);
      setNotice(checked ? 'AI 自动更新已开启' : 'AI 自动更新已关闭');
    } catch (nextError) {
      setProfile(profile);
      setError(nextError instanceof Error ? nextError.message : '更新自动画像开关失败');
    }
  };

  const handleSummarize = async () => {
    setIsSummarizing(true);
    setError('');
    setNotice('');
    try {
      const data = await summarizeUserProfile();
      setProfile(data.profile);
      setDraft(data.profile.profileMarkdown);
      setPendingMessageCount(0);
      setNotice(
        data.summarizedMessageCount > 0
          ? `AI 已总结 ${data.summarizedMessageCount} 条消息，生成 v${data.profile.currentVersion}`
          : '没有新的对话需要总结'
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'AI 更新用户画像失败');
    } finally {
      setIsSummarizing(false);
    }
  };

  const isBusy = isLoading || isSaving || isSummarizing;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <UserRound className="size-4" />
          用户画像
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="size-5 text-blue-600" />
            用户画像
          </DialogTitle>
          <DialogDescription>
            这份长期偏好会在对话时提供给 AI，用户当前输入仍然优先。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">
                {profile ? `当前版本 v${profile.currentVersion}` : '正在读取画像'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {profile ? `更新于 ${formatProfileTime(profile.updatedAt)} · 未总结消息 ${pendingMessageCount} 条` : ' '}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span>AI 自动更新</span>
              <Switch
                checked={Boolean(profile?.autoUpdateEnabled)}
                disabled={!profile || isBusy}
                onCheckedChange={(checked) => void handleAutoUpdateChange(checked)}
              />
            </label>
          </div>

          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={isLoading}
            className="min-h-[320px] resize-y font-mono text-sm leading-6"
            placeholder="## 基本偏好&#10;- 暂无明确长期偏好"
          />

          {(error || notice) && (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'
              }`}
            >
              {error || notice}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => void handleSummarize()} disabled={isBusy}>
              {isSummarizing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              AI 更新画像
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={isBusy}>
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

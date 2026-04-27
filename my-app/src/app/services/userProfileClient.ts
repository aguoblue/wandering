export interface UserProfile {
  userId: string;
  profileMarkdown: string;
  currentVersion: number;
  autoUpdateEnabled: boolean;
  updatedAt: number;
}

export interface UserProfileResponse {
  profile: UserProfile;
  pendingMessageCount: number;
}

function normalizeError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as { error?: string; detail?: string };
  return record.error || record.detail || fallback;
}

async function readJsonOrThrow(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(normalizeError(data, fallback));
  }
  return data;
}

export async function getUserProfile() {
  const response = await fetch('/api/user-profile');
  const data = (await readJsonOrThrow(response, '加载用户画像失败')) as UserProfileResponse;
  return data;
}

export async function saveUserProfile(profileMarkdown: string) {
  const response = await fetch('/api/user-profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ profileMarkdown })
  });
  const data = (await readJsonOrThrow(response, '保存用户画像失败')) as { profile: UserProfile };
  return data.profile;
}

export async function setUserProfileAutoUpdate(autoUpdateEnabled: boolean) {
  const response = await fetch('/api/user-profile/auto-update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ autoUpdateEnabled })
  });
  const data = (await readJsonOrThrow(response, '更新自动画像开关失败')) as { profile: UserProfile };
  return data.profile;
}

export async function summarizeUserProfile() {
  const response = await fetch('/api/user-profile/summarize', {
    method: 'POST'
  });
  const data = (await readJsonOrThrow(response, 'AI 更新用户画像失败')) as {
    profile: UserProfile;
    summarizedMessageCount: number;
  };
  return data;
}

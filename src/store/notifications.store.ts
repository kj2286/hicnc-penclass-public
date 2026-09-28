import { create } from 'zustand';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from '@/lib/api';

type NotificationsState = {
  items: NotificationRow[];
  loaded: boolean;
  unread: number;
  load: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
};

function countUnread(items: NotificationRow[]): number {
  return items.filter((n) => !n.read).length;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  loaded: false,
  unread: 0,

  load: async () => {
    try {
      const items = await listNotifications();
      set({ items, unread: countUnread(items), loaded: true });
    } catch {
      // 테이블 미생성 등은 조용히 무시(알림은 부가 기능) — 배지만 안 뜬다.
      set({ loaded: true });
    }
  },

  markRead: async (id) => {
    const items = get().items.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    );
    set({ items, unread: countUnread(items) });
    try {
      await markNotificationRead(id);
    } catch {
      /* 낙관적 업데이트 유지 */
    }
  },

  markAll: async () => {
    const items = get().items.map((n) => ({ ...n, read: true }));
    set({ items, unread: 0 });
    try {
      await markAllNotificationsRead();
    } catch {
      /* 무시 */
    }
  },
}));

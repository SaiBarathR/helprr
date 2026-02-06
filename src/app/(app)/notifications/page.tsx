'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, Check, Download, X, AlertTriangle, Clock, Settings2, Loader2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface Notification {
  id: string;
  eventType: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

function eventIcon(type: string) {
  switch (type) {
    case 'grabbed': return <Download className="h-4 w-4" />;
    case 'imported': return <Check className="h-4 w-4" />;
    case 'downloadFailed': case 'importFailed': return <X className="h-4 w-4" />;
    case 'healthWarning': return <AlertTriangle className="h-4 w-4" />;
    case 'upcomingPremiere': return <Clock className="h-4 w-4" />;
    case 'torrentAdded': return <Download className="h-4 w-4" />;
    case 'torrentCompleted': return <Check className="h-4 w-4" />;
    case 'torrentDeleted': return <Trash2 className="h-4 w-4" />;
    default: return <Bell className="h-4 w-4" />;
  }
}

function eventColor(type: string) {
  switch (type) {
    case 'grabbed': return 'bg-blue-500/10 text-blue-500';
    case 'imported': return 'bg-green-500/10 text-green-500';
    case 'downloadFailed': case 'importFailed': return 'bg-red-500/10 text-red-500';
    case 'healthWarning': return 'bg-orange-500/10 text-orange-500';
    case 'upcomingPremiere': return 'bg-purple-500/10 text-purple-500';
    case 'torrentAdded': return 'bg-cyan-500/10 text-cyan-500';
    case 'torrentCompleted': return 'bg-emerald-500/10 text-emerald-500';
    case 'torrentDeleted': return 'bg-zinc-500/10 text-zinc-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  async function fetchNotifications(p: number) {
    try {
      const res = await fetch(`/api/notifications?page=${p}&pageSize=30`);
      if (res.ok) {
        const data = await res.json();
        if (p === 1) setNotifications(data.records);
        else setNotifications((prev) => [...prev, ...data.records]);
        setTotal(data.totalRecords);
      }
    } catch { } finally { setLoading(false); }
  }

  useEffect(() => { fetchNotifications(1); }, []);

  async function markAsRead(id: string) {
    try {
      await fetch(`/api/notifications/${id}`, { method: 'PUT' });
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch { }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success('All marked as read');
    } catch { toast.error('Failed'); }
    finally { setMarkingAll(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <div className="flex flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/notifications/preferences"><Settings2 className="h-4 w-4" /> </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={markAllRead} disabled={markingAll}>
            {markingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Mark all read
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No notifications yet</p>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.read && markAsRead(n.id)}
                className={`w-full text-left flex items-start gap-3 py-3 px-3 rounded-lg transition-colors hover:bg-muted/50 ${!n.read ? 'border-l-2 border-l-primary bg-primary/5' : ''
                  }`}
              >
                <div className={`p-1.5 rounded mt-0.5 ${eventColor(n.eventType)}`}>
                  {eventIcon(n.eventType)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.read ? 'font-semibold' : ''} truncate`}>{n.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{n.body}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </span>
              </button>
            ))}
          </div>
          {notifications.length < total && (
            <Button variant="ghost" className="w-full" onClick={() => { const next = page + 1; setPage(next); fetchNotifications(next); }}>
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}

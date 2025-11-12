'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  Terminal,
  AlertTriangle,
  FolderOpen,
  Settings,
  Target,
  Upload,
  Activity,
  GitBranch,
  Network,
  Brain,
  Shield,
  Zap,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navigationSections = [
  {
    title: 'Overview',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Programs', href: '/programs', icon: FolderOpen },
      { name: 'Jobs', href: '/jobs', icon: Target },
      { name: 'Findings', href: '/findings', icon: AlertTriangle },
    ],
  },
  {
    title: 'Advanced Features',
    items: [
      { name: 'Observability', href: '/observability', icon: Activity },
      { name: 'Patterns', href: '/patterns', icon: GitBranch },
      { name: 'Agent Graph', href: '/agent-graph', icon: Network },
      { name: 'Knowledge Base', href: '/knowledge', icon: Brain },
    ],
  },
  {
    title: 'Tools',
    items: [
      { name: 'Chat (Manager AI)', href: '/chat', icon: MessageSquare },
      { name: 'Live Terminal', href: '/terminal', icon: Terminal },
      { name: 'Cert Monitor', href: '/cert-monitor', icon: Shield },
      { name: 'Upload', href: '/upload', icon: Upload },
    ],
  },
  {
    title: 'Settings',
    items: [{ name: 'Settings', href: '/settings', icon: Settings }],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-6 border-b border-border">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
          AgentHunt
        </h1>
        <p className="text-sm text-muted-foreground mt-1">AI Security Platform</p>
      </div>

      <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
        {navigationSections.map((section) => (
          <div key={section.title}>
            <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {section.title}
            </h3>
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold">
            U
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">User</p>
            <p className="text-xs text-muted-foreground truncate">user@example.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}

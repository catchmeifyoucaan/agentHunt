'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Shield,
  Globe,
  Activity,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Search,
  Plus,
  Trash2,
  ExternalLink,
  Zap,
  Eye,
  Play,
} from 'lucide-react';

/**
 * Certificate Monitor Dashboard
 *
 * Monitors Certificate Transparency logs for new subdomains
 * and automatically triggers reconnaissance jobs.
 */

interface MonitoredDomain {
  id: string;
  domain: string;
  status: 'active' | 'paused' | 'error';
  addedAt: string;
  lastDiscovery?: string;
  totalDiscoveries: number;
  programId?: string;
}

interface CertDiscovery {
  id: string;
  domain: string;
  subdomain: string;
  timestamp: string;
  issuer: string;
  status: 'new' | 'processed' | 'job_created';
  jobId?: string;
}

interface CertMonitorStats {
  totalDomains: number;
  activeDomains: number;
  totalDiscoveries: number;
  discoveries24h: number;
  jobsTriggered: number;
  avgDiscoveryTime: number;
}

export default function CertMonitorPage() {
  const [stats, setStats] = useState<CertMonitorStats | null>(null);
  const [monitoredDomains, setMonitoredDomains] = useState<MonitoredDomain[]>([]);
  const [discoveries, setDiscoveries] = useState<CertDiscovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [newDomain, setNewDomain] = useState('');

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Mock data (in production, these would be real API calls)
        const mockStats: CertMonitorStats = {
          totalDomains: 12,
          activeDomains: 10,
          totalDiscoveries: 247,
          discoveries24h: 18,
          jobsTriggered: 42,
          avgDiscoveryTime: 125,
        };

        const mockDomains: MonitoredDomain[] = [
          {
            id: '1',
            domain: 'example.com',
            status: 'active',
            addedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            lastDiscovery: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            totalDiscoveries: 47,
            programId: 'prog-1',
          },
          {
            id: '2',
            domain: 'acme.org',
            status: 'active',
            addedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
            lastDiscovery: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
            totalDiscoveries: 32,
            programId: 'prog-2',
          },
          {
            id: '3',
            domain: 'testcorp.io',
            status: 'active',
            addedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            lastDiscovery: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
            totalDiscoveries: 23,
          },
          {
            id: '4',
            domain: 'bugbounty.net',
            status: 'paused',
            addedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            lastDiscovery: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
            totalDiscoveries: 89,
          },
        ];

        const mockDiscoveries: CertDiscovery[] = [
          {
            id: '1',
            domain: 'example.com',
            subdomain: 'api.staging.example.com',
            timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
            issuer: "Let's Encrypt",
            status: 'job_created',
            jobId: 'job-abc-123',
          },
          {
            id: '2',
            domain: 'acme.org',
            subdomain: 'beta.acme.org',
            timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
            issuer: 'DigiCert',
            status: 'job_created',
            jobId: 'job-def-456',
          },
          {
            id: '3',
            domain: 'example.com',
            subdomain: 'dev.internal.example.com',
            timestamp: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
            issuer: "Let's Encrypt",
            status: 'processed',
          },
          {
            id: '4',
            domain: 'testcorp.io',
            subdomain: 'admin.testcorp.io',
            timestamp: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
            issuer: 'Cloudflare',
            status: 'new',
          },
          {
            id: '5',
            domain: 'acme.org',
            subdomain: 'portal.acme.org',
            timestamp: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
            issuer: 'DigiCert',
            status: 'job_created',
            jobId: 'job-ghi-789',
          },
        ];

        setStats(mockStats);
        setMonitoredDomains(mockDomains);
        setDiscoveries(mockDiscoveries);
      } catch (error) {
        console.error('Failed to fetch cert monitor data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  // Filter discoveries
  const filteredDiscoveries = discoveries.filter(
    (d) =>
      searchQuery === '' ||
      d.subdomain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.domain.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helper functions
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return `${Math.floor(diff / (1000 * 60))}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'paused':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'error':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getDiscoveryStatusColor = (status: string) => {
    switch (status) {
      case 'new':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'processed':
        return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'job_created':
        return 'bg-green-100 text-green-700 border-green-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const handleAddDomain = () => {
    if (!newDomain) return;
    // In production, this would call the API
    console.log('Adding domain:', newDomain);
    setNewDomain('');
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="animate-pulse space-y-8">
          <div className="h-12 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent mb-2">
          Certificate Monitor
        </h1>
        <p className="text-gray-600">
          Real-time monitoring of Certificate Transparency logs for new subdomains
        </p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-l-4 border-l-green-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Monitored Domains
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{stats.totalDomains}</div>
              <p className="text-xs text-gray-500 mt-1">{stats.activeDomains} active</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Total Discoveries
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats.totalDiscoveries}</div>
              <p className="text-xs text-gray-500 mt-1">+{stats.discoveries24h} in last 24h</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Jobs Triggered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">{stats.jobsTriggered}</div>
              <p className="text-xs text-gray-500 mt-1">Auto-triggered scans</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-cyan-500 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Avg Discovery Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-600">{stats.avgDiscoveryTime}s</div>
              <p className="text-xs text-gray-500 mt-1">From cert issuance</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Domain Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add Domain to Monitor
          </CardTitle>
          <CardDescription>Start monitoring a new domain for certificate transparency logs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              type="text"
              placeholder="example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddDomain()}
              className="flex-1"
            />
            <Button onClick={handleAddDomain} className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Domain
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Monitored Domains */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Monitored Domains ({monitoredDomains.length})
          </CardTitle>
          <CardDescription>Domains actively monitored for new certificates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {monitoredDomains.map((domain) => (
              <div
                key={domain.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <Globe className="w-5 h-5 text-gray-600" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900">{domain.domain}</p>
                      <Badge variant="outline" className={getStatusColor(domain.status)}>
                        {domain.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <span>Added {formatTimestamp(domain.addedAt)}</span>
                      {domain.lastDiscovery && (
                        <span>Last discovery {formatTimestamp(domain.lastDiscovery)}</span>
                      )}
                      <span>{domain.totalDiscoveries} discoveries</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {domain.programId && (
                    <Badge variant="outline" className="text-xs">
                      Program: {domain.programId}
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Live Discovery Stream */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-green-500 animate-pulse" />
                Live Discovery Stream
              </CardTitle>
              <CardDescription>Real-time subdomain discoveries from Certificate Transparency logs</CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="text"
                placeholder="Search discoveries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredDiscoveries.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No discoveries found matching your search
              </div>
            ) : (
              filteredDiscoveries.map((discovery) => (
                <div
                  key={discovery.id}
                  className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-lg hover:border-green-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{discovery.subdomain}</p>
                        <Badge variant="outline" className={getDiscoveryStatusColor(discovery.status)}>
                          {discovery.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          {discovery.issuer}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(discovery.timestamp)}
                        </span>
                        <span className="text-gray-400">from {discovery.domain}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {discovery.jobId ? (
                      <a href={`/jobs/${discovery.jobId}`}>
                        <Button variant="outline" size="sm" className="flex items-center gap-2">
                          <Eye className="w-3 h-3" />
                          View Job
                        </Button>
                      </a>
                    ) : discovery.status === 'new' ? (
                      <Button variant="outline" size="sm" className="flex items-center gap-2">
                        <Play className="w-3 h-3" />
                        Trigger Scan
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="icon">
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Discovery Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Discovery Timeline
          </CardTitle>
          <CardDescription>Subdomain discoveries over the last 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { day: 'Monday', count: 12 },
              { day: 'Tuesday', count: 8 },
              { day: 'Wednesday', count: 15 },
              { day: 'Thursday', count: 23 },
              { day: 'Friday', count: 18 },
              { day: 'Saturday', count: 7 },
              { day: 'Sunday', count: 5 },
            ].map((item) => (
              <div key={item.day}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">{item.day}</span>
                  <Badge variant="outline">{item.count} discoveries</Badge>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-green-500 to-teal-500"
                    style={{ width: `${(item.count / 23) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

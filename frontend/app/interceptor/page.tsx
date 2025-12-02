'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  Pause,
  Trash2,
  Send,
  Download,
  Upload,
  Settings,
  Shield,
  Zap,
  Globe,
  Code,
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronDown,
  Copy,
  RefreshCw,
  Filter,
  Search,
  MoreVertical,
  Terminal,
  Database,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Layers,
  GitCompare,
  Target,
  Crosshair,
  Radio,
  Wifi,
  Server,
} from 'lucide-react';

// Types
interface InterceptedRequest {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  statusCode?: number;
  responseTime?: number;
  contentType?: string;
  size?: number;
}

interface ProxyStatus {
  running: boolean;
  port?: number;
  intercepting?: boolean;
  requestCount?: number;
}

interface AttackResult {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'error';
  progress: number;
  requestCount: number;
  findings: number;
}

// Tab Components
type TabId = 'proxy' | 'history' | 'repeater' | 'intruder' | 'scanner' | 'graphql' | 'comparer' | 'settings';

export default function InterceptorPage() {
  const [activeTab, setActiveTab] = useState<TabId>('proxy');
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>({ running: false });
  const [interceptEnabled, setInterceptEnabled] = useState(false);
  const [requests, setRequests] = useState<InterceptedRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<InterceptedRequest | null>(null);
  const [pendingRequest, setPendingRequest] = useState<InterceptedRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMethod, setFilterMethod] = useState<string>('all');

  // Repeater state
  const [repeaterTabs, setRepeaterTabs] = useState<Array<{ id: string; name: string; request: string; response: string }>>([]);
  const [activeRepeaterTab, setActiveRepeaterTab] = useState<string | null>(null);

  // Intruder state
  const [intruderRequest, setIntruderRequest] = useState('');
  const [intruderPayloads, setIntruderPayloads] = useState('');
  const [attackResults, setAttackResults] = useState<AttackResult[]>([]);
  const [attackRunning, setAttackRunning] = useState(false);

  // GraphQL state
  const [graphqlUrl, setGraphqlUrl] = useState('');
  const [graphqlQuery, setGraphqlQuery] = useState('');
  const [graphqlResult, setGraphqlResult] = useState('');
  const [graphqlSchema, setGraphqlSchema] = useState<any>(null);

  // WebSocket for real-time updates
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to interceptor WebSocket
    const ws = new WebSocket(`ws://localhost:3000/ws/interceptor`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'request':
          setRequests(prev => [data.payload, ...prev].slice(0, 1000));
          break;
        case 'intercept-request':
          setPendingRequest(data.payload);
          break;
        case 'proxy-status':
          setProxyStatus(data.payload);
          break;
        case 'attack-progress':
          setAttackResults(prev => 
            prev.map(a => a.id === data.payload.id ? { ...a, ...data.payload } : a)
          );
          break;
      }
    };

    wsRef.current = ws;

    return () => ws.close();
  }, []);

  // API calls
  const startProxy = async () => {
    try {
      const res = await fetch('/api/v1/interceptor/proxy/start', { method: 'POST' });
      const data = await res.json();
      setProxyStatus({ running: true, ...data });
    } catch (error) {
      console.error('Failed to start proxy:', error);
    }
  };

  const stopProxy = async () => {
    try {
      await fetch('/api/v1/interceptor/proxy/stop', { method: 'POST' });
      setProxyStatus({ running: false });
    } catch (error) {
      console.error('Failed to stop proxy:', error);
    }
  };

  const toggleIntercept = async () => {
    try {
      await fetch('/api/v1/interceptor/intercept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !interceptEnabled }),
      });
      setInterceptEnabled(!interceptEnabled);
    } catch (error) {
      console.error('Failed to toggle intercept:', error);
    }
  };

  const forwardRequest = async () => {
    if (!pendingRequest) return;
    try {
      await fetch(`/api/v1/interceptor/forward/${pendingRequest.id}`, { method: 'POST' });
      setPendingRequest(null);
    } catch (error) {
      console.error('Failed to forward request:', error);
    }
  };

  const dropRequest = async () => {
    if (!pendingRequest) return;
    try {
      await fetch(`/api/v1/interceptor/drop/${pendingRequest.id}`, { method: 'POST' });
      setPendingRequest(null);
    } catch (error) {
      console.error('Failed to drop request:', error);
    }
  };

  const sendToRepeater = (request: InterceptedRequest) => {
    const newTab = {
      id: `repeater-${Date.now()}`,
      name: `${request.method} ${request.path.substring(0, 20)}`,
      request: formatRequest(request),
      response: '',
    };
    setRepeaterTabs(prev => [...prev, newTab]);
    setActiveRepeaterTab(newTab.id);
    setActiveTab('repeater');
  };

  const sendToIntruder = (request: InterceptedRequest) => {
    setIntruderRequest(formatRequest(request));
    setActiveTab('intruder');
  };

  const formatRequest = (req: InterceptedRequest): string => {
    let formatted = `${req.method} ${req.path} HTTP/1.1\r\n`;
    formatted += `Host: ${req.host}\r\n`;
    Object.entries(req.headers || {}).forEach(([key, value]) => {
      if (key.toLowerCase() !== 'host') {
        formatted += `${key}: ${value}\r\n`;
      }
    });
    formatted += '\r\n';
    if (req.body) {
      formatted += req.body;
    }
    return formatted;
  };

  const runIntruderAttack = async () => {
    setAttackRunning(true);
    const payloads = intruderPayloads.split('\n').filter(p => p.trim());
    
    try {
      const res = await fetch('/api/v1/interceptor/intruder/attack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: intruderRequest,
          payloads,
          config: { type: 'race', useSinglePacket: true },
        }),
      });
      const result = await res.json();
      setAttackResults(prev => [...prev, result]);
    } catch (error) {
      console.error('Attack failed:', error);
    } finally {
      setAttackRunning(false);
    }
  };

  const introspectGraphQL = async () => {
    try {
      const res = await fetch('/api/v1/interceptor/graphql/introspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: graphqlUrl }),
      });
      const schema = await res.json();
      setGraphqlSchema(schema);
    } catch (error) {
      console.error('Introspection failed:', error);
    }
  };

  const executeGraphQL = async () => {
    try {
      const res = await fetch('/api/v1/interceptor/graphql/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: graphqlUrl, query: graphqlQuery }),
      });
      const result = await res.json();
      setGraphqlResult(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('GraphQL query failed:', error);
    }
  };

  // Filter requests
  const filteredRequests = requests.filter(req => {
    if (filterMethod !== 'all' && req.method !== filterMethod) return false;
    if (searchQuery && !req.url.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-orange-500" />
              <h1 className="text-xl font-bold">AgentHunt Interceptor</h1>
            </div>
            <span className="text-xs bg-orange-600 px-2 py-0.5 rounded">PRO</span>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Proxy Status */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${proxyStatus.running ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-400">
                Proxy: {proxyStatus.running ? `Running on :${proxyStatus.port || 8080}` : 'Stopped'}
              </span>
            </div>
            
            {/* Proxy Controls */}
            <div className="flex items-center gap-2">
              {proxyStatus.running ? (
                <button
                  onClick={stopProxy}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm"
                >
                  <Pause className="w-4 h-4" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={startProxy}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm"
                >
                  <Play className="w-4 h-4" />
                  Start
                </button>
              )}
              
              <button
                onClick={toggleIntercept}
                className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${
                  interceptEnabled 
                    ? 'bg-orange-600 hover:bg-orange-700' 
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {interceptEnabled ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                Intercept: {interceptEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-gray-900 border-b border-gray-800">
        <div className="flex">
          {[
            { id: 'proxy', label: 'Proxy', icon: Radio },
            { id: 'history', label: 'HTTP History', icon: Clock },
            { id: 'repeater', label: 'Repeater', icon: RefreshCw },
            { id: 'intruder', label: 'Intruder', icon: Zap },
            { id: 'scanner', label: 'Scanner', icon: Target },
            { id: 'graphql', label: 'GraphQL', icon: Database },
            { id: 'comparer', label: 'Comparer', icon: GitCompare },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabId)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-orange-500 text-orange-500 bg-gray-800/50'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/30'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1">
        {/* Proxy Tab - Intercept View */}
        {activeTab === 'proxy' && (
          <div className="h-[calc(100vh-120px)] flex flex-col">
            {pendingRequest ? (
              <div className="flex-1 flex flex-col">
                {/* Intercepted Request Header */}
                <div className="bg-orange-900/30 border-b border-orange-800 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                    <span className="font-medium">Request Intercepted</span>
                    <span className="text-sm text-gray-400">
                      {pendingRequest.method} {pendingRequest.host}{pendingRequest.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={forwardRequest}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm"
                    >
                      <Send className="w-4 h-4" />
                      Forward
                    </button>
                    <button
                      onClick={dropRequest}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm"
                    >
                      <XCircle className="w-4 h-4" />
                      Drop
                    </button>
                  </div>
                </div>
                
                {/* Request Editor */}
                <div className="flex-1 p-4">
                  <textarea
                    className="w-full h-full bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm resize-none focus:outline-none focus:border-orange-500"
                    value={formatRequest(pendingRequest)}
                    onChange={(e) => {
                      // Parse and update pending request
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">
                    {interceptEnabled 
                      ? 'Waiting for requests to intercept...' 
                      : 'Intercept is disabled. Enable it to capture requests.'}
                  </p>
                  <p className="text-sm mt-2">
                    Configure your browser to use proxy at 127.0.0.1:{proxyStatus.port || 8080}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* HTTP History Tab */}
        {activeTab === 'history' && (
          <div className="h-[calc(100vh-120px)] flex">
            {/* Request List */}
            <div className="w-1/2 border-r border-gray-800 flex flex-col">
              {/* Filters */}
              <div className="p-3 border-b border-gray-800 flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Filter by URL..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-orange-500"
                  />
                </div>
                <select
                  value={filterMethod}
                  onChange={(e) => setFilterMethod(e.target.value)}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="all">All Methods</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              
              {/* Request Table */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-800 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-400">#</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400">Method</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400">Host</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400">Path</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-400">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req, index) => (
                      <tr
                        key={req.id}
                        onClick={() => setSelectedRequest(req)}
                        className={`cursor-pointer border-b border-gray-800 hover:bg-gray-800/50 ${
                          selectedRequest?.id === req.id ? 'bg-gray-800' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            req.method === 'GET' ? 'bg-green-900 text-green-300' :
                            req.method === 'POST' ? 'bg-blue-900 text-blue-300' :
                            req.method === 'PUT' ? 'bg-yellow-900 text-yellow-300' :
                            req.method === 'DELETE' ? 'bg-red-900 text-red-300' :
                            'bg-gray-700 text-gray-300'
                          }`}>
                            {req.method}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-300 truncate max-w-[150px]">{req.host}</td>
                        <td className="px-3 py-2 text-gray-300 truncate max-w-[200px]">{req.path}</td>
                        <td className="px-3 py-2">
                          {req.statusCode && (
                            <span className={`${
                              req.statusCode < 300 ? 'text-green-400' :
                              req.statusCode < 400 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {req.statusCode}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{req.responseTime}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* Request/Response Detail */}
            <div className="w-1/2 flex flex-col">
              {selectedRequest ? (
                <>
                  {/* Actions */}
                  <div className="p-3 border-b border-gray-800 flex items-center gap-2">
                    <button
                      onClick={() => sendToRepeater(selectedRequest)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Send to Repeater
                    </button>
                    <button
                      onClick={() => sendToIntruder(selectedRequest)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                    >
                      <Zap className="w-4 h-4" />
                      Send to Intruder
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(formatRequest(selectedRequest))}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </button>
                  </div>
                  
                  {/* Request/Response Tabs */}
                  <div className="flex-1 overflow-auto">
                    <div className="p-4">
                      <h3 className="text-sm font-medium text-gray-400 mb-2">Request</h3>
                      <pre className="bg-gray-900 border border-gray-700 rounded p-4 font-mono text-sm overflow-auto max-h-[300px]">
                        {formatRequest(selectedRequest)}
                      </pre>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <p>Select a request to view details</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Repeater Tab */}
        {activeTab === 'repeater' && (
          <div className="h-[calc(100vh-120px)] flex flex-col">
            {/* Repeater Tabs */}
            <div className="flex items-center border-b border-gray-800 bg-gray-900">
              {repeaterTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveRepeaterTab(tab.id)}
                  className={`px-4 py-2 text-sm border-r border-gray-800 ${
                    activeRepeaterTab === tab.id
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:bg-gray-800/50'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
              <button
                onClick={() => {
                  const newTab = {
                    id: `repeater-${Date.now()}`,
                    name: `New Request`,
                    request: 'GET / HTTP/1.1\r\nHost: example.com\r\n\r\n',
                    response: '',
                  };
                  setRepeaterTabs(prev => [...prev, newTab]);
                  setActiveRepeaterTab(newTab.id);
                }}
                className="px-4 py-2 text-gray-500 hover:text-white"
              >
                +
              </button>
            </div>
            
            {/* Active Repeater Content */}
            {activeRepeaterTab && (
              <div className="flex-1 flex">
                {/* Request Editor */}
                <div className="w-1/2 border-r border-gray-800 flex flex-col">
                  <div className="p-3 border-b border-gray-800 flex items-center justify-between">
                    <span className="text-sm font-medium">Request</span>
                    <button
                      onClick={async () => {
                        const tab = repeaterTabs.find(t => t.id === activeRepeaterTab);
                        if (!tab) return;
                        
                        try {
                          const res = await fetch('/api/v1/interceptor/repeater/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ request: tab.request }),
                          });
                          const response = await res.text();
                          setRepeaterTabs(prev =>
                            prev.map(t => t.id === activeRepeaterTab ? { ...t, response } : t)
                          );
                        } catch (error) {
                          console.error('Send failed:', error);
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 rounded text-sm"
                    >
                      <Send className="w-4 h-4" />
                      Send
                    </button>
                  </div>
                  <textarea
                    className="flex-1 bg-gray-900 p-4 font-mono text-sm resize-none focus:outline-none"
                    value={repeaterTabs.find(t => t.id === activeRepeaterTab)?.request || ''}
                    onChange={(e) => {
                      setRepeaterTabs(prev =>
                        prev.map(t => t.id === activeRepeaterTab ? { ...t, request: e.target.value } : t)
                      );
                    }}
                  />
                </div>
                
                {/* Response Viewer */}
                <div className="w-1/2 flex flex-col">
                  <div className="p-3 border-b border-gray-800">
                    <span className="text-sm font-medium">Response</span>
                  </div>
                  <pre className="flex-1 bg-gray-900 p-4 font-mono text-sm overflow-auto">
                    {repeaterTabs.find(t => t.id === activeRepeaterTab)?.response || 'No response yet'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Intruder Tab */}
        {activeTab === 'intruder' && (
          <div className="h-[calc(100vh-120px)] flex flex-col">
            <div className="flex-1 flex">
              {/* Request with Payload Positions */}
              <div className="w-1/2 border-r border-gray-800 flex flex-col">
                <div className="p-3 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-sm font-medium">Request Template</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Mark positions with §payload§</span>
                  </div>
                </div>
                <textarea
                  className="flex-1 bg-gray-900 p-4 font-mono text-sm resize-none focus:outline-none"
                  placeholder="GET /api/user/§id§ HTTP/1.1&#10;Host: example.com&#10;&#10;"
                  value={intruderRequest}
                  onChange={(e) => setIntruderRequest(e.target.value)}
                />
              </div>
              
              {/* Payloads */}
              <div className="w-1/2 flex flex-col">
                <div className="p-3 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-sm font-medium">Payloads</span>
                  <div className="flex items-center gap-2">
                    <select className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm">
                      <option>Simple list</option>
                      <option>Numbers</option>
                      <option>Bruteforce</option>
                    </select>
                  </div>
                </div>
                <textarea
                  className="flex-1 bg-gray-900 p-4 font-mono text-sm resize-none focus:outline-none"
                  placeholder="Enter payloads (one per line)&#10;1&#10;2&#10;3&#10;admin&#10;test"
                  value={intruderPayloads}
                  onChange={(e) => setIntruderPayloads(e.target.value)}
                />
              </div>
            </div>
            
            {/* Attack Controls */}
            <div className="p-4 border-t border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <select className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm">
                    <option value="race">Race Condition (Single Packet)</option>
                    <option value="parallel">Parallel</option>
                    <option value="sequential">Sequential</option>
                    <option value="pitchfork">Pitchfork</option>
                    <option value="clusterbomb">Cluster Bomb</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="rounded" defaultChecked />
                    Use Last-Byte Sync
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="rounded" />
                    Use HTTP/2
                  </label>
                </div>
                <button
                  onClick={runIntruderAttack}
                  disabled={attackRunning}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 rounded font-medium"
                >
                  {attackRunning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Start Attack
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GraphQL Tab */}
        {activeTab === 'graphql' && (
          <div className="h-[calc(100vh-120px)] flex flex-col">
            {/* URL Input */}
            <div className="p-4 border-b border-gray-800 flex items-center gap-3">
              <input
                type="text"
                placeholder="GraphQL Endpoint URL"
                value={graphqlUrl}
                onChange={(e) => setGraphqlUrl(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500"
              />
              <button
                onClick={introspectGraphQL}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded"
              >
                <Database className="w-4 h-4" />
                Introspect
              </button>
              <button
                onClick={() => {/* Scan for vulns */}}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded"
              >
                <Target className="w-4 h-4" />
                Scan
              </button>
            </div>
            
            <div className="flex-1 flex">
              {/* Schema Explorer */}
              <div className="w-1/4 border-r border-gray-800 overflow-auto">
                <div className="p-3 border-b border-gray-800">
                  <span className="text-sm font-medium">Schema</span>
                </div>
                {graphqlSchema ? (
                  <div className="p-3 text-sm">
                    <div className="mb-4">
                      <h4 className="text-gray-400 mb-2">Queries</h4>
                      {/* Schema tree would go here */}
                      <p className="text-gray-500">Schema loaded</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-gray-500 text-sm">
                    Run introspection to load schema
                  </div>
                )}
              </div>
              
              {/* Query Editor */}
              <div className="w-1/2 border-r border-gray-800 flex flex-col">
                <div className="p-3 border-b border-gray-800 flex items-center justify-between">
                  <span className="text-sm font-medium">Query</span>
                  <button
                    onClick={executeGraphQL}
                    className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 rounded text-sm"
                  >
                    <Play className="w-4 h-4" />
                    Execute
                  </button>
                </div>
                <textarea
                  className="flex-1 bg-gray-900 p-4 font-mono text-sm resize-none focus:outline-none"
                  placeholder="{ __typename }"
                  value={graphqlQuery}
                  onChange={(e) => setGraphqlQuery(e.target.value)}
                />
              </div>
              
              {/* Response */}
              <div className="w-1/4 flex flex-col">
                <div className="p-3 border-b border-gray-800">
                  <span className="text-sm font-medium">Response</span>
                </div>
                <pre className="flex-1 bg-gray-900 p-4 font-mono text-xs overflow-auto">
                  {graphqlResult || 'Execute a query to see results'}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Scanner Tab */}
        {activeTab === 'scanner' && (
          <div className="h-[calc(100vh-120px)] p-6">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-xl font-bold mb-6">Active Scanner</h2>
              
              <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">Target URL</label>
                    <input
                      type="text"
                      placeholder="https://example.com"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Scan Type</label>
                    <select className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500">
                      <option>Full Scan</option>
                      <option>Quick Scan</option>
                      <option>SQL Injection Only</option>
                      <option>XSS Only</option>
                      <option>Authentication Tests</option>
                    </select>
                  </div>
                </div>
                
                <div className="mt-6">
                  <label className="block text-sm font-medium mb-2">Scan Types</label>
                  <div className="flex flex-wrap gap-3">
                    {['SQLi', 'XSS', 'SSRF', 'IDOR', 'Auth Bypass', 'Info Disclosure', 'GraphQL'].map(type => (
                      <label key={type} className="flex items-center gap-2 px-3 py-2 bg-gray-800 rounded cursor-pointer hover:bg-gray-700">
                        <input type="checkbox" defaultChecked className="rounded" />
                        <span className="text-sm">{type}</span>
                      </label>
                    ))}
                  </div>
                </div>
                
                <div className="mt-6 flex justify-end">
                  <button className="flex items-center gap-2 px-6 py-2 bg-orange-600 hover:bg-orange-700 rounded font-medium">
                    <Target className="w-4 h-4" />
                    Start Scan
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="h-[calc(100vh-120px)] p-6 overflow-auto">
            <div className="max-w-4xl mx-auto space-y-6">
              <h2 className="text-xl font-bold">Interceptor Settings</h2>
              
              {/* Proxy Settings */}
              <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
                <h3 className="text-lg font-medium mb-4">Proxy Settings</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Listen Port</label>
                    <input
                      type="number"
                      defaultValue={8080}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Listen Interface</label>
                    <select className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500">
                      <option>127.0.0.1 (Loopback only)</option>
                      <option>0.0.0.0 (All interfaces)</option>
                    </select>
                  </div>
                </div>
                
                <div className="mt-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked className="rounded" />
                    <span className="text-sm">Enable SSL/TLS Interception</span>
                  </label>
                </div>
                
                <div className="mt-4">
                  <button className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
                    <Download className="w-4 h-4" />
                    Download CA Certificate
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    Install this certificate in your browser to intercept HTTPS traffic
                  </p>
                </div>
              </div>
              
              {/* Upstream Proxy */}
              <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
                <h3 className="text-lg font-medium mb-4">Upstream Proxy</h3>
                <label className="flex items-center gap-2 mb-4">
                  <input type="checkbox" className="rounded" />
                  <span className="text-sm">Use upstream proxy</span>
                </label>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-2">Proxy Host</label>
                    <input
                      type="text"
                      placeholder="127.0.0.1"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Port</label>
                    <input
                      type="number"
                      placeholder="8081"
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>
              
              {/* Performance */}
              <div className="bg-gray-900 rounded-lg p-6 border border-gray-800">
                <h3 className="text-lg font-medium mb-4">Performance</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Max History Size</label>
                    <input
                      type="number"
                      defaultValue={10000}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Request Timeout (ms)</label>
                    <input
                      type="number"
                      defaultValue={30000}
                      className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

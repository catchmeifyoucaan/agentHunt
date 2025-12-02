'use client';

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { managerApi, programsApi } from '@/lib/api';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actions?: any[];
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content:
        "👋 Hi! I'm the AgentHunt Manager AI. I can help you orchestrate security scans with natural language commands.\n\nTry saying:\n- \"Start discovery for program [name] using chaosdb and subfinder\"\n- \"Run nuclei scan on all alive hosts\"\n- \"Show me the status of program [name]\"\n- \"Pause all fuzzing templates for program [name]\"",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [selectedProgram, setSelectedProgram] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: programsData } = useQuery({
    queryKey: ['programs'],
    queryFn: () => programsApi.list(),
  });

  const sendCommandMutation = useMutation({
    mutationFn: (command: string) =>
      managerApi.sendCommand({
        command,
        program_id: selectedProgram || undefined,
        user_id: 'web-user',
      }),
    onSuccess: (response) => {
      const data = response.data;
      setMessages((prev) => [
        ...prev,
        {
          id: data.id,
          role: 'assistant',
          content: data.response,
          timestamp: new Date(data.timestamp),
          actions: data.executedActions,
        },
      ]);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to send command');
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `❌ Error: ${error.response?.data?.error || 'Failed to process command'}`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    sendCommandMutation.mutate(input);
    setInput('');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const programs = programsData?.data?.programs || [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Manager AI Chat</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Conversational security testing orchestration
            </p>
          </div>
          <div className="w-64">
            <select
              value={selectedProgram}
              onChange={(e) => setSelectedProgram(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Programs</option>
              {programs.map((program: any) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message flex gap-3 ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            {message.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
            )}

            <div
              className={`max-w-2xl rounded-lg p-4 ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border'
              }`}
            >
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>

              {message.actions && message.actions.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium mb-2">Executed Actions:</p>
                  <div className="space-y-1">
                    {message.actions.map((action: any, i: number) => (
                      <div key={i} className="text-xs bg-accent/50 px-2 py-1 rounded">
                        <span className="font-mono">{action.type}</span>
                        {action.result && (
                          <span className="text-muted-foreground ml-2">
                            ✓ {JSON.stringify(action.result).substring(0, 50)}...
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground mt-2">
                {message.timestamp.toLocaleTimeString()}
              </p>
            </div>

            {message.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {sendCommandMutation.isPending && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-6 border-t border-border bg-card">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command... (e.g., Start discovery for program X)"
            className="flex-1 px-4 py-3 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={sendCommandMutation.isPending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sendCommandMutation.isPending}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {sendCommandMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            'Show status',
            'Start discovery',
            'Run httpx scan',
            'List recent findings',
          ].map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setInput(suggestion)}
              className="text-xs px-3 py-1 bg-accent hover:bg-accent/80 rounded-full transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

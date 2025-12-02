/**
 * LLM Engine Type Definitions
 * Central types for all LLM-powered features
 */

export interface LLMConfig {
  provider: 'claude' | 'openai' | 'gemini' | 'local' | 'serverless' | 'grok' | 'bedrock';
  model: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  cached?: boolean;
}

export interface ReasoningResult {
  reasoning: string;
  actions: Action[];
  code?: string;
  confidence: number;
  alternatives?: Array<{
    reasoning: string;
    confidence: number;
  }>;
}

export interface Action {
  type: string;
  tool?: string;
  parameters?: Record<string, any>;
  reasoning?: string;
}

export interface ExploitGenerationRequest {
  vulnerability: {
    type: string;
    target: string;
    parameter?: string;
    context: string;
  };
  environment?: {
    waf?: string;
    ips?: string;
    framework?: string;
  };
  requirements?: {
    stealthy?: boolean;
    reliable?: boolean;
    customized?: boolean;
  };
}

export interface NucleiTemplateRequest {
  serviceName: string;
  port?: number;
  vulnerability: {
    type: string;
    description: string;
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    indicators: string[];
  };
  testEndpoint?: string;
}

export interface CodeGenerationRequest {
  purpose: string;
  language: 'python' | 'javascript' | 'go' | 'bash';
  requirements: string[];
  context?: Record<string, any>;
}

export interface EnsembleReasoningResult extends ReasoningResult {
  consensus: number; // 0-1, how much models agree
  models: Array<{
    provider: string;
    model: string;
    result: ReasoningResult;
    confidence: number;
  }>;
}

/**
 * Session & Credential Manager
 * Handles authenticated testing with cookie jars, OAuth flows, JWT manipulation
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../utils/logger';
import database from './database';
import cache from './cache';

export interface Credential {
  id: string;
  programId: string;
  name: string;
  type: 'basic' | 'bearer' | 'api_key' | 'oauth2' | 'cookie' | 'custom';
  data: CredentialData;
  scope?: string[]; // Which endpoints/domains this credential applies to
  expiresAt?: Date;
  lastUsed?: Date;
  isValid: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialData {
  // Basic Auth
  username?: string;
  password?: string;

  // Bearer Token
  token?: string;

  // API Key
  apiKey?: string;
  apiKeyHeader?: string; // e.g., 'X-API-Key', 'Authorization'

  // OAuth2
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenUrl?: string;
  authUrl?: string;
  scopes?: string[];

  // Cookies
  cookies?: CookieEntry[];

  // Custom headers
  headers?: Record<string, string>;
}

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface AuthenticatedSession {
  id: string;
  programId: string;
  credentialId: string;
  cookieJar: CookieEntry[];
  headers: Record<string, string>;
  csrfToken?: string;
  lastActivity: Date;
  requestCount: number;
  isActive: boolean;
}

export interface LoginFlow {
  id: string;
  name: string;
  type: 'form' | 'oauth2' | 'saml' | 'api' | 'custom';
  steps: LoginStep[];
}

export interface LoginStep {
  order: number;
  action: 'navigate' | 'fill' | 'click' | 'wait' | 'extract' | 'request';
  target?: string; // URL or selector
  data?: Record<string, string>;
  extractTo?: string; // Variable name to store extracted value
  waitMs?: number;
}

// Encryption key for storing sensitive credentials
const ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'default-key-change-in-production';

class SessionManagerService {
  private static instance: SessionManagerService;
  private sessions: Map<string, AuthenticatedSession> = new Map();
  private credentialCache: Map<string, Credential> = new Map();

  private constructor() {}

  public static getInstance(): SessionManagerService {
    if (!SessionManagerService.instance) {
      SessionManagerService.instance = new SessionManagerService();
    }
    return SessionManagerService.instance;
  }

  // ============ Credential Management ============

  /**
   * Store a credential securely
   */
  public async storeCredential(
    programId: string,
    name: string,
    type: Credential['type'],
    data: CredentialData,
    options: {
      scope?: string[];
      expiresAt?: Date;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<Credential> {
    const id = uuidv4();
    const now = new Date();

    // Encrypt sensitive data
    const encryptedData = this.encryptData(data);

    const credential: Credential = {
      id,
      programId,
      name,
      type,
      data, // Keep plaintext in memory
      scope: options.scope,
      expiresAt: options.expiresAt,
      isValid: true,
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now,
    };

    // Store in database with encrypted data
    await database.query(
      `INSERT INTO credentials (id, program_id, name, type, encrypted_data, scope, expires_at, is_valid, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         encrypted_data = $5, scope = $6, expires_at = $7, is_valid = $8, metadata = $9, updated_at = $11`,
      [
        id,
        programId,
        name,
        type,
        encryptedData,
        JSON.stringify(options.scope || []),
        options.expiresAt,
        true,
        JSON.stringify(options.metadata || {}),
        now,
        now,
      ]
    );

    // Cache in memory
    this.credentialCache.set(id, credential);

    logger.info({ credentialId: id, programId, type, name }, 'Credential stored');
    return credential;
  }

  /**
   * Get credential by ID
   */
  public async getCredential(credentialId: string): Promise<Credential | null> {
    // Check cache
    if (this.credentialCache.has(credentialId)) {
      return this.credentialCache.get(credentialId)!;
    }

    // Load from database
    const result = await database.query(
      `SELECT * FROM credentials WHERE id = $1 AND is_valid = true`,
      [credentialId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const decryptedData = this.decryptData(row.encrypted_data);

    const credential: Credential = {
      id: row.id,
      programId: row.program_id,
      name: row.name,
      type: row.type,
      data: decryptedData,
      scope: JSON.parse(row.scope || '[]'),
      expiresAt: row.expires_at,
      lastUsed: row.last_used,
      isValid: row.is_valid,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    // Cache
    this.credentialCache.set(credentialId, credential);

    return credential;
  }

  /**
   * Get all credentials for a program
   */
  public async getProgramCredentials(programId: string): Promise<Credential[]> {
    const result = await database.query(
      `SELECT * FROM credentials WHERE program_id = $1 AND is_valid = true ORDER BY created_at DESC`,
      [programId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      programId: row.program_id,
      name: row.name,
      type: row.type,
      data: this.decryptData(row.encrypted_data),
      scope: JSON.parse(row.scope || '[]'),
      expiresAt: row.expires_at,
      lastUsed: row.last_used,
      isValid: row.is_valid,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Invalidate a credential
   */
  public async invalidateCredential(credentialId: string): Promise<void> {
    await database.query(
      `UPDATE credentials SET is_valid = false, updated_at = NOW() WHERE id = $1`,
      [credentialId]
    );

    this.credentialCache.delete(credentialId);
    logger.info({ credentialId }, 'Credential invalidated');
  }

  // ============ Session Management ============

  /**
   * Create an authenticated session
   */
  public async createSession(
    programId: string,
    credentialId: string
  ): Promise<AuthenticatedSession> {
    const credential = await this.getCredential(credentialId);
    if (!credential) {
      throw new Error(`Credential ${credentialId} not found`);
    }

    const session: AuthenticatedSession = {
      id: uuidv4(),
      programId,
      credentialId,
      cookieJar: credential.data.cookies || [],
      headers: this.buildAuthHeaders(credential),
      lastActivity: new Date(),
      requestCount: 0,
      isActive: true,
    };

    this.sessions.set(session.id, session);

    logger.info(
      { sessionId: session.id, programId, credentialType: credential.type },
      'Authenticated session created'
    );

    return session;
  }

  /**
   * Get session by ID
   */
  public getSession(sessionId: string): AuthenticatedSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Update session cookies
   */
  public updateSessionCookies(sessionId: string, cookies: CookieEntry[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Merge cookies (update existing, add new)
    for (const newCookie of cookies) {
      const existingIndex = session.cookieJar.findIndex(
        (c) => c.name === newCookie.name && c.domain === newCookie.domain
      );

      if (existingIndex >= 0) {
        session.cookieJar[existingIndex] = newCookie;
      } else {
        session.cookieJar.push(newCookie);
      }
    }

    session.lastActivity = new Date();
  }

  /**
   * Get cookies for a specific domain
   */
  public getSessionCookies(sessionId: string, domain: string): CookieEntry[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return session.cookieJar.filter((cookie) => {
      // Match exact domain or subdomain
      return domain === cookie.domain || domain.endsWith(`.${cookie.domain}`);
    });
  }

  /**
   * Get cookie header string for requests
   */
  public getCookieHeader(sessionId: string, domain: string): string {
    const cookies = this.getSessionCookies(sessionId, domain);
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Set CSRF token for session
   */
  public setCSRFToken(sessionId: string, token: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.csrfToken = token;
    }
  }

  /**
   * Record request activity
   */
  public recordRequest(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.requestCount++;
      session.lastActivity = new Date();
    }
  }

  /**
   * End session
   */
  public endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      logger.info(
        { sessionId, requestCount: session.requestCount },
        'Authenticated session ended'
      );
      this.sessions.delete(sessionId);
    }
  }

  // ============ OAuth2 Flows ============

  /**
   * Refresh OAuth2 token
   */
  public async refreshOAuth2Token(credentialId: string): Promise<string | null> {
    const credential = await this.getCredential(credentialId);
    if (!credential || credential.type !== 'oauth2') {
      return null;
    }

    const { refreshToken, tokenUrl, clientId, clientSecret } = credential.data;
    if (!refreshToken || !tokenUrl) {
      logger.warn({ credentialId }, 'Missing refresh token or token URL');
      return null;
    }

    try {
      const axios = require('axios');
      const response = await axios.post(tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const newAccessToken = response.data.access_token;
      const newRefreshToken = response.data.refresh_token || refreshToken;

      // Update credential
      credential.data.accessToken = newAccessToken;
      credential.data.refreshToken = newRefreshToken;

      await this.storeCredential(
        credential.programId,
        credential.name,
        credential.type,
        credential.data,
        {
          scope: credential.scope,
          expiresAt: response.data.expires_in
            ? new Date(Date.now() + response.data.expires_in * 1000)
            : undefined,
        }
      );

      logger.info({ credentialId }, 'OAuth2 token refreshed');
      return newAccessToken;
    } catch (error: any) {
      logger.error({ error: error.message, credentialId }, 'Failed to refresh OAuth2 token');
      return null;
    }
  }

  // ============ JWT Manipulation ============

  /**
   * Decode JWT without verification (for analysis)
   */
  public decodeJWT(token: string): {
    header: Record<string, any>;
    payload: Record<string, any>;
    signature: string;
  } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      return {
        header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()),
        payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()),
        signature: parts[2],
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if JWT is expired
   */
  public isJWTExpired(token: string): boolean {
    const decoded = this.decodeJWT(token);
    if (!decoded || !decoded.payload.exp) return false;

    return decoded.payload.exp * 1000 < Date.now();
  }

  /**
   * Generate JWT test variations (for security testing)
   */
  public generateJWTTestVariations(token: string): string[] {
    const decoded = this.decodeJWT(token);
    if (!decoded) return [];

    const variations: string[] = [];

    // 1. Algorithm confusion (none)
    const noneHeader = { ...decoded.header, alg: 'none' };
    variations.push(
      `${Buffer.from(JSON.stringify(noneHeader)).toString('base64url')}.${Buffer.from(JSON.stringify(decoded.payload)).toString('base64url')}.`
    );

    // 2. Algorithm confusion (HS256 with public key as secret - if RS256)
    if (decoded.header.alg === 'RS256') {
      const hs256Header = { ...decoded.header, alg: 'HS256' };
      variations.push(
        `${Buffer.from(JSON.stringify(hs256Header)).toString('base64url')}.${Buffer.from(JSON.stringify(decoded.payload)).toString('base64url')}.test`
      );
    }

    // 3. Modified claims
    const modifiedPayload = { ...decoded.payload };

    // Try admin escalation
    if (modifiedPayload.role) {
      modifiedPayload.role = 'admin';
      variations.push(this.createUnsignedJWT(decoded.header, modifiedPayload));
    }

    // Try user ID manipulation
    if (modifiedPayload.sub) {
      modifiedPayload.sub = '1'; // Try first user
      variations.push(this.createUnsignedJWT(decoded.header, modifiedPayload));
    }

    // Extend expiration
    modifiedPayload.exp = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 year
    variations.push(this.createUnsignedJWT(decoded.header, modifiedPayload));

    return variations;
  }

  // ============ Login Flow Automation ============

  /**
   * Execute a login flow (requires Puppeteer)
   */
  public async executeLoginFlow(
    flow: LoginFlow,
    credentials: Record<string, string>
  ): Promise<{
    success: boolean;
    cookies?: CookieEntry[];
    tokens?: Record<string, string>;
    error?: string;
  }> {
    // This would use Puppeteer for browser-based flows
    // For now, return a placeholder
    logger.info({ flowId: flow.id, flowType: flow.type }, 'Executing login flow');

    try {
      // Placeholder for actual implementation
      // In production, this would:
      // 1. Launch headless browser
      // 2. Execute each step in the flow
      // 3. Extract cookies and tokens
      // 4. Return results

      return {
        success: false,
        error: 'Login flow automation requires Puppeteer integration',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ============ Private Methods ============

  private buildAuthHeaders(credential: Credential): Record<string, string> {
    const headers: Record<string, string> = {};

    switch (credential.type) {
      case 'basic':
        if (credential.data.username && credential.data.password) {
          const encoded = Buffer.from(
            `${credential.data.username}:${credential.data.password}`
          ).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;

      case 'bearer':
        if (credential.data.token) {
          headers['Authorization'] = `Bearer ${credential.data.token}`;
        }
        break;

      case 'api_key':
        if (credential.data.apiKey) {
          const header = credential.data.apiKeyHeader || 'X-API-Key';
          headers[header] = credential.data.apiKey;
        }
        break;

      case 'oauth2':
        if (credential.data.accessToken) {
          headers['Authorization'] = `Bearer ${credential.data.accessToken}`;
        }
        break;

      case 'custom':
        if (credential.data.headers) {
          Object.assign(headers, credential.data.headers);
        }
        break;
    }

    return headers;
  }

  private encryptData(data: CredentialData): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
  }

  private decryptData(encryptedData: string): CredentialData {
    try {
      const [ivHex, encrypted] = encryptedData.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (error) {
      logger.error({ error }, 'Failed to decrypt credential data');
      return {};
    }
  }

  private createUnsignedJWT(
    header: Record<string, any>,
    payload: Record<string, any>
  ): string {
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${headerB64}.${payloadB64}.`;
  }

  /**
   * Clear expired sessions
   */
  public cleanupExpiredSessions(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > maxAgeMs) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up expired sessions');
    }

    return cleaned;
  }
}

export default SessionManagerService.getInstance();

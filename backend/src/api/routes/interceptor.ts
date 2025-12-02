/**
 * Interceptor API Routes
 * 
 * REST API for the AgentHunt Interceptor (Burp Suite Pro alternative)
 */

import { Router, Request, Response } from 'express';
import { interceptor } from '../../services/interceptor';
import logger from '../../utils/logger';

const router = Router();

// ============================================
// Proxy Management
// ============================================

/**
 * Start the intercepting proxy
 */
router.post('/proxy/start', async (req: Request, res: Response) => {
  try {
    const { port, host, enableSsl } = req.body;
    await interceptor.startProxy({ port, host, enableSsl });
    const status = interceptor.getProxyStatus();
    res.json({ success: true, ...status });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start proxy');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Stop the intercepting proxy
 */
router.post('/proxy/stop', async (req: Request, res: Response) => {
  try {
    await interceptor.stopProxy();
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to stop proxy');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get proxy status
 */
router.get('/proxy/status', (req: Request, res: Response) => {
  const status = interceptor.getProxyStatus();
  res.json(status);
});

/**
 * Get CA certificate for SSL interception
 */
router.get('/proxy/ca-certificate', (req: Request, res: Response) => {
  const cert = interceptor.getCACertificate();
  if (cert) {
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.setHeader('Content-Disposition', 'attachment; filename="agenthunt-ca.pem"');
    res.send(cert);
  } else {
    res.status(404).json({ error: 'Proxy not running' });
  }
});

// ============================================
// Interception Control
// ============================================

/**
 * Toggle interception mode
 */
router.post('/intercept', (req: Request, res: Response) => {
  const { enabled } = req.body;
  interceptor.setInterceptionEnabled(enabled);
  res.json({ success: true, intercepting: enabled });
});

/**
 * Forward an intercepted request
 */
router.post('/forward/:requestId', (req: Request, res: Response) => {
  const { requestId } = req.params;
  const { modified } = req.body;
  interceptor.forwardRequest(requestId, modified);
  res.json({ success: true });
});

/**
 * Drop an intercepted request
 */
router.post('/drop/:requestId', (req: Request, res: Response) => {
  const { requestId } = req.params;
  interceptor.dropRequest(requestId);
  res.json({ success: true });
});

/**
 * Get interception rules
 */
router.get('/rules', (req: Request, res: Response) => {
  const rules = interceptor.getInterceptionRules();
  res.json(rules);
});

/**
 * Add interception rule
 */
router.post('/rules', (req: Request, res: Response) => {
  const rule = req.body;
  interceptor.addInterceptionRule(rule);
  res.json({ success: true });
});

/**
 * Delete interception rule
 */
router.delete('/rules/:ruleId', (req: Request, res: Response) => {
  const { ruleId } = req.params;
  interceptor.removeInterceptionRule(ruleId);
  res.json({ success: true });
});

// ============================================
// History
// ============================================

/**
 * Get request/response history
 */
router.get('/history', (req: Request, res: Response) => {
  const { limit = 100, offset = 0, method, host, search } = req.query;
  let history = interceptor.getHistory();

  // Apply filters
  if (method && method !== 'all') {
    history.requests = history.requests.filter(r => r.method === method);
  }
  if (host) {
    history.requests = history.requests.filter(r => r.host.includes(host as string));
  }
  if (search) {
    history.requests = history.requests.filter(r => 
      r.url.toLowerCase().includes((search as string).toLowerCase())
    );
  }

  // Paginate
  const total = history.requests.length;
  history.requests = history.requests.slice(Number(offset), Number(offset) + Number(limit));

  res.json({ ...history, total, limit: Number(limit), offset: Number(offset) });
});

/**
 * Get specific request
 */
router.get('/history/request/:requestId', (req: Request, res: Response) => {
  const { requestId } = req.params;
  const request = interceptor.getRequest(requestId);
  if (request) {
    res.json(request);
  } else {
    res.status(404).json({ error: 'Request not found' });
  }
});

/**
 * Get specific response
 */
router.get('/history/response/:requestId', (req: Request, res: Response) => {
  const { requestId } = req.params;
  const response = interceptor.getResponse(requestId);
  if (response) {
    res.json(response);
  } else {
    res.status(404).json({ error: 'Response not found' });
  }
});

/**
 * Clear history
 */
router.delete('/history', (req: Request, res: Response) => {
  interceptor.clearHistory();
  res.json({ success: true });
});

// ============================================
// Repeater
// ============================================

/**
 * Get all repeater requests
 */
router.get('/repeater', (req: Request, res: Response) => {
  const requests = interceptor.getRepeaterRequests();
  res.json(requests);
});

/**
 * Add request to repeater
 */
router.post('/repeater', (req: Request, res: Response) => {
  const { request, name } = req.body;
  const id = interceptor.addToRepeater(request, name);
  res.json({ success: true, id });
});

/**
 * Send repeater request
 */
router.post('/repeater/send', async (req: Request, res: Response) => {
  try {
    const { repeaterId, request, modifications } = req.body;
    
    // If raw request string provided, parse it
    if (request && typeof request === 'string') {
      // Parse raw HTTP request
      const lines = request.split('\r\n');
      const [method, path] = lines[0].split(' ');
      const headers: Record<string, string> = {};
      let bodyStart = 0;
      
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '') {
          bodyStart = i + 1;
          break;
        }
        const [key, ...valueParts] = lines[i].split(':');
        if (key) {
          headers[key.trim()] = valueParts.join(':').trim();
        }
      }
      
      const host = headers['Host'] || headers['host'] || 'localhost';
      const body = lines.slice(bodyStart).join('\r\n');
      
      // Create a temporary repeater entry and send
      const tempId = interceptor.addToRepeater({
        id: '',
        timestamp: new Date(),
        method,
        url: `https://${host}${path}`,
        host,
        port: 443,
        path,
        httpVersion: '1.1',
        headers,
        body: Buffer.from(body),
        cookies: {},
        queryParams: {},
        isHttps: true,
        clientIp: 'localhost',
        modified: false,
      });
      
      const response = await interceptor.sendRepeaterRequest(tempId);
      
      if (response) {
        // Format response as raw HTTP
        let rawResponse = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`;
        Object.entries(response.headers).forEach(([key, value]) => {
          rawResponse += `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`;
        });
        rawResponse += '\r\n';
        rawResponse += response.bodyText || '';
        
        res.send(rawResponse);
      } else {
        res.status(500).json({ error: 'Request failed' });
      }
    } else if (repeaterId) {
      const response = await interceptor.sendRepeaterRequest(repeaterId, modifications);
      if (response) {
        res.json(response);
      } else {
        res.status(500).json({ error: 'Request failed' });
      }
    } else {
      res.status(400).json({ error: 'Missing request or repeaterId' });
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Repeater send failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete repeater request
 */
router.delete('/repeater/:repeaterId', (req: Request, res: Response) => {
  const { repeaterId } = req.params;
  const deleted = interceptor.deleteRepeaterRequest(repeaterId);
  res.json({ success: deleted });
});

// ============================================
// Intruder (Turbo Intruder)
// ============================================

/**
 * Run intruder attack
 */
router.post('/intruder/attack', async (req: Request, res: Response) => {
  try {
    const { request, payloads, config } = req.body;
    
    // Parse request if string
    let turboRequest;
    if (typeof request === 'string') {
      const lines = request.split('\r\n');
      const [method, path] = lines[0].split(' ');
      const headers: Record<string, string> = {};
      let bodyStart = 0;
      
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '') {
          bodyStart = i + 1;
          break;
        }
        const [key, ...valueParts] = lines[i].split(':');
        if (key) {
          headers[key.trim()] = valueParts.join(':').trim();
        }
      }
      
      const host = headers['Host'] || headers['host'] || 'localhost';
      const body = lines.slice(bodyStart).join('\r\n');
      
      turboRequest = {
        id: '',
        method,
        url: `https://${host}${path}`,
        headers,
        body,
      };
    } else {
      turboRequest = request;
    }
    
    const result = await interceptor.runRaceConditionAttack(turboRequest, payloads, config);
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Intruder attack failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Run parallel fuzzing attack
 */
router.post('/intruder/fuzz', async (req: Request, res: Response) => {
  try {
    const { request, payloadSets, config } = req.body;
    const result = await interceptor.runParallelFuzz(request, payloadSets, config);
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Fuzzing attack failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cancel attack
 */
router.post('/intruder/cancel/:attackId', (req: Request, res: Response) => {
  const { attackId } = req.params;
  const cancelled = interceptor.cancelAttack(attackId);
  res.json({ success: cancelled });
});

/**
 * Get active attacks
 */
router.get('/intruder/active', (req: Request, res: Response) => {
  const attacks = interceptor.getActiveAttacks();
  res.json(attacks);
});

// ============================================
// GraphQL
// ============================================

/**
 * Introspect GraphQL endpoint
 */
router.post('/graphql/introspect', async (req: Request, res: Response) => {
  try {
    const { url, headers } = req.body;
    const schema = await interceptor.introspectGraphQL(url, headers);
    res.json(schema);
  } catch (error: any) {
    logger.error({ error: error.message }, 'GraphQL introspection failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Scan GraphQL endpoint for vulnerabilities
 */
router.post('/graphql/scan', async (req: Request, res: Response) => {
  try {
    const { url, headers } = req.body;
    const result = await interceptor.scanGraphQL(url, headers);
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, 'GraphQL scan failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Execute GraphQL query
 */
router.post('/graphql/execute', async (req: Request, res: Response) => {
  try {
    const { url, query, variables, headers } = req.body;
    const result = await interceptor.executeGraphQLQuery(url, query, variables, headers);
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, 'GraphQL query failed');
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Scanner
// ============================================

/**
 * Start active scan
 */
router.post('/scanner/start', async (req: Request, res: Response) => {
  try {
    const config = req.body;
    const scanId = await interceptor.startScan(config);
    res.json({ success: true, scanId });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Scanner start failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get scan status
 */
router.get('/scanner/:scanId', (req: Request, res: Response) => {
  const { scanId } = req.params;
  const scan = interceptor.getScan(scanId);
  if (scan) {
    res.json(scan);
  } else {
    res.status(404).json({ error: 'Scan not found' });
  }
});

/**
 * Get active scans
 */
router.get('/scanner', (req: Request, res: Response) => {
  const scans = interceptor.getActiveScans();
  res.json(scans);
});

/**
 * Cancel scan
 */
router.post('/scanner/:scanId/cancel', (req: Request, res: Response) => {
  const { scanId } = req.params;
  const cancelled = interceptor.cancelScan(scanId);
  res.json({ success: cancelled });
});

// ============================================
// Comparer
// ============================================

/**
 * Add item to comparer
 */
router.post('/comparer', (req: Request, res: Response) => {
  const { type, content, label } = req.body;
  const id = interceptor.addToComparer({ type, content, label });
  res.json({ success: true, id });
});

/**
 * Get comparer items
 */
router.get('/comparer', (req: Request, res: Response) => {
  const items = interceptor.getComparerItems();
  res.json(items);
});

/**
 * Compare two items
 */
router.post('/comparer/compare', (req: Request, res: Response) => {
  const { id1, id2 } = req.body;
  const result = interceptor.compareItems(id1, id2);
  res.json(result);
});

/**
 * Clear comparer
 */
router.delete('/comparer', (req: Request, res: Response) => {
  interceptor.clearComparer();
  res.json({ success: true });
});

// ============================================
// Session Data
// ============================================

/**
 * Get extracted session data (cookies, tokens, auth headers)
 */
router.get('/session', (req: Request, res: Response) => {
  const sessionData = interceptor.getSessionData();
  res.json(sessionData);
});

// ============================================
// Statistics
// ============================================

/**
 * Get interceptor statistics
 */
router.get('/stats', (req: Request, res: Response) => {
  const stats = interceptor.getStats();
  res.json(stats);
});

/**
 * Reset statistics
 */
router.post('/stats/reset', (req: Request, res: Response) => {
  interceptor.resetStats();
  res.json({ success: true });
});

export default router;

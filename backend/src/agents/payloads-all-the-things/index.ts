/**
 * PayloadsAllTheThings Agent Collection
 * 
 * NEW agents based on PayloadsAllTheThings that DON'T already exist in the main agents folder.
 * These complement the existing agents with additional payloads and techniques.
 * 
 * EXISTING AGENTS (in ../):
 * - idor.ts, race-condition.ts, cors.ts, xxe.ts, subdomain-takeover.ts
 * - graphql.ts, jwt-attack.ts, prototype-pollution.ts, template-injection.ts
 * - request-smuggling.ts, deserialization.ts, oauth.ts, cache-poisoning.ts
 */

// Clickjacking (NEW)
export { ClickjackingAgent } from './clickjacking';
export { default as clickjacking } from './clickjacking';

// DNS Rebinding (NEW)
export { DNSRebindingAgent } from './dns-rebinding';
export { default as dnsRebinding } from './dns-rebinding';

// CRLF Injection (NEW)
export { CRLFInjectionAgent } from './crlf-injection';
export { default as crlfInjection } from './crlf-injection';

// Open Redirect (NEW)
export { OpenRedirectAgent } from './open-redirect';
export { default as openRedirect } from './open-redirect';

// LFI/RFI (NEW)
export { LFIRFIAgent } from './lfi-rfi';
export { default as lfiRfi } from './lfi-rfi';

// NoSQL Injection (NEW)
export { NoSQLInjectionAgent } from './nosql-injection';
export { default as nosqlInjection } from './nosql-injection';

// Host Header Injection (NEW)
export { HostHeaderInjectionAgent } from './host-header-injection';
export { default as hostHeaderInjection } from './host-header-injection';

// CSV Injection (NEW)
export { CSVInjectionAgent } from './csv-injection';
export { default as csvInjection } from './csv-injection';

// LDAP Injection (NEW)
export { LDAPInjectionAgent } from './ldap-injection';
export { default as ldapInjection } from './ldap-injection';

// SAML Injection (NEW)
export { SAMLInjectionAgent } from './saml-injection';
export { default as samlInjection } from './saml-injection';

// Web Cache Deception (NEW - different from cache-poisoning)
export { WebCacheDeceptionAgent } from './web-cache-deception';
export { default as webCacheDeception } from './web-cache-deception';

// Mass Assignment (NEW)
export { MassAssignmentAgent } from './mass-assignment';
export { default as massAssignment } from './mass-assignment';

// HTTP Parameter Pollution (NEW)
export { HTTPParameterPollutionAgent } from './http-parameter-pollution';
export { default as httpParameterPollution } from './http-parameter-pollution';

// LaTeX Injection (NEW)
export { LaTeXInjectionAgent } from './latex-injection';
export { default as latexInjection } from './latex-injection';

// XPath Injection (NEW)
export { XPathInjectionAgent } from './xpath-injection';
export { default as xpathInjection } from './xpath-injection';

// Command Injection (NEW)
export { CommandInjectionAgent } from './command-injection';
export { default as commandInjection } from './command-injection';

// File Upload (NEW)
export { FileUploadAgent } from './file-upload';
export { default as fileUpload } from './file-upload';

/**
 * Agent Registry for PayloadsAllTheThings (only NEW agents)
 */
export const PATT_AGENTS = {
  'clickjacking': () => import('./clickjacking'),
  'dns-rebinding': () => import('./dns-rebinding'),
  'crlf-injection': () => import('./crlf-injection'),
  'open-redirect': () => import('./open-redirect'),
  'lfi-rfi': () => import('./lfi-rfi'),
  'nosql-injection': () => import('./nosql-injection'),
  'host-header': () => import('./host-header-injection'),
  'csv-injection': () => import('./csv-injection'),
  'ldap-injection': () => import('./ldap-injection'),
  'saml-injection': () => import('./saml-injection'),
  'web-cache-deception': () => import('./web-cache-deception'),
  'mass-assignment': () => import('./mass-assignment'),
  'http-parameter-pollution': () => import('./http-parameter-pollution'),
  'latex-injection': () => import('./latex-injection'),
  'xpath-injection': () => import('./xpath-injection'),
  'command-injection': () => import('./command-injection'),
  'file-upload': () => import('./file-upload'),
};

export function getPATTAgentTypes(): string[] {
  return Object.keys(PATT_AGENTS);
}

export async function loadPATTAgent(type: string): Promise<any> {
  const loader = PATT_AGENTS[type as keyof typeof PATT_AGENTS];
  if (!loader) throw new Error(`Unknown PATT agent type: ${type}`);
  return loader();
}

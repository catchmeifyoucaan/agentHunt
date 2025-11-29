/**
 * Subdomain Enumeration Workflow
 * Complete pipeline from domain discovery to fingerprinting
 */

import { AgentWorkflow } from '../../../shared/agent-collaboration.types';

export const subdomainEnumerationWorkflow: AgentWorkflow = {
  name: 'subdomain-enumeration',
  version: '1.0.0',
  description: 'Complete subdomain enumeration pipeline with DNS resolution and fingerprinting',

  trigger: {
    on: 'job:complete',
    when: (context: any) => {
      return context.agentType === 'discovery' &&
             context.result &&
             context.result.domains &&
             context.result.domains.length > 0;
    },
    filters: {
      agentType: 'discovery'
    }
  },

  steps: [
    {
      id: 'passive-subdomain',
      name: 'Enhanced passive subdomain discovery',
      agent: 'discovery', // Updated from 'subdomain' - now uses merged discovery agent
      input: (ctx: any) => ({
        programId: ctx.programId,
        domains: ctx.result.domains,
        options: {
          sources: ['chaosdb', 'subfinder', 'uncover', 'cloudlist'], // All passive sources
          maxAssets: 10000
        }
      }),
      output: 'passiveSubdomains',
      parallel: false,
      timeout: 600, // 10 minutes
      dependencies: []
    },

    {
      id: 'bruteforce-subdomain',
      name: 'DNS bruteforce (if enabled)',
      agent: 'bruteforce',
      input: (ctx: any) => ({
        programId: ctx.programId,
        domains: ctx.result.domains,
        wordlists: ['top10000'],
        useMassdns: true
      }),
      output: 'bruteforceSubdomains',
      parallel: false,
      timeout: 900, // 15 minutes
      dependencies: ['passive-subdomain']
    },

    {
      id: 'merge-subdomains',
      name: 'Merge and deduplicate subdomains',
      agent: 'multi',
      input: (ctx: any) => {
        const allSubdomains = [
          ...(ctx.passiveSubdomains?.subdomains || []),
          ...(ctx.bruteforceSubdomains?.subdomains || [])
        ];
        const unique = [...new Set(allSubdomains)];
        return { subdomains: unique };
      },
      output: 'allSubdomains',
      parallel: false,
      dependencies: ['passive-subdomain', 'bruteforce-subdomain']
    },

    {
      id: 'parallel-recon',
      name: 'Parallel HTTP fingerprinting and port scanning',
      agent: 'multi',
      input: (ctx: any) => ({
        jobs: [
          {
            type: 'fingerprint',
            input: {
              programId: ctx.programId,
              assets: ctx.allSubdomains.subdomains,
              tools: ['dnsx', 'httpx']
            }
          },
          {
            type: 'portscan',
            input: {
              programId: ctx.programId,
              targets: ctx.allSubdomains.subdomains,
              ports: 'top1000',
              useMasscan: true
            }
          }
        ]
      }),
      output: 'reconResults',
      parallel: true,
      timeout: 1800, // 30 minutes
      dependencies: ['merge-subdomains']
    }
  ],

  errorHandling: {
    onStepFailure: 'continue', // Don't stop workflow if one step fails
    onCriticalFailure: 'rollback',
    notifyOn: ['critical-failure'],
    fallback: undefined
  },

  metadata: {
    author: 'AgentHunt',
    category: 'reconnaissance',
    tags: ['subdomain', 'dns', 'enumeration'],
    estimatedDuration: 2700 // ~45 minutes
  }
};

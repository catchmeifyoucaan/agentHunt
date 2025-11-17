/**
 * Researcher Agent - Validation Layer
 * Multi-reviewer validation system
 * PoC generation and attack chain discovery
 * Knowledge base updates
 */

import logger from '../../utils/logger';
import llmEngine from '../llm/llm-engine';
import { sharedMemory } from './shared-memory';
import sandboxExecutor from '../sandbox/sandbox-executor';
import {
  Finding,
  Review,
  ValidationResult,
  AttackChain,
  KnowledgeUpdate,
} from './types';
import { v4 as uuidv4 } from 'uuid';

export class ResearcherAgent {
  private validationCache: Map<string, ValidationResult> = new Map();
  private knowledgeBase: Map<string, any> = new Map();

  /**
   * Validate finding with multi-reviewer system
   * 5 specialized reviewers for comprehensive validation
   */
  async validateFinding(finding: Finding): Promise<ValidationResult> {
    logger.info({ findingId: finding.id, type: finding.type }, 'Validating finding');

    try {
      // Check cache
      if (this.validationCache.has(finding.id)) {
        return this.validationCache.get(finding.id)!;
      }

      // Run 5 specialized reviews in parallel
      const reviewPromises = [
        this.technicalReview(finding),
        this.exploitabilityReview(finding),
        this.impactReview(finding),
        this.falsePositiveReview(finding),
        this.businessReview(finding),
      ];

      const reviews = await Promise.all(reviewPromises);

      // Calculate overall confidence (weighted average)
      const weights = {
        technical: 0.3,
        exploitability: 0.25,
        impact: 0.2,
        false_positive: 0.2,
        business: 0.05,
      };

      let overallConfidence = 0;
      reviews.forEach(review => {
        overallConfidence += review.confidence * (weights[review.reviewer] || 0.2);
      });

      // Determine if finding is valid
      const validVotes = reviews.filter(r => r.verdict === 'valid').length;
      const invalidVotes = reviews.filter(r => r.verdict === 'invalid').length;
      const valid = validVotes > invalidVotes;

      // Calculate exploitability and impact
      const exploitabilityReview = reviews.find(r => r.reviewer === 'exploitability');
      const impactReviewData = reviews.find(r => r.reviewer === 'impact');

      const exploitability = exploitabilityReview?.metadata?.score || 0.5;
      const impact = impactReviewData?.metadata?.score || 0.5;

      // Adjust severity if needed
      let adjustedSeverity = finding.severity;
      if (exploitability < 0.3 || impact < 0.3) {
        // Downgrade severity if hard to exploit or low impact
        const severityLevels = ['info', 'low', 'medium', 'high', 'critical'];
        const currentIndex = severityLevels.indexOf(finding.severity);
        if (currentIndex > 0) {
          adjustedSeverity = severityLevels[currentIndex - 1] as any;
        }
      }

      // Generate PoC if valid and exploitable
      let poc: string | undefined;
      let pocVerified = false;
      if (valid && exploitability > 0.6) {
        try {
          const pocResult = await this.generatePoC(finding);
          poc = pocResult.poc;
          pocVerified = pocResult.verified;
        } catch (error) {
          logger.error({ error, findingId: finding.id }, 'PoC generation failed');
        }
      }

      // Generate recommendations
      const recommendations = this.generateRecommendations(finding, reviews);

      const validation: ValidationResult = {
        findingId: finding.id,
        valid,
        confidence: overallConfidence,
        reviews,
        poc,
        pocVerified,
        severity: finding.severity,
        adjustedSeverity: adjustedSeverity !== finding.severity ? adjustedSeverity : undefined,
        exploitability,
        impact,
        recommendations,
        timestamp: new Date(),
      };

      // Cache result
      this.validationCache.set(finding.id, validation);

      logger.info(
        {
          findingId: finding.id,
          valid,
          confidence: overallConfidence.toFixed(2),
          adjustedSeverity,
        },
        'Finding validated'
      );

      return validation;
    } catch (error: any) {
      logger.error({ error, findingId: finding.id }, 'Validation failed');
      throw error;
    }
  }

  /**
   * Technical reviewer - validates technical accuracy
   */
  private async technicalReview(finding: Finding): Promise<Review> {
    const prompt = `You are a technical security reviewer. Analyze this finding for technical accuracy:

**Type:** ${finding.type}
**URL:** ${finding.url}
**Evidence:** ${finding.evidence}
**HTTP Request:** ${finding.httpRequest || 'N/A'}
**HTTP Response:** ${finding.httpResponse || 'N/A'}

Evaluate:
1. Is the technical analysis correct?
2. Is the evidence sufficient to confirm the vulnerability?
3. Are there any technical red flags suggesting false positive?

Return JSON:
{
  "verdict": "valid|invalid|uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "your analysis",
  "evidence": "supporting evidence"
}`;

    return this.executeReview(prompt, 'technical', finding);
  }

  /**
   * Exploitability reviewer - assesses how exploitable the vulnerability is
   */
  private async exploitabilityReview(finding: Finding): Promise<Review> {
    const prompt = `You are an exploitation specialist. Assess the exploitability of this finding:

**Type:** ${finding.type}
**URL:** ${finding.url}
**Evidence:** ${finding.evidence}

Evaluate:
1. How difficult is this to exploit? (0.0 = impossible, 1.0 = trivial)
2. Are there existing tools/exploits available?
3. What skill level is required?
4. Are there mitigating factors?

Return JSON:
{
  "verdict": "valid|invalid|uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "exploitation analysis",
  "metadata": {
    "score": 0.0-1.0,
    "skillRequired": "low|medium|high",
    "toolsAvailable": boolean
  }
}`;

    return this.executeReview(prompt, 'exploitability', finding);
  }

  /**
   * Impact reviewer - assesses business/security impact
   */
  private async impactReview(finding: Finding): Promise<Review> {
    const prompt = `You are a security impact analyst. Assess the impact of this vulnerability:

**Type:** ${finding.type}
**URL:** ${finding.url}
**Severity:** ${finding.severity}
**Evidence:** ${finding.evidence}

Evaluate:
1. What data could be compromised?
2. What systems could be affected?
3. What is the business impact?
4. Impact score (0.0 = no impact, 1.0 = critical impact)

Return JSON:
{
  "verdict": "valid|invalid|uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "impact analysis",
  "metadata": {
    "score": 0.0-1.0,
    "dataAtRisk": "description",
    "systemsAffected": "description"
  }
}`;

    return this.executeReview(prompt, 'impact', finding);
  }

  /**
   * False positive reviewer - checks for common false positive patterns
   */
  private async falsePositiveReview(finding: Finding): Promise<Review> {
    const prompt = `You are a false positive detection expert. Analyze this finding for false positive indicators:

**Type:** ${finding.type}
**Evidence:** ${finding.evidence}
**Confidence:** ${finding.confidence}

Check for:
1. Scanner artifacts or misinterpretations
2. Expected behavior misidentified as vulnerability
3. Lack of actual security impact
4. Common false positive patterns

Return JSON:
{
  "verdict": "valid|invalid|uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "false positive analysis",
  "metadata": {
    "falsePositiveIndicators": ["indicator1", "indicator2"]
  }
}`;

    return this.executeReview(prompt, 'false_positive', finding);
  }

  /**
   * Business reviewer - assesses from business risk perspective
   */
  private async businessReview(finding: Finding): Promise<Review> {
    const prompt = `You are a business risk analyst. Assess this vulnerability from a business perspective:

**Type:** ${finding.type}
**Severity:** ${finding.severity}
**URL:** ${finding.url}

Evaluate:
1. Business criticality of affected system
2. Regulatory/compliance implications
3. Reputational risk
4. Priority for remediation

Return JSON:
{
  "verdict": "valid|invalid|uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "business analysis",
  "metadata": {
    "businessCriticality": "low|medium|high",
    "complianceIssues": ["issue1", "issue2"]
  }
}`;

    return this.executeReview(prompt, 'business', finding);
  }

  /**
   * Execute review with LLM
   */
  private async executeReview(
    prompt: string,
    reviewer: Review['reviewer'],
    finding: Finding
  ): Promise<Review> {
    try {
      // Use Grok for fast validation, fallback to serverless
      const response = await llmEngine.complete(prompt, undefined, 'grok,serverless');

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON in review response');
      }

      const data = JSON.parse(jsonMatch[0]);

      return {
        reviewer,
        confidence: data.confidence || 0.5,
        verdict: data.verdict || 'uncertain',
        reasoning: data.reasoning || 'No reasoning provided',
        evidence: data.evidence,
        metadata: data.metadata,
      };
    } catch (error: any) {
      logger.error({ error, reviewer, findingId: finding.id }, 'Review failed');

      // Return uncertain review on failure
      return {
        reviewer,
        confidence: 0.0,
        verdict: 'uncertain',
        reasoning: `Review failed: ${error.message}`,
      };
    }
  }

  /**
   * Generate PoC for validated vulnerability
   */
  private async generatePoC(
    finding: Finding
  ): Promise<{ poc: string; verified: boolean }> {
    logger.debug({ findingId: finding.id }, 'Generating PoC');

    const pocPrompt = `You are a security researcher. Generate a proof-of-concept (PoC) for this vulnerability:

**Type:** ${finding.type}
**URL:** ${finding.url}
**Evidence:** ${finding.evidence}
**HTTP Request:** ${finding.httpRequest || 'N/A'}

Generate a step-by-step PoC that demonstrates the vulnerability:
1. Clear reproduction steps
2. Expected results
3. Actual results showing the vulnerability
4. Any required tools or payloads

Make it actionable for a security team to reproduce and validate.

Return markdown format.`;

    try {
      const poc = await llmEngine.complete(pocPrompt);

      // Try to verify PoC in sandbox (basic verification)
      let verified = false;
      if (finding.type.toLowerCase().includes('code') && poc.includes('```')) {
        try {
          // Extract code from PoC
          const codeMatch = poc.match(/```(?:python|javascript|bash)?\n([\s\S]*?)```/);
          if (codeMatch) {
            const code = codeMatch[1];
            const result = await sandboxExecutor.execute({
              code,
              config: {
                language: 'python',
                timeoutMs: 5000,
              },
            });
            verified = result.success;
          }
        } catch (error) {
          logger.debug({ error, findingId: finding.id }, 'PoC verification failed');
        }
      }

      return { poc, verified };
    } catch (error: any) {
      logger.error({ error, findingId: finding.id }, 'PoC generation failed');
      throw error;
    }
  }

  /**
   * Generate remediation recommendations
   */
  private generateRecommendations(finding: Finding, reviews: Review[]): string[] {
    const recommendations: string[] = [];

    // Base recommendations on finding type
    const typeRecommendations: Record<string, string[]> = {
      xss: [
        'Implement Content Security Policy (CSP)',
        'Encode all user input before rendering',
        'Use framework-level XSS protections',
      ],
      'sql injection': [
        'Use parameterized queries or prepared statements',
        'Implement least privilege database access',
        'Enable database query logging',
      ],
      'authentication bypass': [
        'Review authentication logic',
        'Implement multi-factor authentication',
        'Audit session management',
      ],
      'access control': [
        'Implement proper authorization checks',
        'Follow principle of least privilege',
        'Review role-based access controls',
      ],
    };

    // Add type-specific recommendations
    for (const [type, recs] of Object.entries(typeRecommendations)) {
      if (finding.type.toLowerCase().includes(type)) {
        recommendations.push(...recs);
        break;
      }
    }

    // Add severity-specific recommendations
    if (finding.severity === 'critical' || finding.severity === 'high') {
      recommendations.push('Priority remediation required');
      recommendations.push('Consider hotfix deployment');
    }

    // Add review-specific recommendations
    reviews.forEach(review => {
      if (review.verdict === 'valid' && review.metadata?.recommendations) {
        recommendations.push(...review.metadata.recommendations);
      }
    });

    // Generic recommendations
    if (recommendations.length === 0) {
      recommendations.push('Conduct thorough code review');
      recommendations.push('Update security testing coverage');
    }

    return [...new Set(recommendations)]; // Remove duplicates
  }

  /**
   * Discover attack chains from multiple findings
   * Chains vulnerabilities together for higher impact
   */
  async discoverAttackChains(findings: Finding[]): Promise<AttackChain[]> {
    logger.info({ findingsCount: findings.length }, 'Discovering attack chains');

    if (findings.length < 2) {
      return [];
    }

    try {
      const chainingPrompt = `You are an expert penetration tester. Analyze these findings to discover attack chains:

**Findings:**
${findings
  .map(
    (f, i) =>
      `${i + 1}. ${f.severity.toUpperCase()} - ${f.type} at ${f.url}\n   Evidence: ${f.evidence}`
  )
  .join('\n\n')}

Identify attack chains where multiple vulnerabilities can be combined for greater impact.

Return JSON:
{
  "chains": [
    {
      "name": "Attack chain name",
      "vulnerabilities": [0, 2, 4], // Indices from the list above
      "steps": [
        {
          "step": 1,
          "vulnerability": 0,
          "action": "What to do",
          "expectedResult": "What happens"
        }
      ],
      "combinedImpact": "Overall impact description",
      "combinedSeverity": "low|medium|high|critical",
      "estimatedExploitTime": milliseconds
    }
  ]
}`;

      const response = await llmEngine.complete(chainingPrompt);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const data = JSON.parse(jsonMatch[0]);
      const chains: AttackChain[] = (data.chains || []).map((c: any) => ({
        id: uuidv4(),
        name: c.name,
        vulnerabilities: c.vulnerabilities.map((idx: number) => findings[idx]).filter(Boolean),
        steps: c.steps.map((s: any) => ({
          step: s.step,
          vulnerability: findings[s.vulnerability],
          action: s.action,
          expectedResult: s.expectedResult,
        })),
        combinedImpact: c.combinedImpact,
        combinedSeverity: c.combinedSeverity || 'high',
        verified: false,
        estimatedExploitTime: c.estimatedExploitTime || 0,
      }));

      logger.info({ chains: chains.length }, 'Attack chains discovered');

      return chains;
    } catch (error: any) {
      logger.error({ error }, 'Attack chain discovery failed');
      return [];
    }
  }

  /**
   * Update knowledge base with new patterns and techniques
   * Learn from findings to improve future testing
   */
  async updateKnowledgeBase(
    findings: Finding[],
    validations: ValidationResult[]
  ): Promise<KnowledgeUpdate> {
    logger.info({ findings: findings.length }, 'Updating knowledge base');

    try {
      // Analyze patterns
      const patterns = this.analyzePatterns(findings);

      // Extract new techniques from validated findings
      const newTechniques = this.extractTechniques(findings, validations);

      // Identify false positive indicators
      const falsePositiveIndicators = this.extractFalsePositiveIndicators(validations);

      // Extract successful bypass methods
      const successfulBypassMethods = this.extractBypassMethods(findings);

      // Analyze target characteristics
      const targetCharacteristics = this.analyzeTargetCharacteristics(findings);

      // Generate recommendations for future testing
      const recommendations = this.generateKnowledgeRecommendations(
        patterns,
        newTechniques
      );

      const update: KnowledgeUpdate = {
        patterns,
        newTechniques,
        falsePositiveIndicators,
        successfulBypassMethods,
        targetCharacteristics,
        recommendations,
      };

      // Store in knowledge base
      this.knowledgeBase.set(`update_${Date.now()}`, update);

      logger.info(
        {
          patterns: patterns.length,
          techniques: newTechniques.length,
        },
        'Knowledge base updated'
      );

      return update;
    } catch (error: any) {
      logger.error({ error }, 'Knowledge base update failed');
      throw error;
    }
  }

  /**
   * Analyze patterns in findings
   */
  private analyzePatterns(
    findings: Finding[]
  ): Array<{ pattern: string; occurrences: number; significance: number }> {
    const patternMap = new Map<string, number>();

    // Count vulnerability types
    findings.forEach(f => {
      const count = patternMap.get(f.type) || 0;
      patternMap.set(f.type, count + 1);
    });

    // Convert to pattern array with significance
    return Array.from(patternMap.entries())
      .map(([pattern, occurrences]) => ({
        pattern,
        occurrences,
        significance: Math.min(1.0, occurrences / findings.length),
      }))
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Extract techniques from findings
   */
  private extractTechniques(
    findings: Finding[],
    validations: ValidationResult[]
  ): any[] {
    const techniques: any[] = [];

    validations
      .filter(v => v.valid && v.confidence > 0.7)
      .forEach(validation => {
        const finding = findings.find(f => f.id === validation.findingId);
        if (finding) {
          techniques.push({
            id: uuidv4(),
            name: `${finding.type} detection`,
            description: finding.evidence,
            successRate: validation.confidence,
            metadata: {
              severity: finding.severity,
              validated: true,
            },
          });
        }
      });

    return techniques;
  }

  /**
   * Extract false positive indicators
   */
  private extractFalsePositiveIndicators(validations: ValidationResult[]): string[] {
    const indicators: string[] = [];

    validations
      .filter(v => !v.valid)
      .forEach(validation => {
        const fpReview = validation.reviews.find(r => r.reviewer === 'false_positive');
        if (fpReview?.metadata?.falsePositiveIndicators) {
          indicators.push(...fpReview.metadata.falsePositiveIndicators);
        }
      });

    return [...new Set(indicators)];
  }

  /**
   * Extract bypass methods
   */
  private extractBypassMethods(findings: Finding[]): string[] {
    const methods: string[] = [];

    findings.forEach(f => {
      if (f.metadata?.bypassMethod) {
        methods.push(f.metadata.bypassMethod);
      }
    });

    return [...new Set(methods)];
  }

  /**
   * Analyze target characteristics
   */
  private analyzeTargetCharacteristics(findings: Finding[]): Record<string, any> {
    const urls = findings.map(f => f.url);
    const domains = [...new Set(urls.map(u => new URL(u).hostname))];

    return {
      totalTargets: urls.length,
      uniqueDomains: domains.length,
      vulnerabilityDensity: findings.length / domains.length,
      mostVulnerableAssets: this.findMostVulnerable(findings),
    };
  }

  /**
   * Find most vulnerable assets
   */
  private findMostVulnerable(findings: Finding[]): Array<{ url: string; count: number }> {
    const urlCounts = new Map<string, number>();

    findings.forEach(f => {
      const count = urlCounts.get(f.url) || 0;
      urlCounts.set(f.url, count + 1);
    });

    return Array.from(urlCounts.entries())
      .map(([url, count]) => ({ url, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Generate recommendations from knowledge
   */
  private generateKnowledgeRecommendations(
    patterns: Array<{ pattern: string; occurrences: number }>,
    techniques: any[]
  ): string[] {
    const recommendations: string[] = [];

    if (patterns.length > 0) {
      const topPattern = patterns[0];
      recommendations.push(
        `Focus on ${topPattern.pattern} - found in ${topPattern.occurrences} instances`
      );
    }

    if (techniques.length > 5) {
      recommendations.push(
        `${techniques.length} successful techniques identified - integrate into testing framework`
      );
    }

    return recommendations;
  }

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    total: number;
    valid: number;
    invalid: number;
    avgConfidence: number;
  } {
    const validations = Array.from(this.validationCache.values());

    return {
      total: validations.length,
      valid: validations.filter(v => v.valid).length,
      invalid: validations.filter(v => !v.valid).length,
      avgConfidence:
        validations.reduce((sum, v) => sum + v.confidence, 0) / validations.length || 0,
    };
  }
}

// Singleton instance
export const researcherAgent = new ResearcherAgent();
export default researcherAgent;

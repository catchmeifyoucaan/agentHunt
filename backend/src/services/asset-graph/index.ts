/**
 * Asset Graph Service
 * Manages asset relationships, infers connections, discovers attack paths
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type {
  Asset,
  AssetRelationship,
  RelationType,
  AssetGraph,
  AttackPath,
  Finding
} from '../../../../shared/types';
import logger from '../../utils/logger';

export class AssetGraphService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Create a relationship between two assets
   */
  async createRelationship(
    sourceAssetId: string,
    targetAssetId: string,
    relationshipType: RelationType,
    confidence: number = 1.0,
    discoveredBy: string = 'system',
    metadata: Record<string, any> = {}
  ): Promise<AssetRelationship> {
    const id = uuidv4();
    const now = new Date();

    try {
      await this.db.query(
        `INSERT INTO asset_relationships
         (id, source_asset_id, target_asset_id, relationship_type, confidence, metadata, discovered_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source_asset_id, target_asset_id, relationship_type) DO UPDATE
         SET confidence = GREATEST(asset_relationships.confidence, EXCLUDED.confidence),
             metadata = EXCLUDED.metadata`,
        [id, sourceAssetId, targetAssetId, relationshipType, confidence, JSON.stringify(metadata), discoveredBy, now]
      );

      logger.debug({
        sourceAssetId,
        targetAssetId,
        relationshipType
      }, 'Asset relationship created');

      return {
        id,
        sourceAssetId,
        targetAssetId,
        relationshipType,
        confidence,
        metadata,
        discoveredBy,
        createdAt: now
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create asset relationship');
      throw error;
    }
  }

  /**
   * Infer relationships from asset metadata
   */
  async inferRelationships(assetId: string): Promise<AssetRelationship[]> {
    const asset = await this.getAsset(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const relationships: AssetRelationship[] = [];

    // Infer subdomain relationships
    if (asset.type === 'subdomain' || asset.type === 'domain') {
      const parentDomains = this.extractParentDomains(asset.value);
      for (const parentDomain of parentDomains) {
        const parent = await this.findAssetByValue(asset.programId, parentDomain, 'domain');
        if (parent) {
          const rel = await this.createRelationship(
            assetId,
            parent.id,
            'subdomain_of',
            1.0,
            'inference:domain_hierarchy'
          );
          relationships.push(rel);
        }
      }
    }

    // Infer DNS resolution relationships
    if (asset.metadata.ipAddresses && Array.isArray(asset.metadata.ipAddresses)) {
      for (const ip of asset.metadata.ipAddresses) {
        const ipAsset = await this.findAssetByValue(asset.programId, ip, 'ip');
        if (ipAsset) {
          const rel = await this.createRelationship(
            assetId,
            ipAsset.id,
            'resolves_to',
            1.0,
            'inference:dns_resolution'
          );
          relationships.push(rel);
        }
      }
    }

    // Infer CNAME relationships
    if (asset.metadata.cnames && Array.isArray(asset.metadata.cnames)) {
      for (const cname of asset.metadata.cnames) {
        const cnameAsset = await this.findAssetByValue(asset.programId, cname, 'domain');
        if (cnameAsset) {
          const rel = await this.createRelationship(
            assetId,
            cnameAsset.id,
            'cname_to',
            1.0,
            'inference:dns_cname'
          );
          relationships.push(rel);
        }
      }
    }

    // Infer technology relationships
    if (asset.metadata.technologies && Array.isArray(asset.metadata.technologies)) {
      const techAssets = await this.findAssetsByMetadata(
        asset.programId,
        'technologies',
        asset.metadata.technologies
      );

      for (const techAsset of techAssets) {
        if (techAsset.id !== assetId) {
          const rel = await this.createRelationship(
            assetId,
            techAsset.id,
            'uses_technology',
            0.8,
            'inference:technology_fingerprint'
          );
          relationships.push(rel);
        }
      }
    }

    // Infer certificate sharing
    if (asset.metadata.certificates && Array.isArray(asset.metadata.certificates)) {
      const certAssets = await this.findAssetsByMetadata(
        asset.programId,
        'certificates',
        asset.metadata.certificates
      );

      for (const certAsset of certAssets) {
        if (certAsset.id !== assetId) {
          const rel = await this.createRelationship(
            assetId,
            certAsset.id,
            'shares_cert_with',
            0.9,
            'inference:certificate_sharing'
          );
          relationships.push(rel);
        }
      }
    }

    logger.info({ assetId, relationshipsInferred: relationships.length }, 'Relationships inferred');

    return relationships;
  }

  /**
   * Get the asset graph for a program
   */
  async getAssetGraph(programId: string): Promise<AssetGraph> {
    // Get all assets
    const assetsResult = await this.db.query(
      `SELECT * FROM assets WHERE program_id = $1`,
      [programId]
    );

    const nodes: Asset[] = assetsResult.rows.map(row => this.rowToAsset(row));

    // Get all relationships
    const relationshipsResult = await this.db.query(
      `SELECT ar.* FROM asset_relationships ar
       INNER JOIN assets a ON ar.source_asset_id = a.id
       WHERE a.program_id = $1`,
      [programId]
    );

    const edges: AssetRelationship[] = relationshipsResult.rows.map(row => ({
      id: row.id,
      sourceAssetId: row.source_asset_id,
      targetAssetId: row.target_asset_id,
      relationshipType: row.relationship_type,
      confidence: row.confidence,
      metadata: row.metadata,
      discoveredBy: row.discovered_by,
      createdAt: row.created_at
    }));

    return {
      nodes,
      edges,
      metadata: {
        lastUpdated: new Date(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    };
  }

  /**
   * Discover attack paths using graph traversal
   */
  async discoverAttackPaths(programId: string, minRiskScore: number = 5.0): Promise<AttackPath[]> {
    const graph = await this.getAssetGraph(programId);
    const findings = await this.getProgramFindings(programId);

    // Group findings by asset
    const findingsByAsset = new Map<string, Finding[]>();
    for (const finding of findings) {
      if (!findingsByAsset.has(finding.assetId)) {
        findingsByAsset.set(finding.assetId, []);
      }
      findingsByAsset.get(finding.assetId)!.push(finding);
    }

    const attackPaths: AttackPath[] = [];

    // Find assets with critical/high findings as potential starting points
    const vulnerableAssets = graph.nodes.filter(node =>
      findingsByAsset.has(node.id) &&
      findingsByAsset.get(node.id)!.some(f => f.severity === 'critical' || f.severity === 'high')
    );

    // For each vulnerable asset, explore paths to high-value targets
    for (const startAsset of vulnerableAssets) {
      const paths = this.findPaths(graph, startAsset.id, 5); // Max depth 5

      for (const path of paths) {
        const pathFindings = this.collectPathFindings(path, findingsByAsset);
        const riskScore = this.calculatePathRiskScore(path, pathFindings);

        if (riskScore >= minRiskScore) {
          const attackPath: AttackPath = {
            id: uuidv4(),
            startAssetId: startAsset.id,
            endAssetId: path[path.length - 1].targetAssetId,
            hops: path,
            findings: pathFindings,
            riskScore,
            impact: this.generateImpactDescription(path, pathFindings),
            exploitability: this.calculateExploitability(pathFindings),
            createdAt: new Date()
          };

          attackPaths.push(attackPath);

          // Store in database
          await this.saveAttackPath(programId, attackPath);
        }
      }
    }

    // Sort by risk score descending
    attackPaths.sort((a, b) => b.riskScore - a.riskScore);

    logger.info({
      programId,
      attackPathsDiscovered: attackPaths.length,
      topRiskScore: attackPaths[0]?.riskScore
    }, 'Attack paths discovered');

    return attackPaths;
  }

  /**
   * Find all paths from a start asset using BFS
   */
  private findPaths(
    graph: AssetGraph,
    startAssetId: string,
    maxDepth: number
  ): AssetRelationship[][] {
    const paths: AssetRelationship[][] = [];
    const visited = new Set<string>();

    const queue: { assetId: string; path: AssetRelationship[]; depth: number }[] = [
      { assetId: startAssetId, path: [], depth: 0 }
    ];

    while (queue.length > 0) {
      const { assetId, path, depth } = queue.shift()!;

      if (depth > maxDepth) continue;
      if (visited.has(assetId)) continue;

      visited.add(assetId);

      // Add current path if not empty
      if (path.length > 0) {
        paths.push([...path]);
      }

      // Find outgoing edges
      const outgoingEdges = graph.edges.filter(edge => edge.sourceAssetId === assetId);

      for (const edge of outgoingEdges) {
        if (!visited.has(edge.targetAssetId)) {
          queue.push({
            assetId: edge.targetAssetId,
            path: [...path, edge],
            depth: depth + 1
          });
        }
      }
    }

    return paths;
  }

  /**
   * Collect all findings along a path
   */
  private collectPathFindings(
    path: AssetRelationship[],
    findingsByAsset: Map<string, Finding[]>
  ): Finding[] {
    const findings: Finding[] = [];
    const assetIds = new Set<string>();

    // Collect all unique asset IDs in the path
    for (const relationship of path) {
      assetIds.add(relationship.sourceAssetId);
      assetIds.add(relationship.targetAssetId);
    }

    // Collect findings for each asset
    for (const assetId of assetIds) {
      const assetFindings = findingsByAsset.get(assetId) || [];
      findings.push(...assetFindings);
    }

    return findings;
  }

  /**
   * Calculate risk score for an attack path
   */
  private calculatePathRiskScore(path: AssetRelationship[], findings: Finding[]): number {
    let score = 0;

    // Base score from findings
    for (const finding of findings) {
      const severityScore = {
        critical: 10,
        high: 7,
        medium: 4,
        low: 2,
        info: 0.5
      }[finding.severity];

      score += severityScore * finding.confidence;
    }

    // Multiply by path complexity (longer paths = more potential impact)
    const pathMultiplier = 1 + (path.length * 0.2);
    score *= pathMultiplier;

    // Consider relationship confidence
    const avgConfidence = path.reduce((sum, rel) => sum + rel.confidence, 0) / path.length;
    score *= avgConfidence;

    return Math.round(score * 10) / 10;
  }

  /**
   * Calculate exploitability score (0-1)
   */
  private calculateExploitability(findings: Finding[]): number {
    if (findings.length === 0) return 0;

    // Average confidence across findings
    const avgConfidence = findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length;

    // Count confirmed findings
    const confirmedCount = findings.filter(f => f.confirmations.length > 0).length;
    const confirmationRate = confirmedCount / findings.length;

    // Combined score
    return (avgConfidence * 0.6) + (confirmationRate * 0.4);
  }

  /**
   * Generate human-readable impact description
   */
  private generateImpactDescription(path: AssetRelationship[], findings: Finding[]): string {
    const criticalFindings = findings.filter(f => f.severity === 'critical').length;
    const highFindings = findings.filter(f => f.severity === 'high').length;

    const pathLength = path.length;
    const relationshipTypes = [...new Set(path.map(p => p.relationshipType))];

    let description = `Attack path with ${pathLength} hop(s) `;
    description += `involving ${relationshipTypes.join(', ')} relationships. `;

    if (criticalFindings > 0) {
      description += `Contains ${criticalFindings} critical `;
    }
    if (highFindings > 0) {
      description += `and ${highFindings} high `;
    }
    description += `severity finding(s). `;

    description += `Potential for privilege escalation and lateral movement.`;

    return description;
  }

  /**
   * Save attack path to database
   */
  private async saveAttackPath(programId: string, attackPath: AttackPath): Promise<void> {
    await this.db.query(
      `INSERT INTO attack_paths
       (id, program_id, start_asset_id, end_asset_id, hops, findings, risk_score, impact, exploitability, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        attackPath.id,
        programId,
        attackPath.startAssetId,
        attackPath.endAssetId,
        JSON.stringify(attackPath.hops.map(h => h.id)),
        JSON.stringify(attackPath.findings.map(f => f.id)),
        attackPath.riskScore,
        attackPath.impact,
        attackPath.exploitability,
        attackPath.createdAt
      ]
    );
  }

  /**
   * Helper: Get asset by ID
   */
  private async getAsset(id: string): Promise<Asset | null> {
    const result = await this.db.query(
      `SELECT * FROM assets WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    return this.rowToAsset(result.rows[0]);
  }

  /**
   * Helper: Find asset by value
   */
  private async findAssetByValue(programId: string, value: string, type?: string): Promise<Asset | null> {
    const query = type
      ? `SELECT * FROM assets WHERE program_id = $1 AND value = $2 AND type = $3 LIMIT 1`
      : `SELECT * FROM assets WHERE program_id = $1 AND value = $2 LIMIT 1`;

    const params = type ? [programId, value, type] : [programId, value];

    const result = await this.db.query(query, params);

    if (result.rows.length === 0) return null;

    return this.rowToAsset(result.rows[0]);
  }

  /**
   * Helper: Find assets by metadata field
   */
  private async findAssetsByMetadata(
    programId: string,
    field: string,
    values: string[]
  ): Promise<Asset[]> {
    // Use PostgreSQL JSONB containment operator
    const result = await this.db.query(
      `SELECT * FROM assets
       WHERE program_id = $1
       AND metadata @> jsonb_build_object($2, $3::jsonb)
       LIMIT 100`,
      [programId, field, JSON.stringify(values)]
    );

    return result.rows.map(row => this.rowToAsset(row));
  }

  /**
   * Helper: Get program findings
   */
  private async getProgramFindings(programId: string): Promise<Finding[]> {
    const result = await this.db.query(
      `SELECT * FROM findings
       WHERE program_id = $1
       AND status NOT IN ('false_positive', 'closed')`,
      [programId]
    );

    return result.rows.map(row => ({
      id: row.id,
      programId: row.program_id,
      assetId: row.asset_id,
      severity: row.severity,
      confidence: row.confidence,
      title: row.title,
      description: row.description,
      cvss: row.cvss,
      cwe: row.cwe,
      evidence: row.evidence,
      poc: row.poc,
      impact: row.impact,
      remediation: row.remediation,
      status: row.status,
      confirmations: row.confirmations,
      triageResult: row.triage_result,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  /**
   * Helper: Extract parent domains
   */
  private extractParentDomains(domain: string): string[] {
    const parts = domain.split('.');
    const parents: string[] = [];

    for (let i = 1; i < parts.length - 1; i++) {
      parents.push(parts.slice(i).join('.'));
    }

    return parents;
  }

  /**
   * Helper: Convert DB row to Asset
   */
  private rowToAsset(row: any): Asset {
    return {
      id: row.id,
      programId: row.program_id,
      type: row.type,
      value: row.value,
      source: row.source,
      status: row.status,
      metadata: row.metadata,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      lastScanned: row.last_scanned
    };
  }
}

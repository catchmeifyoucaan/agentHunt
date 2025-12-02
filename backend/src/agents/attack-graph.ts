/**
 * Attack Graph Visualization Agent
 * Purpose: Generate visual attack graphs from findings
 * 
 * Features:
 * - Build attack paths from vulnerabilities
 * - Identify critical paths to assets
 * - Calculate attack complexity
 * - Generate interactive visualizations
 * - Export to various formats
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface AttackGraphJob extends BaseJob {
  type: 'attack-graph';
  options: {
    programId: string;
    action: 'build' | 'analyze' | 'export';
    format?: 'json' | 'dot' | 'svg' | 'html';
    focusAsset?: string;
  };
}

interface GraphNode {
  id: string;
  type: 'asset' | 'vulnerability' | 'technique' | 'impact';
  label: string;
  severity?: string;
  metadata: any;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
  attackType?: string;
}

interface AttackPath {
  id: string;
  nodes: string[];
  edges: string[];
  totalWeight: number;
  complexity: 'low' | 'medium' | 'high';
  impact: string;
}

interface AttackGraph {
  id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  paths: AttackPath[];
  criticalPaths: AttackPath[];
  statistics: {
    nodeCount: number;
    edgeCount: number;
    pathCount: number;
    maxDepth: number;
    avgComplexity: number;
  };
}

export class AttackGraphAgent extends BaseAgent<AttackGraphJob> {
  constructor() {
    super('attack-graph');
  }

  protected getSteps() {
    return [
      { name: 'Load findings and assets' },
      { name: 'Build graph nodes' },
      { name: 'Create edges' },
      { name: 'Find attack paths' },
      { name: 'Analyze critical paths' },
      { name: 'Generate visualization' },
    ];
  }

  async process(job: Job<AttackGraphJob>): Promise<any> {
    const { programId, options } = job.data;
    const { action, format = 'json', focusAsset } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Step 1: Load data
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'data-loader',
        toolStatus: 'running',
        message: 'Loading findings and assets',
      });

      const findings = await this.loadFindings(programId);
      const assets = await this.loadAssets(programId);

      // Step 2: Build nodes
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'node-builder',
        toolStatus: 'running',
        message: 'Building graph nodes',
      });

      const nodes = this.buildNodes(findings, assets);

      // Step 3: Create edges
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 40,
        currentTool: 'edge-builder',
        toolStatus: 'running',
        message: 'Creating edges',
      });

      const edges = this.buildEdges(findings, nodes);

      // Step 4: Find paths
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 60,
        currentTool: 'path-finder',
        toolStatus: 'running',
        message: 'Finding attack paths',
      });

      const paths = this.findAttackPaths(nodes, edges, focusAsset);

      // Step 5: Analyze critical paths
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 80,
        currentTool: 'path-analyzer',
        toolStatus: 'running',
        message: 'Analyzing critical paths',
      });

      const criticalPaths = this.findCriticalPaths(paths);

      // Step 6: Generate visualization
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 95,
        currentTool: 'visualizer',
        toolStatus: 'running',
        message: 'Generating visualization',
      });

      const graph: AttackGraph = {
        id: uuidv4(),
        nodes,
        edges,
        paths,
        criticalPaths,
        statistics: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          pathCount: paths.length,
          maxDepth: Math.max(...paths.map(p => p.nodes.length), 0),
          avgComplexity: this.calculateAvgComplexity(paths),
        },
      };

      const visualization = this.generateVisualization(graph, format);
      await this.storeGraph(programId, graph, visualization);

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Generated graph with ${nodes.length} nodes, ${paths.length} paths`,
      });

      const result = {
        graphId: graph.id,
        statistics: graph.statistics,
        criticalPathCount: criticalPaths.length,
        visualization: format === 'json' ? graph : visualization,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error }, 'Attack graph generation failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Load findings from database
   */
  private async loadFindings(programId: string): Promise<any[]> {
    const result = await database.query(
      'SELECT * FROM findings WHERE program_id = $1',
      [programId]
    );
    return result.rows;
  }

  /**
   * Load assets from database
   */
  private async loadAssets(programId: string): Promise<any[]> {
    const result = await database.query(
      'SELECT * FROM assets WHERE program_id = $1',
      [programId]
    );
    return result.rows;
  }

  /**
   * Build graph nodes from findings and assets
   */
  private buildNodes(findings: any[], assets: any[]): GraphNode[] {
    const nodes: GraphNode[] = [];

    // Add asset nodes
    for (const asset of assets) {
      nodes.push({
        id: `asset-${asset.id}`,
        type: 'asset',
        label: asset.url || asset.domain || asset.name,
        metadata: {
          assetId: asset.id,
          type: asset.type,
          technologies: asset.metadata?.technologies,
        },
      });
    }

    // Add vulnerability nodes
    for (const finding of findings) {
      nodes.push({
        id: `vuln-${finding.id}`,
        type: 'vulnerability',
        label: `${finding.type}: ${finding.title || finding.url}`,
        severity: finding.severity,
        metadata: {
          findingId: finding.id,
          type: finding.type,
          url: finding.url,
          cvss: finding.cvss_score,
        },
      });

      // Add impact nodes for critical/high findings
      if (finding.severity === 'critical' || finding.severity === 'high') {
        nodes.push({
          id: `impact-${finding.id}`,
          type: 'impact',
          label: this.getImpactLabel(finding.type),
          severity: finding.severity,
          metadata: {
            findingId: finding.id,
            impactType: this.getImpactType(finding.type),
          },
        });
      }
    }

    // Add technique nodes
    const techniques = new Set(findings.map(f => f.type));
    for (const technique of techniques) {
      nodes.push({
        id: `technique-${technique}`,
        type: 'technique',
        label: technique.toUpperCase(),
        metadata: {
          technique,
          count: findings.filter(f => f.type === technique).length,
        },
      });
    }

    return nodes;
  }

  /**
   * Build edges between nodes
   */
  private buildEdges(findings: any[], nodes: GraphNode[]): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const finding of findings) {
      const vulnNodeId = `vuln-${finding.id}`;
      const techniqueNodeId = `technique-${finding.type}`;

      // Connect vulnerability to technique
      edges.push({
        id: uuidv4(),
        source: techniqueNodeId,
        target: vulnNodeId,
        label: 'exploits',
        weight: this.getSeverityWeight(finding.severity),
        attackType: finding.type,
      });

      // Connect vulnerability to asset (if URL matches)
      const matchingAsset = nodes.find(n => 
        n.type === 'asset' && finding.url?.includes(n.metadata.assetId)
      );
      if (matchingAsset) {
        edges.push({
          id: uuidv4(),
          source: vulnNodeId,
          target: matchingAsset.id,
          label: 'affects',
          weight: this.getSeverityWeight(finding.severity),
        });
      }

      // Connect vulnerability to impact
      const impactNodeId = `impact-${finding.id}`;
      if (nodes.find(n => n.id === impactNodeId)) {
        edges.push({
          id: uuidv4(),
          source: vulnNodeId,
          target: impactNodeId,
          label: 'leads to',
          weight: this.getSeverityWeight(finding.severity),
        });
      }
    }

    // Connect related vulnerabilities (chaining)
    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        if (this.canChain(findings[i], findings[j])) {
          edges.push({
            id: uuidv4(),
            source: `vuln-${findings[i].id}`,
            target: `vuln-${findings[j].id}`,
            label: 'chains to',
            weight: 0.5,
          });
        }
      }
    }

    return edges;
  }

  /**
   * Check if two vulnerabilities can be chained
   */
  private canChain(v1: any, v2: any): boolean {
    const chainableTypes: Record<string, string[]> = {
      'xss': ['csrf', 'session-hijacking', 'account-takeover'],
      'sqli': ['auth-bypass', 'data-breach', 'rce'],
      'ssrf': ['cloud-metadata', 'internal-access', 'rce'],
      'lfi': ['rce', 'info-disclosure'],
      'idor': ['data-breach', 'privilege-escalation'],
    };

    const t1 = v1.type?.toLowerCase();
    const t2 = v2.type?.toLowerCase();

    return chainableTypes[t1]?.includes(t2) || chainableTypes[t2]?.includes(t1);
  }

  /**
   * Find all attack paths
   */
  private findAttackPaths(nodes: GraphNode[], edges: GraphEdge[], focusAsset?: string): AttackPath[] {
    const paths: AttackPath[] = [];
    const techniqueNodes = nodes.filter(n => n.type === 'technique');
    const impactNodes = nodes.filter(n => n.type === 'impact');

    // BFS from each technique to each impact
    for (const start of techniqueNodes) {
      for (const end of impactNodes) {
        const path = this.bfsPath(start.id, end.id, nodes, edges);
        if (path) {
          paths.push(path);
        }
      }
    }

    // Filter by focus asset if specified
    if (focusAsset) {
      return paths.filter(p => 
        p.nodes.some(n => n.includes(focusAsset))
      );
    }

    return paths;
  }

  /**
   * BFS to find path between nodes
   */
  private bfsPath(startId: string, endId: string, nodes: GraphNode[], edges: GraphEdge[]): AttackPath | null {
    const queue: { nodeId: string; path: string[]; edgePath: string[]; weight: number }[] = [
      { nodeId: startId, path: [startId], edgePath: [], weight: 0 }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === endId) {
        return {
          id: uuidv4(),
          nodes: current.path,
          edges: current.edgePath,
          totalWeight: current.weight,
          complexity: this.getComplexity(current.weight),
          impact: this.getPathImpact(current.path, nodes),
        };
      }

      if (visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);

      // Find connected edges
      const connectedEdges = edges.filter(e => e.source === current.nodeId);
      for (const edge of connectedEdges) {
        if (!visited.has(edge.target)) {
          queue.push({
            nodeId: edge.target,
            path: [...current.path, edge.target],
            edgePath: [...current.edgePath, edge.id],
            weight: current.weight + edge.weight,
          });
        }
      }
    }

    return null;
  }

  /**
   * Find critical paths (highest impact, lowest complexity)
   */
  private findCriticalPaths(paths: AttackPath[]): AttackPath[] {
    return paths
      .filter(p => p.impact === 'critical' || p.complexity === 'low')
      .sort((a, b) => b.totalWeight - a.totalWeight)
      .slice(0, 10);
  }

  /**
   * Generate visualization in specified format
   */
  private generateVisualization(graph: AttackGraph, format: string): string {
    switch (format) {
      case 'dot':
        return this.toDot(graph);
      case 'svg':
        return this.toSvg(graph);
      case 'html':
        return this.toHtml(graph);
      default:
        return JSON.stringify(graph, null, 2);
    }
  }

  /**
   * Convert to DOT format (Graphviz)
   */
  private toDot(graph: AttackGraph): string {
    let dot = 'digraph AttackGraph {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box];\n\n';

    // Add nodes
    for (const node of graph.nodes) {
      const color = this.getNodeColor(node);
      dot += `  "${node.id}" [label="${node.label}" fillcolor="${color}" style=filled];\n`;
    }

    dot += '\n';

    // Add edges
    for (const edge of graph.edges) {
      dot += `  "${edge.source}" -> "${edge.target}" [label="${edge.label}"];\n`;
    }

    dot += '}\n';
    return dot;
  }

  /**
   * Convert to SVG
   */
  private toSvg(graph: AttackGraph): string {
    const width = 1200;
    const height = 800;
    const nodeRadius = 30;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n`;
    svg += `  <style>
    .node { cursor: pointer; }
    .node text { font-size: 10px; text-anchor: middle; }
    .edge { stroke: #999; stroke-width: 1; fill: none; }
    .critical { fill: #ff4444; }
    .high { fill: #ff8844; }
    .medium { fill: #ffcc44; }
    .low { fill: #44cc44; }
  </style>\n`;

    // Simple layout
    const nodePositions = new Map<string, { x: number; y: number }>();
    graph.nodes.forEach((node, i) => {
      const x = 100 + (i % 10) * 100;
      const y = 100 + Math.floor(i / 10) * 100;
      nodePositions.set(node.id, { x, y });
    });

    // Draw edges
    for (const edge of graph.edges) {
      const source = nodePositions.get(edge.source);
      const target = nodePositions.get(edge.target);
      if (source && target) {
        svg += `  <line class="edge" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"/>\n`;
      }
    }

    // Draw nodes
    for (const node of graph.nodes) {
      const pos = nodePositions.get(node.id);
      if (pos) {
        const colorClass = node.severity || 'low';
        svg += `  <g class="node" transform="translate(${pos.x},${pos.y})">
    <circle r="${nodeRadius}" class="${colorClass}"/>
    <text dy="4">${node.label.substring(0, 15)}</text>
  </g>\n`;
      }
    }

    svg += '</svg>';
    return svg;
  }

  /**
   * Convert to interactive HTML
   */
  private toHtml(graph: AttackGraph): string {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Attack Graph - ${graph.id}</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; }
    #graph { width: 100vw; height: 100vh; }
    .node circle { stroke: #fff; stroke-width: 2px; }
    .node text { font-size: 12px; }
    .link { stroke: #999; stroke-opacity: 0.6; }
    .critical { fill: #ff4444; }
    .high { fill: #ff8844; }
    .medium { fill: #ffcc44; }
    .low { fill: #44cc44; }
    .info { fill: #4444ff; }
  </style>
</head>
<body>
  <div id="graph"></div>
  <script>
    const data = ${JSON.stringify(graph)};
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    const svg = d3.select("#graph")
      .append("svg")
      .attr("width", width)
      .attr("height", height);
    
    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.edges).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2));
    
    const link = svg.append("g")
      .selectAll("line")
      .data(data.edges)
      .join("line")
      .attr("class", "link");
    
    const node = svg.append("g")
      .selectAll("g")
      .data(data.nodes)
      .join("g")
      .attr("class", "node")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));
    
    node.append("circle")
      .attr("r", 20)
      .attr("class", d => d.severity || "info");
    
    node.append("text")
      .attr("dy", 4)
      .attr("text-anchor", "middle")
      .text(d => d.label.substring(0, 10));
    
    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);
      
      node.attr("transform", d => \`translate(\${d.x},\${d.y})\`);
    });
    
    function dragstarted(event) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    
    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    
    function dragended(event) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }
  </script>
</body>
</html>`;
  }

  // Helper methods

  private getSeverityWeight(severity: string): number {
    const weights: Record<string, number> = {
      critical: 1.0,
      high: 0.8,
      medium: 0.5,
      low: 0.2,
      info: 0.1,
    };
    return weights[severity] || 0.5;
  }

  private getComplexity(weight: number): 'low' | 'medium' | 'high' {
    if (weight >= 2) return 'low';
    if (weight >= 1) return 'medium';
    return 'high';
  }

  private getPathImpact(path: string[], nodes: GraphNode[]): string {
    const impactNode = nodes.find(n => path.includes(n.id) && n.type === 'impact');
    return impactNode?.severity || 'medium';
  }

  private getImpactLabel(type: string): string {
    const impacts: Record<string, string> = {
      rce: 'Remote Code Execution',
      sqli: 'Data Breach',
      xss: 'Account Takeover',
      ssrf: 'Internal Network Access',
      idor: 'Unauthorized Data Access',
    };
    return impacts[type] || 'Security Impact';
  }

  private getImpactType(type: string): string {
    return type;
  }

  private getNodeColor(node: GraphNode): string {
    const colors: Record<string, string> = {
      critical: '#ff4444',
      high: '#ff8844',
      medium: '#ffcc44',
      low: '#44cc44',
    };
    return colors[node.severity || ''] || '#4444ff';
  }

  private calculateAvgComplexity(paths: AttackPath[]): number {
    if (paths.length === 0) return 0;
    const complexityMap = { low: 1, medium: 2, high: 3 };
    const total = paths.reduce((sum, p) => sum + complexityMap[p.complexity], 0);
    return total / paths.length;
  }

  private async storeGraph(programId: string, graph: AttackGraph, visualization: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO attack_graphs (id, program_id, nodes, edges, paths, statistics, visualization, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          graph.id,
          programId,
          JSON.stringify(graph.nodes),
          JSON.stringify(graph.edges),
          JSON.stringify(graph.paths),
          JSON.stringify(graph.statistics),
          visualization,
        ]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store attack graph');
    }
  }
}

export default new AttackGraphAgent();

/**
 * GraphQL Analyzer & Introspection Module
 * 
 * Features:
 * - Schema introspection and analysis
 * - Query/mutation fuzzing
 * - Authorization testing
 * - Batch query attacks
 * - Field suggestion exploitation
 * - Depth limit testing
 */

import axios, { AxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import logger from '../../utils/logger';

// ============================================
// Types and Interfaces
// ============================================

export interface GraphQLEndpoint {
  url: string;
  headers?: Record<string, string>;
  introspectionEnabled: boolean;
  schema?: GraphQLSchema;
}

export interface GraphQLSchema {
  queryType: GraphQLType | null;
  mutationType: GraphQLType | null;
  subscriptionType: GraphQLType | null;
  types: GraphQLType[];
  directives: GraphQLDirective[];
}

export interface GraphQLType {
  kind: string;
  name: string;
  description?: string;
  fields?: GraphQLField[];
  inputFields?: GraphQLInputField[];
  interfaces?: GraphQLType[];
  enumValues?: GraphQLEnumValue[];
  possibleTypes?: GraphQLType[];
  ofType?: GraphQLType;
}

export interface GraphQLField {
  name: string;
  description?: string;
  args: GraphQLInputField[];
  type: GraphQLType;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface GraphQLInputField {
  name: string;
  description?: string;
  type: GraphQLType;
  defaultValue?: any;
}

export interface GraphQLEnumValue {
  name: string;
  description?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface GraphQLDirective {
  name: string;
  description?: string;
  locations: string[];
  args: GraphQLInputField[];
}

export interface GraphQLVulnerability {
  id: string;
  type: GraphQLVulnType;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  evidence: string;
  remediation: string;
  affectedFields?: string[];
  payload?: string;
}

export type GraphQLVulnType =
  | 'introspection_enabled'
  | 'no_depth_limit'
  | 'no_complexity_limit'
  | 'batch_query_allowed'
  | 'field_suggestion'
  | 'idor'
  | 'injection'
  | 'authorization_bypass'
  | 'information_disclosure'
  | 'dos_potential';

export interface GraphQLTestResult {
  endpointUrl: string;
  timestamp: Date;
  schema?: GraphQLSchema;
  vulnerabilities: GraphQLVulnerability[];
  queries: GraphQLQueryResult[];
  statistics: {
    totalTypes: number;
    totalFields: number;
    totalMutations: number;
    totalQueries: number;
    sensitiveFields: string[];
    potentialIdorFields: string[];
  };
}

export interface GraphQLQueryResult {
  id: string;
  query: string;
  variables?: Record<string, any>;
  response?: any;
  error?: string;
  responseTime: number;
  statusCode: number;
}

// ============================================
// Introspection Query
// ============================================

const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
      directives {
        name
        description
        locations
        args {
          ...InputValue
        }
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }

  fragment InputValue on __InputValue {
    name
    description
    type {
      ...TypeRef
    }
    defaultValue
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ============================================
// Main GraphQL Analyzer Class
// ============================================

export class GraphQLAnalyzer extends EventEmitter {
  private endpoints: Map<string, GraphQLEndpoint> = new Map();

  constructor() {
    super();
  }

  // ============================================
  // Schema Introspection
  // ============================================

  public async introspect(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<GraphQLSchema | null> {
    logger.info({ url }, 'Starting GraphQL introspection');

    try {
      const response = await this.executeQuery(url, INTROSPECTION_QUERY, {}, headers);

      if (response.data?.__schema) {
        const schema = response.data.__schema as GraphQLSchema;

        // Store endpoint info
        this.endpoints.set(url, {
          url,
          headers,
          introspectionEnabled: true,
          schema,
        });

        this.emit('introspection-complete', { url, schema });
        return schema;
      }

      return null;
    } catch (error: any) {
      logger.warn({ url, error: error.message }, 'Introspection failed');

      // Store endpoint as introspection disabled
      this.endpoints.set(url, {
        url,
        headers,
        introspectionEnabled: false,
      });

      return null;
    }
  }

  // ============================================
  // Vulnerability Scanning
  // ============================================

  public async scanForVulnerabilities(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<GraphQLTestResult> {
    const startTime = Date.now();
    const vulnerabilities: GraphQLVulnerability[] = [];
    const queries: GraphQLQueryResult[] = [];

    // 1. Check introspection
    const schema = await this.introspect(url, headers);
    if (schema) {
      vulnerabilities.push({
        id: uuidv4(),
        type: 'introspection_enabled',
        severity: 'medium',
        title: 'GraphQL Introspection Enabled',
        description: 'The GraphQL endpoint allows introspection queries, exposing the entire schema.',
        evidence: 'Introspection query returned full schema',
        remediation: 'Disable introspection in production environments',
      });
    }

    // 2. Test for depth limit
    const depthResult = await this.testDepthLimit(url, headers);
    queries.push(depthResult.query);
    if (depthResult.vulnerable) {
      vulnerabilities.push({
        id: uuidv4(),
        type: 'no_depth_limit',
        severity: 'high',
        title: 'No Query Depth Limit',
        description: 'The GraphQL endpoint does not enforce query depth limits, allowing DoS attacks.',
        evidence: `Deep query (depth ${depthResult.depth}) was accepted`,
        remediation: 'Implement query depth limiting (recommended max: 10)',
        payload: depthResult.query.query,
      });
    }

    // 3. Test for batch queries
    const batchResult = await this.testBatchQueries(url, headers);
    queries.push(...batchResult.queries);
    if (batchResult.vulnerable) {
      vulnerabilities.push({
        id: uuidv4(),
        type: 'batch_query_allowed',
        severity: 'medium',
        title: 'Batch Queries Allowed',
        description: 'The endpoint accepts batched queries, which can be used for DoS or brute force attacks.',
        evidence: `Batch of ${batchResult.batchSize} queries was accepted`,
        remediation: 'Limit or disable batch query support',
      });
    }

    // 4. Test field suggestions
    const suggestionResult = await this.testFieldSuggestions(url, headers);
    queries.push(suggestionResult.query);
    if (suggestionResult.vulnerable) {
      vulnerabilities.push({
        id: uuidv4(),
        type: 'field_suggestion',
        severity: 'low',
        title: 'Field Suggestions Enabled',
        description: 'Error messages suggest valid field names, aiding schema discovery.',
        evidence: suggestionResult.suggestions.join(', '),
        remediation: 'Disable field suggestions in production',
      });
    }

    // 5. Analyze schema for sensitive fields
    let statistics = {
      totalTypes: 0,
      totalFields: 0,
      totalMutations: 0,
      totalQueries: 0,
      sensitiveFields: [] as string[],
      potentialIdorFields: [] as string[],
    };

    if (schema) {
      statistics = this.analyzeSchema(schema);

      // Report sensitive fields
      if (statistics.sensitiveFields.length > 0) {
        vulnerabilities.push({
          id: uuidv4(),
          type: 'information_disclosure',
          severity: 'info',
          title: 'Potentially Sensitive Fields Exposed',
          description: 'The schema contains fields that may expose sensitive information.',
          evidence: statistics.sensitiveFields.join(', '),
          remediation: 'Review and restrict access to sensitive fields',
          affectedFields: statistics.sensitiveFields,
        });
      }

      // Report potential IDOR fields
      if (statistics.potentialIdorFields.length > 0) {
        vulnerabilities.push({
          id: uuidv4(),
          type: 'idor',
          severity: 'medium',
          title: 'Potential IDOR Vulnerabilities',
          description: 'Fields accepting ID parameters may be vulnerable to IDOR attacks.',
          evidence: statistics.potentialIdorFields.join(', '),
          remediation: 'Implement proper authorization checks on ID-based queries',
          affectedFields: statistics.potentialIdorFields,
        });
      }

      // 6. Test for authorization bypass on mutations
      if (schema.mutationType) {
        const authResults = await this.testMutationAuthorization(url, schema, headers);
        queries.push(...authResults.queries);
        vulnerabilities.push(...authResults.vulnerabilities);
      }
    }

    return {
      endpointUrl: url,
      timestamp: new Date(),
      schema: schema || undefined,
      vulnerabilities,
      queries,
      statistics,
    };
  }

  // ============================================
  // Specific Tests
  // ============================================

  private async testDepthLimit(
    url: string,
    headers: Record<string, string>
  ): Promise<{ vulnerable: boolean; depth: number; query: GraphQLQueryResult }> {
    // Generate deeply nested query
    const depth = 15;
    let query = '{ __typename ';
    let closing = ' }';

    for (let i = 0; i < depth; i++) {
      query += '... on Query { __typename ';
      closing += ' }';
    }

    query += closing;

    const startTime = Date.now();
    try {
      const response = await this.executeQuery(url, query, {}, headers);
      const queryResult: GraphQLQueryResult = {
        id: uuidv4(),
        query,
        response: response.data,
        responseTime: Date.now() - startTime,
        statusCode: 200,
      };

      // If we got a response without errors, depth limit is not enforced
      const vulnerable = !response.errors || response.errors.length === 0;

      return { vulnerable, depth, query: queryResult };
    } catch (error: any) {
      return {
        vulnerable: false,
        depth,
        query: {
          id: uuidv4(),
          query,
          error: error.message,
          responseTime: Date.now() - startTime,
          statusCode: error.response?.status || 0,
        },
      };
    }
  }

  private async testBatchQueries(
    url: string,
    headers: Record<string, string>
  ): Promise<{ vulnerable: boolean; batchSize: number; queries: GraphQLQueryResult[] }> {
    const batchSize = 10;
    const batch = Array(batchSize).fill({ query: '{ __typename }' });

    const startTime = Date.now();
    try {
      const config: AxiosRequestConfig = {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        timeout: 30000,
      };

      const response = await axios.post(url, batch, config);

      const queryResult: GraphQLQueryResult = {
        id: uuidv4(),
        query: JSON.stringify(batch),
        response: response.data,
        responseTime: Date.now() - startTime,
        statusCode: response.status,
      };

      // If we got an array response, batch queries are allowed
      const vulnerable = Array.isArray(response.data) && response.data.length === batchSize;

      return { vulnerable, batchSize, queries: [queryResult] };
    } catch (error: any) {
      return {
        vulnerable: false,
        batchSize,
        queries: [
          {
            id: uuidv4(),
            query: JSON.stringify(batch),
            error: error.message,
            responseTime: Date.now() - startTime,
            statusCode: error.response?.status || 0,
          },
        ],
      };
    }
  }

  private async testFieldSuggestions(
    url: string,
    headers: Record<string, string>
  ): Promise<{ vulnerable: boolean; suggestions: string[]; query: GraphQLQueryResult }> {
    // Query with intentionally misspelled field
    const query = '{ __typenme }'; // Misspelled __typename

    const startTime = Date.now();
    try {
      const response = await this.executeQuery(url, query, {}, headers);

      const queryResult: GraphQLQueryResult = {
        id: uuidv4(),
        query,
        response: response,
        responseTime: Date.now() - startTime,
        statusCode: 200,
      };

      // Check for suggestions in error message
      const suggestions: string[] = [];
      if (response.errors) {
        for (const error of response.errors) {
          const message = error.message || '';
          const suggestionMatch = message.match(/Did you mean[^?]*\?/i);
          if (suggestionMatch) {
            suggestions.push(suggestionMatch[0]);
          }
        }
      }

      return {
        vulnerable: suggestions.length > 0,
        suggestions,
        query: queryResult,
      };
    } catch (error: any) {
      return {
        vulnerable: false,
        suggestions: [],
        query: {
          id: uuidv4(),
          query,
          error: error.message,
          responseTime: Date.now() - startTime,
          statusCode: error.response?.status || 0,
        },
      };
    }
  }

  private async testMutationAuthorization(
    url: string,
    schema: GraphQLSchema,
    headers: Record<string, string>
  ): Promise<{ queries: GraphQLQueryResult[]; vulnerabilities: GraphQLVulnerability[] }> {
    const queries: GraphQLQueryResult[] = [];
    const vulnerabilities: GraphQLVulnerability[] = [];

    // Find mutation type
    const mutationType = schema.types.find((t) => t.name === schema.mutationType?.name);
    if (!mutationType?.fields) {
      return { queries, vulnerabilities };
    }

    // Test a few mutations without auth
    const dangerousMutations = mutationType.fields.filter((f) =>
      /delete|remove|update|create|admin|user/i.test(f.name)
    );

    for (const mutation of dangerousMutations.slice(0, 3)) {
      const testQuery = this.buildMutationQuery(mutation);
      const startTime = Date.now();

      try {
        const response = await this.executeQuery(url, testQuery, {}, headers);

        queries.push({
          id: uuidv4(),
          query: testQuery,
          response: response,
          responseTime: Date.now() - startTime,
          statusCode: 200,
        });

        // Check if mutation was accepted (no auth error)
        if (!response.errors || !response.errors.some((e: any) =>
          /unauthorized|forbidden|auth|permission/i.test(e.message)
        )) {
          vulnerabilities.push({
            id: uuidv4(),
            type: 'authorization_bypass',
            severity: 'high',
            title: `Mutation "${mutation.name}" May Lack Authorization`,
            description: `The mutation ${mutation.name} did not return an authorization error.`,
            evidence: JSON.stringify(response),
            remediation: 'Implement proper authorization checks on all mutations',
            affectedFields: [mutation.name],
            payload: testQuery,
          });
        }
      } catch (error: any) {
        queries.push({
          id: uuidv4(),
          query: testQuery,
          error: error.message,
          responseTime: Date.now() - startTime,
          statusCode: error.response?.status || 0,
        });
      }
    }

    return { queries, vulnerabilities };
  }

  // ============================================
  // Schema Analysis
  // ============================================

  private analyzeSchema(schema: GraphQLSchema): {
    totalTypes: number;
    totalFields: number;
    totalMutations: number;
    totalQueries: number;
    sensitiveFields: string[];
    potentialIdorFields: string[];
  } {
    const sensitivePatterns = [
      /password/i, /secret/i, /token/i, /key/i, /credential/i,
      /ssn/i, /social/i, /credit/i, /card/i, /cvv/i,
      /private/i, /internal/i, /admin/i, /debug/i,
    ];

    const idorPatterns = [
      /^id$/i, /userId/i, /accountId/i, /orderId/i,
      /customerId/i, /profileId/i, /documentId/i,
    ];

    const sensitiveFields: string[] = [];
    const potentialIdorFields: string[] = [];
    let totalFields = 0;

    // Count queries and mutations
    const queryType = schema.types.find((t) => t.name === schema.queryType?.name);
    const mutationType = schema.types.find((t) => t.name === schema.mutationType?.name);

    const totalQueries = queryType?.fields?.length || 0;
    const totalMutations = mutationType?.fields?.length || 0;

    // Analyze all types
    for (const type of schema.types) {
      if (type.name.startsWith('__')) continue; // Skip introspection types

      if (type.fields) {
        for (const field of type.fields) {
          totalFields++;
          const fullName = `${type.name}.${field.name}`;

          // Check for sensitive fields
          if (sensitivePatterns.some((p) => p.test(field.name))) {
            sensitiveFields.push(fullName);
          }

          // Check for IDOR-prone fields
          for (const arg of field.args) {
            if (idorPatterns.some((p) => p.test(arg.name))) {
              potentialIdorFields.push(`${fullName}(${arg.name})`);
            }
          }
        }
      }
    }

    return {
      totalTypes: schema.types.filter((t) => !t.name.startsWith('__')).length,
      totalFields,
      totalMutations,
      totalQueries,
      sensitiveFields,
      potentialIdorFields,
    };
  }

  // ============================================
  // Query Building & Execution
  // ============================================

  private buildMutationQuery(mutation: GraphQLField): string {
    // Build a minimal mutation query with placeholder values
    const args = mutation.args
      .map((arg) => {
        const value = this.getPlaceholderValue(arg.type);
        return `${arg.name}: ${value}`;
      })
      .join(', ');

    const argsStr = args ? `(${args})` : '';

    return `mutation { ${mutation.name}${argsStr} { __typename } }`;
  }

  private getPlaceholderValue(type: GraphQLType): string {
    const typeName = this.getTypeName(type);

    switch (typeName.toLowerCase()) {
      case 'string':
      case 'id':
        return '"test"';
      case 'int':
        return '1';
      case 'float':
        return '1.0';
      case 'boolean':
        return 'true';
      default:
        if (type.kind === 'ENUM' && type.enumValues?.[0]) {
          return type.enumValues[0].name;
        }
        return 'null';
    }
  }

  private getTypeName(type: GraphQLType): string {
    if (type.name) return type.name;
    if (type.ofType) return this.getTypeName(type.ofType);
    return 'Unknown';
  }

  public async executeQuery(
    url: string,
    query: string,
    variables: Record<string, any> = {},
    headers: Record<string, string> = {}
  ): Promise<any> {
    const config: AxiosRequestConfig = {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      timeout: 30000,
    };

    const response = await axios.post(
      url,
      { query, variables },
      config
    );

    return response.data;
  }

  // ============================================
  // Query Generation for Fuzzing
  // ============================================

  public generateFuzzQueries(schema: GraphQLSchema): string[] {
    const queries: string[] = [];

    // Generate queries for all query fields
    const queryType = schema.types.find((t) => t.name === schema.queryType?.name);
    if (queryType?.fields) {
      for (const field of queryType.fields) {
        queries.push(this.buildQueryForField(field, 'query'));
      }
    }

    // Generate mutations
    const mutationType = schema.types.find((t) => t.name === schema.mutationType?.name);
    if (mutationType?.fields) {
      for (const field of mutationType.fields) {
        queries.push(this.buildQueryForField(field, 'mutation'));
      }
    }

    return queries;
  }

  private buildQueryForField(field: GraphQLField, operationType: string): string {
    const args = field.args
      .map((arg) => `${arg.name}: ${this.getPlaceholderValue(arg.type)}`)
      .join(', ');

    const argsStr = args ? `(${args})` : '';
    const selection = this.buildSelectionSet(field.type, 2);

    return `${operationType} { ${field.name}${argsStr} ${selection} }`;
  }

  private buildSelectionSet(type: GraphQLType, depth: number): string {
    if (depth <= 0) return '';

    const actualType = type.ofType || type;

    if (actualType.kind === 'SCALAR' || actualType.kind === 'ENUM') {
      return '';
    }

    if (actualType.fields && actualType.fields.length > 0) {
      const fields = actualType.fields
        .slice(0, 5) // Limit to 5 fields
        .map((f) => {
          const nested = this.buildSelectionSet(f.type, depth - 1);
          return `${f.name}${nested ? ` ${nested}` : ''}`;
        })
        .join(' ');

      return `{ ${fields} }`;
    }

    return '{ __typename }';
  }

  // ============================================
  // Endpoint Management
  // ============================================

  public getEndpoint(url: string): GraphQLEndpoint | undefined {
    return this.endpoints.get(url);
  }

  public getAllEndpoints(): GraphQLEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  public clearEndpoints(): void {
    this.endpoints.clear();
  }
}

export default new GraphQLAnalyzer();

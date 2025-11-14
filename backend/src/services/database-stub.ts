/**
 * In-Memory Database Stub for Testing
 * Provides basic database functionality without PostgreSQL
 */

import logger from '../utils/logger';

interface InMemoryStore {
  [table: string]: Map<string, any>;
}

class DatabaseStub {
  private store: InMemoryStore = {};
  private connected = false;

  async connect(): Promise<void> {
    logger.info('Using in-memory database stub for testing');
    this.connected = true;

    // Initialize tables
    const tables = [
      'programs', 'targets', 'jobs', 'findings', 'notifications',
      'workflows', 'workflow_executions', 'agent_health', 'knowledge_entries'
    ];

    tables.forEach(table => {
      this.store[table] = new Map();
    });
  }

  async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    if (!this.connected) {
      await this.connect();
    }

    // Simple query parser for basic operations
    const upperText = text.toUpperCase().trim();

    try {
      if (upperText.startsWith('SELECT')) {
        return this.handleSelect(text, params);
      } else if (upperText.startsWith('INSERT')) {
        return this.handleInsert(text, params);
      } else if (upperText.startsWith('UPDATE')) {
        return this.handleUpdate(text, params);
      } else if (upperText.startsWith('DELETE')) {
        return this.handleDelete(text, params);
      } else if (upperText.startsWith('CREATE') || upperText.startsWith('ALTER')) {
        // Ignore schema modifications
        return { rows: [], rowCount: 0 };
      }

      logger.warn({ query: text.substring(0, 100) }, 'Unhandled query type in stub');
      return { rows: [], rowCount: 0 };
    } catch (error: any) {
      logger.error({ error, query: text.substring(0, 100) }, 'Error in database stub');
      return { rows: [], rowCount: 0 };
    }
  }

  private handleSelect(text: string, params: any[]): { rows: any[]; rowCount: number } {
    // Extract table name (basic parsing)
    const fromMatch = text.match(/FROM\s+(\w+)/i);
    const table = fromMatch ? fromMatch[1] : 'unknown';

    if (!this.store[table]) {
      this.store[table] = new Map();
    }

    // Return all rows from table
    const rows = Array.from(this.store[table].values());
    return { rows, rowCount: rows.length };
  }

  private handleInsert(text: string, params: any[]): { rows: any[]; rowCount: number } {
    // Extract table name
    const intoMatch = text.match(/INTO\s+(\w+)/i);
    const table = intoMatch ? intoMatch[1] : 'unknown';

    if (!this.store[table]) {
      this.store[table] = new Map();
    }

    // Create a new record with auto-generated ID
    const id = `${table}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const record: any = { id };

    // Try to extract column names
    const columnsMatch = text.match(/\(([^)]+)\)/);
    if (columnsMatch) {
      const columns = columnsMatch[1].split(',').map(c => c.trim());
      columns.forEach((col, idx) => {
        record[col] = params[idx] !== undefined ? params[idx] : null;
      });
    }

    // Add timestamps
    record.created_at = new Date();
    record.updated_at = new Date();

    this.store[table].set(id, record);

    return { rows: [record], rowCount: 1 };
  }

  private handleUpdate(text: string, params: any[]): { rows: any[]; rowCount: number } {
    const updateMatch = text.match(/UPDATE\s+(\w+)/i);
    const table = updateMatch ? updateMatch[1] : 'unknown';

    if (!this.store[table]) {
      return { rows: [], rowCount: 0 };
    }

    // Update all records (simplified)
    let count = 0;
    this.store[table].forEach(record => {
      record.updated_at = new Date();
      count++;
    });

    return { rows: [], rowCount: count };
  }

  private handleDelete(text: string, params: any[]): { rows: any[]; rowCount: number } {
    const fromMatch = text.match(/FROM\s+(\w+)/i);
    const table = fromMatch ? fromMatch[1] : 'unknown';

    if (!this.store[table]) {
      return { rows: [], rowCount: 0 };
    }

    const count = this.store[table].size;
    this.store[table].clear();

    return { rows: [], rowCount: count };
  }

  async end(): Promise<void> {
    this.connected = false;
    logger.info('Database stub connection closed');
  }

  // Health check
  isConnected(): boolean {
    return this.connected;
  }
}

export const database = new DatabaseStub();
export default database;

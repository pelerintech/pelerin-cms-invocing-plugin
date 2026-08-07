/**
 * Ambient type declaration for the `pelerin:plugin-sdk` virtual module.
 * This is used ONLY by `tsc --noEmit` for type-checking the plugin source.
 * The actual module is provided at runtime by the CMS plugin system.
 *
 * Keep this minimal — only the parts of the SDK that the plugin actually uses.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'pelerin:plugin-sdk' {
  /**
   * Minimal shape of LibSQLDatabase from drizzle-orm.
   * We inline this rather than importing from 'drizzle-orm/libsql' because
   * drizzle-orm is a peer dependency of the CMS, not installed in the plugin.
   */
  interface DrizzleDb {
    select(): any;
    insert(into: any): any;
    update(table: any): any;
    delete(from: any): any;
    run(query: any): Promise<any>;
    execute(query: any): Promise<any>;
    all(query: any): Promise<any>;
    transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  }

  export interface User {
    id: string;
    email?: string | null;
    name?: string | null;
    role?: string | null;
    banned?: boolean | null;
  }

  export interface PluginContext {
    auth: {
      getUser(request: Request): Promise<User | null>;
      requireAdmin(request: Request): Promise<User>;
      withAuth(
        handler: (request: Request, user: User) => Promise<Response>
      ): (request: Request) => Promise<Response>;
    };
    collections: {
      listCollections(): Promise<any[]>;
      listItems(collectionId: string, params?: any): Promise<any>;
      getItem(collectionId: string, itemId: string): Promise<any>;
      getItemById(itemId: string): Promise<any>;
      createItem(collectionId: string, input: any, userId?: string): Promise<any>;
      updateItem(collectionId: string, itemId: string, input: any): Promise<any>;
      deleteItem(collectionId: string, itemId: string): Promise<void>;
      findByName(name: string): Promise<any>;
    };
    db: DrizzleDb;
    storage: {
      upload(
        file: Buffer,
        key: string,
        mimeType: string
      ): Promise<{ url: string; key: string; width?: number; height?: number }>;
      delete(key: string): Promise<void>;
      getUrl(key: string): string;
    };
    webhooks: {
      trigger(event: string, payload: Record<string, unknown>): Promise<void>;
    };
    events: {
      publish(event: string, payload: Record<string, unknown>): void;
      subscribe(
        event: string,
        handler: (payload: Record<string, unknown>) => void | Promise<void>
      ): () => void;
    };
  }

  export function createPluginContext(db?: DrizzleDb): PluginContext;
}

declare module "node:sqlite" {
  export interface StatementSync {
    run(...params: any[]): any;
    get<T = any>(...params: any[]): T;
    all<T = any>(...params: any[]): T[];
  }

  export class DatabaseSync {
    constructor(filename: string);
    exec(sql: string): void;
    pragma(statement: string): any;
    prepare(sql: string): StatementSync;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
  }
}

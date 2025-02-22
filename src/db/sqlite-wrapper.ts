import sqlite3 from '@vscode/sqlite3'

interface Row {
  [key: string]: any
}

export class Database {
  private db: sqlite3.Database

  constructor(filename: string, options: {readonly?: boolean; fileMustExist?: boolean} = {}) {
    const mode = options.readonly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
    this.db = new sqlite3.Database(filename, mode)
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql)
    return {
      get: (): Row | undefined => {
        return new Promise((resolve, reject) => {
          stmt.get((err: Error | null, row: Row) => {
            if (err) reject(err)
            resolve(row)
          })
        })
      },
      all: (): Row[] => {
        return new Promise((resolve, reject) => {
          stmt.all((err: Error | null, rows: Row[]) => {
            if (err) reject(err)
            resolve(rows)
          })
        })
      },
      run: (...params: any[]) => {
        return new Promise((resolve, reject) => {
          stmt.run(...params, (err: Error | null) => {
            if (err) reject(err)
            resolve(undefined)
          })
        })
      },
      finalize: () => {
        return new Promise((resolve, reject) => {
          stmt.finalize((err: Error | null) => {
            if (err) reject(err)
            resolve(undefined)
          })
        })
      },
    }
  }

  close() {
    return new Promise<void>((resolve, reject) => {
      this.db.close((err: Error | null) => {
        if (err) reject(err)
        resolve()
      })
    })
  }
}

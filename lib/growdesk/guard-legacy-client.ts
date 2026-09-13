/** Lazy initialization keeps even legacy module imports from opening SQLite in BFF mode. */
export function guardLegacyClient<T extends object>(disabled: () => boolean, initialize: () => T): T {
  let client: T | undefined;
  return new Proxy({} as T, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (disabled()) {
        throw new Error("GROWDESK_LEGACY_DB_DISABLED: 此入口尚未迁移，GrowDesk 模式禁止访问旧数据库");
      }
      client ??= initialize();
      const value: unknown = Reflect.get(client, property);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

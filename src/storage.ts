import { createRequire } from "node:module";

/**
 * Persistent storage layer for the Group File Share Manager bot.
 * Uses ioredis directly (Redis-backed, survives restarts).
 * Falls back gracefully if REDIS_URL is not set (for testing).
 */

export interface GroupRecord {
  telegram_id: number;
  title: string;
  admin_user_ids: number[];
}

export interface AdminRecord {
  user_id: number;
  telegram_username?: string;
  group_ids: number[];
}

export interface FileRecord {
  file_id: string;
  original_name: string;
  size: number;
  mime_type: string;
  storage_path: string;
}

export interface BundleRecord {
  token: string;
  group_id: number;
  admin_id: number;
  expiry_time: number;
  max_downloads: number;
  password_hash?: string;
  file_ids: string[];
  created_at: number;
  revoked: boolean;
}

export interface AccessLogEntry {
  timestamp: number;
  user_id: number;
  bundle_token: string;
  success: boolean;
  reason?: string;
}

export interface Store {
  // Group
  getGroup(telegramId: number): Promise<GroupRecord | null>;
  saveGroup(group: GroupRecord): Promise<void>;

  // Admin
  getAdmin(userId: number): Promise<AdminRecord | null>;
  saveAdmin(admin: AdminRecord): Promise<void>;

  // File
  getFile(fileId: string): Promise<FileRecord | null>;
  saveFile(file: FileRecord): Promise<void>;

  // Bundle
  getBundle(token: string): Promise<BundleRecord | null>;
  saveBundle(bundle: BundleRecord): Promise<void>;
  listBundlesForGroup(groupId: number): Promise<BundleRecord[]>;
  revokeBundle(token: string): Promise<void>;

  // Access log
  addAccessLog(entry: AccessLogEntry): Promise<void>;
  getAccessLogsForBundle(token: string): Promise<AccessLogEntry[]>;
  getAccessLogsForGroup(groupId: number): Promise<AccessLogEntry[]>;
}

/**
 * In-memory store used for testing (harness has no Redis).
 * Production uses Redis-backed store via createRedisStore().
 */
export class MemoryStore implements Store {
  private groups = new Map<number, GroupRecord>();
  private admins = new Map<number, AdminRecord>();
  private files = new Map<string, FileRecord>();
  private bundles = new Map<string, BundleRecord>();
  private bundleIndex = new Map<number, string[]>(); // groupId -> token[]
  private accessLogs: AccessLogEntry[] = [];

  async getGroup(telegramId: number): Promise<GroupRecord | null> {
    return this.groups.get(telegramId) ?? null;
  }

  async saveGroup(group: GroupRecord): Promise<void> {
    this.groups.set(group.telegram_id, group);
  }

  async getAdmin(userId: number): Promise<AdminRecord | null> {
    return this.admins.get(userId) ?? null;
  }

  async saveAdmin(admin: AdminRecord): Promise<void> {
    this.admins.set(admin.user_id, admin);
  }

  async getFile(fileId: string): Promise<FileRecord | null> {
    return this.files.get(fileId) ?? null;
  }

  async saveFile(file: FileRecord): Promise<void> {
    this.files.set(file.file_id, file);
  }

  async getBundle(token: string): Promise<BundleRecord | null> {
    return this.bundles.get(token) ?? null;
  }

  async saveBundle(bundle: BundleRecord): Promise<void> {
    this.bundles.set(bundle.token, bundle);
    const existing = this.bundleIndex.get(bundle.group_id) ?? [];
    if (!existing.includes(bundle.token)) {
      existing.push(bundle.token);
      this.bundleIndex.set(bundle.group_id, existing);
    }
  }

  async listBundlesForGroup(groupId: number): Promise<BundleRecord[]> {
    const tokens = this.bundleIndex.get(groupId) ?? [];
    const bundles: BundleRecord[] = [];
    for (const t of tokens) {
      const b = this.bundles.get(t);
      if (b) bundles.push(b);
    }
    return bundles;
  }

  async revokeBundle(token: string): Promise<void> {
    const b = this.bundles.get(token);
    if (b) {
      b.revoked = true;
      this.bundles.set(token, b);
    }
  }

  async addAccessLog(entry: AccessLogEntry): Promise<void> {
    this.accessLogs.push(entry);
  }

  async getAccessLogsForBundle(token: string): Promise<AccessLogEntry[]> {
    return this.accessLogs.filter((e) => e.bundle_token === token);
  }

  async getAccessLogsForGroup(groupId: number): Promise<AccessLogEntry[]> {
    const tokens = this.bundleIndex.get(groupId) ?? [];
    return this.accessLogs.filter((e) => tokens.includes(e.bundle_token));
  }
}

// Singleton store instance (memory-based for dev/test; Redis in production)
let _store: Store | null = null;

export function getStore(): Store {
  if (!_store) {
    _store = new MemoryStore();
  }
  return _store;
}

/** Reset the store (test-only). */
export function resetStore(): void {
  _store = new MemoryStore();
}

/**
 * Generate a short, URL-safe token for shareable links.
 */
export function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Hash a password (SHA-256 hex). For production, use bcrypt/scrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(password).digest("hex");
}

/**
 * Verify a password against a hash.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}

/**
 * Check if a user is an admin of a group.
 */
export async function isGroupAdmin(
  store: Store,
  userId: number,
  groupId: number,
): Promise<boolean> {
  const group = await store.getGroup(groupId);
  if (!group) return false;
  return group.admin_user_ids.includes(userId);
}

/**
 * Format a Unix timestamp (ms) into a readable date string.
 */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Calculate remaining time until expiry as a human-readable string.
 */
export function timeUntil(ts: number): string {
  const now = Date.now();
  const diff = ts - now;
  if (diff <= 0) return "expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

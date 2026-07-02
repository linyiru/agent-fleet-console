function ensureTableColumns(db, table, columns) {
  if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error("Invalid table name");
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const [name, definition] of columns) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Invalid column name");
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}


export function initializeDatabase(db, { builtinTemplates, nowIso }) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      soul TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_instance TEXT NOT NULL,
      source_node_id TEXT NOT NULL DEFAULT 'local',
      archive_file TEXT NOT NULL,
      archive_path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      manifest_json TEXT NOT NULL DEFAULT '{}',
      requirements_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instance_meta (
      instance TEXT PRIMARY KEY,
      template_id TEXT,
      template_version TEXT,
      local_ip TEXT NOT NULL DEFAULT '',
      local_host TEXT NOT NULL DEFAULT '',
      local_port INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      instance TEXT,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '{}',
      requested_by TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      instance TEXT,
      status TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drift_results (
      instance TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      template_id TEXT,
      findings_json TEXT NOT NULL DEFAULT '[]',
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS browser_state (
      instance TEXT PRIMARY KEY,
      ok INTEGER NOT NULL DEFAULT 0,
      profile_id TEXT,
      profile_count INTEGER NOT NULL DEFAULT 0,
      active_tabs INTEGER,
      active_sessions INTEGER,
      browser_connected INTEGER,
      persistence_enabled INTEGER NOT NULL DEFAULT 0,
      last_storage_save TEXT,
      vnc_url TEXT,
      lan_vnc_url TEXT,
      tabs_json TEXT NOT NULL DEFAULT '[]',
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_state (
      instance TEXT PRIMARY KEY,
      ok INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      data_dir TEXT,
      plugin_ok INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      last_write TEXT,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instance_observed_state (
      instance TEXT PRIMARY KEY,
      signature TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fleet_nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auth_token TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fleet_instance_meta (
      node_id TEXT NOT NULL,
      instance TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (node_id, instance)
    );
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_template_library_created ON template_library(created_at DESC);
  `);
  
  ensureTableColumns(db, "instance_meta", [
    ["local_ip", "TEXT NOT NULL DEFAULT ''"],
    ["local_host", "TEXT NOT NULL DEFAULT ''"],
    ["local_port", "INTEGER"],
    ["display_name", "TEXT NOT NULL DEFAULT ''"],
  ]);
  
  for (const template of builtinTemplates) {
    db.prepare(`
      INSERT INTO templates (id, name, category, description, soul, config_json, built_in, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '{}', 1, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(template.id, template.name, template.category, template.description, template.soul, nowIso(), nowIso());
  }

  db.prepare(`
    UPDATE jobs
    SET status = 'failed',
        error = 'Console restarted before this job completed.',
        completed_at = ?
    WHERE status = 'running'
  `).run(nowIso());
}

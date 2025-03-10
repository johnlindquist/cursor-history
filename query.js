import Database from "better-sqlite3"; const db = new Database(process.env.HOME + "/Library/Application Support/Cursor/User/globalStorage/state.vscdb", {readonly: true}); const items = db.prepare("SELECT value FROM cursorDiskKV WHERE key LIKE \"composerData:%\"").all(); for (const item of items) { try { const data = JSON.parse(item.value); const msg = data.conversation?.find(m => m.bubbleId === "517fb770-cce6-4cca-ad42-d409342ac3b2"); if (msg?.codeBlocks?.length) console.log(JSON.stringify(msg.codeBlocks, null, 2)); } catch {} }

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

// --- Re-used function ---
function getCursorDbPath(): null | string {
    const os = platform();
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return null;

    let basePath: string;
    switch (os) {
        case 'darwin': {
            basePath = join(home, 'Library/Application Support/Cursor');
            break;
        }

        case 'linux': {
            basePath = join(home, '.config/Cursor');
            break;
        }

        case 'win32': {
            basePath = join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor');
            break;
        }

        default: {
            return null;
        }
    }

    // Use the confirmed path from Step 1
    return join(basePath, 'User/globalStorage/state.vscdb');
}
// --- END Re-used function ---

async function main() { // Wrap in async function
    const globalDbPath = getCursorDbPath();
    if (!globalDbPath || !existsSync(globalDbPath)) {
        console.log('Global database not found.');
        // process.exit(1); // Avoid process.exit within async main, let it throw
        throw new Error("Global database not found.");
    }

    console.log(`--- Inspecting Global DB: ${globalDbPath} ---`);
    let db: Database.Database | null = null;
    try {
        console.log("Attempting to connect to DB...");
        db = new Database(globalDbPath, { fileMustExist: true, readonly: true });
        console.log("DB Connected.");

        // --- Get ALL keys first to investigate patterns ---
        console.log("Fetching all keys from cursorDiskKV...");
        let allKeysResult: { key: string }[];
        try {
            allKeysResult = db.prepare("SELECT key FROM cursorDiskKV").all() as { key: string }[];
        } catch (dbError) {
            console.error("Error fetching keys from DB:", dbError);
            throw dbError; // Re-throw to be caught by outer catch
        }

        console.log("Keys fetched.");

        const allKeys = allKeysResult.map(row => row.key);
        console.log(`Total keys found: ${allKeys.length}`);

        // Log a sample of keys, filtering for potential history/conversation related ones
        const potentialHistoryKeys = allKeys.filter(key =>
            key && ( // Add null/undefined check for key
                key.toLowerCase().includes('history') ||
                key.toLowerCase().includes('conversation') ||
                key.toLowerCase().includes('composer') ||
                key.toLowerCase().includes('chat')
            )
            // Add more potential keywords if needed
        );

        console.log(`\nFound ${potentialHistoryKeys.length} keys potentially related to history/conversations.`);
        console.log("Sample potential keys:");
        console.log(potentialHistoryKeys.slice(0, 20)); // Log the first 20 potential keys

        // --- Now try fetching based on observed patterns (or original patterns if nothing else found) ---
        console.log("\nAttempting to fetch data with known/previous patterns...");
        const historyPattern = 'historyData:%';
        const composerPattern = 'composerData:%';

        const historyRows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ? LIMIT 5").all(historyPattern) as { key: string; value: Buffer }[];

        if (historyRows.length > 0) {
            console.log(`Found ${historyRows.length} rows matching '${historyPattern}'. Analyzing structure:\n`);
            processRows(historyRows);
        } else {
            console.log(`No rows found matching '${historyPattern}'. Trying '${composerPattern}'...`);
            const composerRows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ? LIMIT 5").all(composerPattern) as { key: string; value: Buffer }[];
            if (composerRows.length > 0) {
                console.log(`Found ${composerRows.length} rows matching '${composerPattern}'. Analyzing structure:\n`);
                processRows(composerRows);
            } else {
                console.log(`No rows found matching '${composerPattern}' either. Data might be stored differently or under a new key pattern.`);
            }
        }

    } catch (error) {
        // Error is now caught by the .catch() below
        console.error("An error occurred during main execution:", error);
        throw error; // Re-throw to be caught by the final catch
    } finally {
        if (db) {
            console.log("Closing DB connection...");
            db.close();
            console.log("DB Closed.");
        } else {
            console.log("DB connection was not established or already closed.");
        }
    }
}

// Helper function to process rows and avoid repetition
function processRows(rows: { key: string; value: Buffer }[]) {
    for (const [index, row] of rows.entries()) {
        console.log(`--- Row ${index + 1} (Key: ${row.key}) ---`);
        let rawValue: string | undefined;
        try {
            if (!row.value) {
                console.log("  Value is null or undefined.");
                continue;
            }

            console.log(`  Attempting to convert buffer (length: ${row.value.length}) to string...`);
            rawValue = row.value.toString('utf8');
            console.log("  Buffer converted. Attempting to parse JSON...");
            const data = JSON.parse(rawValue);
            console.log("  JSON Parsed successfully.");

            // --- Deeper Analysis --- 
            if ('composerId' in data && Array.isArray(data.conversation)) {
                console.log(`\n  Found 'conversation' array with ${data.conversation.length} items.`);
                // Analyze the first few items (e.g., up to 5)
                const itemsToAnalyze = data.conversation.slice(0, 5);
                for (const [itemIndex, convoItem] of itemsToAnalyze.entries()) {
                    console.log(`\n  Analyzing item ${itemIndex + 1} in 'conversation' array:`);
                    analyzeConversationItem(convoItem, "    "); // Call analysis function for each item
                }
            } else {
                console.log("  Structure doesn't match expected pattern (composerId + conversation array).");
            }

            // Keep raw value logging if needed for context
            // console.log(`\n  Raw Value (truncated): ${rawValue.slice(0, 500) + (rawValue.length > 500 ? '...' : '')}`);

        } catch (error) {
            console.error(`Error processing row for key ${row.key}:`, error);
            if (error instanceof SyntaxError) {
                console.log('  Potentially malformed JSON.');
            }

            const rawSlice = rawValue?.slice(0, 500) ?? '';
            const rawSuffix = rawValue && rawValue.length > 500 ? '...' : '';
            console.log(`\n  Raw Value (Buffer as string, if available): ${rawSlice}${rawSuffix}`);
        }

        console.log(`--- End Row ${index + 1} ---\n`);
    }
}

// Updated Helper function to analyze the structure within a conversation item
function analyzeConversationItem(item: any, indent: string) {
    if (typeof item !== 'object' || item === null) {
        console.log(`${indent}Item is not an object.`);
        return;
    }

    // Log the type first, as it might indicate the role
    console.log(`${indent}Item Type: ${item.type}`);
    console.log(`${indent}Top-level keys: ${Object.keys(item)}`);
    console.log(`${indent}Has 'text': ${'text' in item} (type: ${typeof item.text}, length: ${item.text?.length})`);
    console.log(`${indent}Has 'richText': ${'richText' in item} (type: ${typeof item.richText})`);
    console.log(`${indent}Has 'bubbleId': ${'bubbleId' in item} (type: ${typeof item.bubbleId})`);
    // console.log(`${indent}Has 'type': ${'type' in item} (value: ${item.type})`); // Redundant logging of type

    // Attempt to parse richText if it's a string
    if (typeof item.richText === 'string' && item.richText.trim().startsWith('{')) {
        console.log(`${indent}Attempting to parse 'richText' as JSON...`);
        try {
            const richTextData = JSON.parse(item.richText);
            console.log(`${indent}Successfully parsed 'richText'.`);
            analyzeRichTextData(richTextData, indent + "  ");
        } catch (parseError) {
            console.error(`${indent}Error parsing 'richText' JSON:`, parseError);
            // Log only a small part of rich text on error to avoid huge logs
            console.log(`${indent}Raw richText (sample): ${item.richText.slice(0, 100)}...`);
        }
    } else if (item.text && item.text.length > 0 && !item.richText) {
        // If richText is empty/missing but text exists, log the text directly
        console.log(`${indent}Item has text but no parsable richText. Text (sample): ${item.text.slice(0, 100)}...`);
    } else {
        console.log(`${indent}'richText' is not a JSON string or is empty, and direct text is also empty.`);
    }
}

// NEW Helper function to analyze the parsed richText data
function analyzeRichTextData(data: any, indent: string) {
    if (typeof data !== 'object' || data === null) {
        console.log(`${indent}Parsed richText data is not an object.`);
        return;
    }

    console.log(`${indent}Parsed richText Top-level keys: ${Object.keys(data)}`);

    // Look for common structures like a root->children pattern (ProseMirror?)
    if (data.root && data.root.children && Array.isArray(data.root.children)) {
        console.log(`${indent}Found 'root.children' array (length: ${data.root.children.length}).`);
        const {children} = data.root;
        // Analyze the first few children
        for (let i = 0; i < Math.min(children.length, 3); i++) {
            const child = children[i];
            console.log(`${indent} Child ${i + 1} type: ${child.type}`);
            console.log(`${indent} Child ${i + 1} keys: ${Object.keys(child)}`);
            // Check if a child looks like a message container
            if (child.type === 'paragraph' && child.children && Array.isArray(child.children)) {
                console.log(`${indent}  Paragraph has ${child.children.length} children.`);
                // You might need to recurse further here depending on the structure
                // For now, just log the first sub-child's keys if it exists
                if (child.children.length > 0) {
                    console.log(`${indent}  First sub-child keys: ${Object.keys(child.children[0])}`);
                    console.log(`${indent}  First sub-child text (sample): ${JSON.stringify(child.children[0].text)?.slice(0, 100)}`);
                }
            }

            // Log code block content directly if found
            if (child.type === 'code' && child.content) {
                console.log(`${indent}  Code block content (sample): ${JSON.stringify(child.content[0]?.text)?.slice(0, 100)}`);
            }
        }
    } else {
        console.log(`${indent}Parsed richText structure does not match expected root.children pattern.`);
        // Log raw data if structure unknown
        // console.log(JSON.stringify(data, null, 2));
    }
}

// Call async main and catch errors
main().catch(finalError => {
    console.error("Script finished with an error:", finalError);
    process.exitCode = 1;
}); 
#!/usr/bin/env node

// Set production mode before importing to prevent TypeScript detection
process.env.NODE_ENV = "production";

import { execute } from "@oclif/core";

await execute({ dir: import.meta.url });

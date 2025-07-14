#!/usr/bin/env node

import { execute } from "@oclif/core";

await execute({
	// Explicitly set production mode to avoid TypeScript checks
	development: false,
	dir: import.meta.url,
});

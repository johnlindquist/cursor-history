import { encoding_for_model } from "tiktoken";

// Supported models and their encodings
const MODEL_ENCODINGS: Record<string, string> = {
    "gpt-4": "cl100k_base",
    "gpt-3.5-turbo": "cl100k_base"
};

export function countTokens(text: string, model = "gpt-4"): number {
    const encodingName = MODEL_ENCODINGS[model];
    if (!encodingName) {
        throw new Error(`Unsupported model: ${model}`);
    }

    const enc = encoding_for_model(model);
    const tokens = enc.encode(text);
    enc.free(); // Important: free the encoding when done
    return tokens.length;
} 
import { encoding_for_model, TiktokenModel } from "tiktoken";

// Supported models and their encodings
const MODEL_ENCODINGS: Record<TiktokenModel, string> = {
    "gpt-3.5-turbo": "cl100k_base",
    "gpt-4": "cl100k_base"
};

export function countTokens(text: string, model: TiktokenModel = "gpt-4"): number {
    const encodingName = MODEL_ENCODINGS[model];
    if (!encodingName) {
        throw new Error(`Unsupported model: ${model}`);
    }

    const enc = encoding_for_model(model);
    const tokens = enc.encode(text);
    enc.free(); // Important: free the encoding when done
    return tokens.length;
} 
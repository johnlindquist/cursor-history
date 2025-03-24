import { get_encoding } from 'tiktoken';

export function countTokens(text: string, model: string = 'gpt-4'): number {
    try {
        const encoder = get_encoding('cl100k_base');
        const tokens = encoder.encode(text);
        return tokens.length;
    } catch (error) {
        console.error('Error counting tokens:', error);
        return 0;
    }
} 
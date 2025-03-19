import { expect } from 'chai'

import { formatMessage } from '../../src/utils/formatting.js'

describe('Metadata rendering', () => {
    it('should include extra metadata fields in the output', () => {
        const message = {
            metadata: {
                anotherCustomKey: { nested: 'object', with: ['array', 'values'] },
                cursorContextFiles: ['file1.ts', 'file2.ts'],
                customKey: 'customValue'
            },
            role: 'Assistant',
            text: 'Some assistant text'
        }

        const result = formatMessage(message as any)

        // Check that customKey is rendered
        expect(result).to.contain('**Additional Metadata:**')
        expect(result).to.contain('**customKey**: "customValue"')
        expect(result).to.contain('**anotherCustomKey**:')

        // Check that known keys are not included in additional metadata
        expect(result).to.not.contain('**cursorContextFiles**:')
    })

    it('should not include additional metadata section when there are no extra fields', () => {
        const message = {
            metadata: {
                cursorContextEndLine: 20,
                cursorContextFiles: ['file1.ts'],
                cursorContextSelectedFile: 'file1.ts',
                cursorContextStartLine: 10
            },
            role: 'Assistant',
            text: 'Some assistant text'
        }

        const result = formatMessage(message as any)

        // Should not have additional metadata section
        expect(result).to.not.contain('**Additional Metadata:**')
    })
}) 
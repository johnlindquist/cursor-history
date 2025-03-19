import { expect } from 'chai'
import { formatMessage } from '../../src/utils/formatting.js'

describe('Metadata rendering', () => {
    it('should include extra metadata fields in the output', () => {
        const message = {
            role: 'Assistant',
            text: 'Some assistant text',
            metadata: {
                customKey: 'customValue',
                anotherCustomKey: { nested: 'object', with: ['array', 'values'] },
                cursorContextFiles: ['file1.ts', 'file2.ts']
            }
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
            role: 'Assistant',
            text: 'Some assistant text',
            metadata: {
                cursorContextFiles: ['file1.ts'],
                cursorContextSelectedFile: 'file1.ts',
                cursorContextStartLine: 10,
                cursorContextEndLine: 20
            }
        }

        const result = formatMessage(message as any)

        // Should not have additional metadata section
        expect(result).to.not.contain('**Additional Metadata:**')
    })
}) 
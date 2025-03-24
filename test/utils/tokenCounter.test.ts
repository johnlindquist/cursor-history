import { expect } from "chai";
import { countTokens } from "../../src/utils/tokenCounter.js";

describe("tokenCounter", () => {
    it("counts tokens correctly", () => {
        expect(countTokens("Hello world")).to.be.a("number");
        expect(countTokens("Hello world")).to.be.greaterThan(0);
    });
}); 
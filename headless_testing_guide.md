# Headless Testing Guide for Z80 Simulator

This guide documents the usage of `Main.runHeadless()` for automated verification of the Z80 Simulator. This mechanism bypasses the UI (Editor, Buttons, DOM Checks) to execute tests instantly and reliably.

## Function Signature
```javascript
Main.runHeadless(sourceCode, maxCycles = 100000)
```

## Parameters
-   `sourceCode` (string): The Z80 assembly code. You can use `:` as a line separator (e.g., `LD A, 1 : HALT`).
-   `maxCycles` (number, optional): Safety limit to prevent infinite loops. Default is 100,000.

## Return Value
Returns a JSON object:
```json
{
    "success": boolean,       // true if ran to HALT without errors
    "halted": boolean,        // true if CPU hit HALT instruction
    "cycles": number,         // Total executed cycles
    "ports": {
        "0": number,          // Value of Port 0 (LEDs)
        "16": number,         // Value of Port 0x10 (Left 7-seg)
        "23": number          // Value of Port 0x17 (Right 7-seg)
    },
    "error": string | null    // Error message if failed
}
```

## Usage Example (for Browser Subagent)

To verify a feature (e.g., standard addition), execute this JavaScript in the browser:

```javascript
return Main.runHeadless(`
    LD A, 10
    ADD A, 20
    OUT (0x17), A  ; Expected 30 (0x1E)
    HALT
`);
```

**Expected Result:**
```json
{
    "success": true,
    "ports": { "23": 30 },
    ...
}
```

## Why use this?
-   **Speed**: Runs at max JS speed, no rendering overhead.
-   **Reliability**: No dependency on DOM element states or CSS classes.
-   **Simplicity**: Single step execution reduces agent confirmation fatigue.

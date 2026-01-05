/**
 * Z80 Simulator - Core Logic
 */

// --- Classes ---

class Memory {
    constructor() {
        this.data = new Uint8Array(65536);
    }
    reset() { this.data.fill(0); }
    read(addr) { return this.data[addr & 0xFFFF]; }
    write(addr, val) {
        this.data[addr & 0xFFFF] = val & 0xFF;
        if (addr >= 0x8000 && typeof Main !== 'undefined' && Main.logEnabled) {
            console.log(`MEM: Write 0x${addr.toString(16)} <= ${val}`);
        }
    }
    load(addr, bytes) {
        for (let i = 0; i < bytes.length; i++) this.write(addr + i, bytes[i]);
    }
}

class IOController {
    constructor() {
        this.outHandlers = new Map();
        this.inHandlers = new Map();
    }
    reset() { }
    bindCPU(cpu) { this.cpu = cpu; }
    onOut(port, fn) { this.outHandlers.set(port, fn); }
    onIn(port, fn) { this.inHandlers.set(port, fn); }
    out(port, val) {
        const h = this.outHandlers.get(port);
        if (h) h(val);
    }
    in(port) {
        const h = this.inHandlers.get(port);
        return h ? h() : 0xFF;
    }
    triggerInterrupt() {
        if (this.cpu) {
            if (typeof Main !== 'undefined' && Main.logEnabled) console.log('IOController: Triggering Interrupt');
            this.cpu.interrupt();
        }
    }
}

class Z80 {
    constructor(memory, io) {
        this.mem = memory;
        this.io = io;
        this.reg = {
            A: 0, F: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0,
            PC: 0, SP: 0xFFFF, IX: 0, IY: 0
        };
        this.halted = false;
        this.halted = false;
        this.prefix = 0;
        this.iff1 = 0;
        this.im = 0;
        this.interruptPending = false;
        this.reg_prime = { A: 0, F: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0 };
        this.reg.I = 0; this.reg.R = 0;
        this.iff2 = 0;
    }

    reset() {
        this.reg.PC = 0;
        this.reg.SP = 0xFFFF;
        this.reg.B = 0; this.reg.C = 0;
        this.reg.D = 0; this.reg.E = 0;
        this.reg.H = 0; this.reg.L = 0;
        this.reg.IX = 0; this.reg.IY = 0;
        this.reg_prime = { A: 0, F: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0 };
        this.halted = false;
        this.halted = false;
        this.iff1 = 0; this.iff2 = 0;
        this.im = 0;
        this.interruptPending = false;
        this.prefix = 0; // 0=None, 1=IX, 2=IY
    }

    // Flags: S Z Y H X P/V N C
    setZ(v) { if ((v & 0xFF) === 0) this.reg.F |= 0x40; else this.reg.F &= ~0x40; }
    setS(v) { if (v & 0x80) this.reg.F |= 0x80; else this.reg.F &= ~0x80; }

    fetch() { return this.mem.read(this.reg.PC++); }
    fetch16() {
        const l = this.fetch();
        const h = this.fetch();
        return (h << 8) | l;
    }
    fetchSigned() {
        const v = this.fetch();
        return (v & 0x80) ? v - 256 : v;
    }

    push(val) {
        this.reg.SP--;
        if (this.reg.SP < 0 || this.reg.SP > 0xFFFF) {
            this.halted = true;
            throw new Error(`Stack Overflow/Underflow: SP out of bounds (0x${this.reg.SP.toString(16).toUpperCase()})`);
        }
        this.mem.write(this.reg.SP, (val >> 8) & 0xFF);

        this.reg.SP--;
        if (this.reg.SP < 0 || this.reg.SP > 0xFFFF) {
            this.halted = true;
            throw new Error(`Stack Overflow/Underflow: SP out of bounds (0x${this.reg.SP.toString(16).toUpperCase()})`);
        }
        this.mem.write(this.reg.SP, val & 0xFF);
    }
    pop() {
        if (this.reg.SP < 0 || this.reg.SP > 0xFFFF) {
            this.halted = true;
            throw new Error(`Stack Overflow/Underflow: SP at 0x${this.reg.SP.toString(16).toUpperCase()}`);
        }
        const l = this.mem.read(this.reg.SP++);

        if (this.reg.SP < 0 || this.reg.SP > 0xFFFF) {
            this.halted = true;
            throw new Error(`Stack Overflow/Underflow: SP at 0x${this.reg.SP.toString(16).toUpperCase()}`);
        }
        const h = this.mem.read(this.reg.SP++);
        return (h << 8) | l;
    }

    arith8(op, val) {
        const r = this.reg;
        let res = 0;
        let c_in = (r.F & 1);
        let h_in = 0; // for H calc for ADC/SBC

        switch (op) {
            case 0: // ADD
                res = r.A + val;
                h_in = (r.A & 0xF) + (val & 0xF);
                r.F = 0;
                if (res > 0xFF) r.F |= 1; // C
                if (h_in > 0xF) r.F |= 0x10; // H
                // P/V (Overflow)
                if (((r.A ^ ~val) & (r.A ^ res) & 0x80)) r.F |= 0x04;
                break;
            case 1: // ADC
                res = r.A + val + c_in;
                h_in = (r.A & 0xF) + (val & 0xF) + c_in;
                r.F = 0;
                if (res > 0xFF) r.F |= 1; // C
                if (h_in > 0xF) r.F |= 0x10; // H
                // P/V
                if (((r.A ^ ~val) & (r.A ^ res) & 0x80)) r.F |= 0x04;
                break;
            case 2: // SUB
                res = r.A - val;
                h_in = (r.A & 0xF) - (val & 0xF);
                r.F = 0x02; // N=1
                if (res < 0) r.F |= 1; // C
                if (h_in < 0) r.F |= 0x10; // H
                if (((r.A ^ val) & (r.A ^ res) & 0x80)) r.F |= 0x04; // P/V
                break;
            case 3: // SBC
                res = r.A - val - c_in;
                h_in = (r.A & 0xF) - (val & 0xF) - c_in;
                r.F = 0x02; // N=1
                if (res < 0) r.F |= 1; // C
                if (h_in < 0) r.F |= 0x10; // H
                if (((r.A ^ val) & (r.A ^ res) & 0x80)) r.F |= 0x04; // P/V
                break;
            case 4: // AND
                res = r.A & val;
                r.F = 0x10; // H=1, N=0, C=0
                // P/V (Parity)
                { let p = res; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1; if (!(p & 1)) r.F |= 0x04; }
                break;
            case 5: // XOR
                res = r.A ^ val;
                r.F = 0; // H=0, N=0, C=0
                // P/V (Parity)
                { let p = res; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1; if (!(p & 1)) r.F |= 0x04; }
                break;
            case 6: // OR
                res = r.A | val;
                r.F = 0;
                // P/V (Parity)
                { let p = res; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1; if (!(p & 1)) r.F |= 0x04; }
                break;
            case 7: // CP
                res = r.A - val;
                h_in = (r.A & 0xF) - (val & 0xF);
                r.F = 0x02; // N=1
                if (res < 0) r.F |= 1; // C
                if (h_in < 0) r.F |= 0x10; // H
                if (((r.A ^ val) & (r.A ^ res) & 0x80)) r.F |= 0x04; // V
                break;
        }

        const res8 = res & 0xFF;
        if (res8 === 0) r.F |= 0x40; // Z
        if (res8 & 0x80) r.F |= 0x80; // S

        // Output bits 3 and 5 are undocumented but often copy from Acc. Ignoring for simple Sim.

        if (op !== 7) r.A = res8;
    }

    interrupt() {
        // console.log(`CPU: Interrupt Request. IFF1=${this.iff1}`);
        // Latch interrupt request regardless of IFF1 (Fix for Reset period)
        this.interruptPending = true;
        if (this.iff1) {
            this.halted = false;
        }
    }

    step() {
        if (this.interruptPending && this.iff1) {
            // console.log('CPU: Acknowledging Interrupt. jumping to ISR.');
            this.iff1 = 0;
            this.interruptPending = false;
            this.push(this.reg.PC);
            if (this.im === 1) this.reg.PC = 0x0038;
            return;
        }

        if (this.halted) return;

        let op = this.fetch();
        this.prefix = 0;

        // Loop for prefixes (support multiple prefixes? Just IX/IY for now implementation)
        while (op === 0xDD || op === 0xFD) {
            this.prefix = (op === 0xDD) ? 0xDD : 0xFD;
            op = this.fetch();
        }

        this.execute(op);
        // Prefix resets each step implicitly by the variable init above.
    }

    // Helpers for Indexing
    getH() {
        if (this.prefix === 0xDD) return (this.reg.IX >> 8) & 0xFF;
        if (this.prefix === 0xFD) return (this.reg.IY >> 8) & 0xFF;
        return this.reg.H;
    }
    setH(v) {
        if (this.prefix === 0xDD) this.reg.IX = (this.reg.IX & 0x00FF) | ((v & 0xFF) << 8);
        else if (this.prefix === 0xFD) this.reg.IY = (this.reg.IY & 0x00FF) | ((v & 0xFF) << 8);
        else this.reg.H = v & 0xFF;
    }
    getL() {
        if (this.prefix === 0xDD) return this.reg.IX & 0xFF;
        if (this.prefix === 0xFD) return this.reg.IY & 0xFF;
        return this.reg.L;
    }
    setL(v) {
        if (this.prefix === 0xDD) this.reg.IX = (this.reg.IX & 0xFF00) | (v & 0xFF);
        else if (this.prefix === 0xFD) this.reg.IY = (this.reg.IY & 0xFF00) | (v & 0xFF);
        else this.reg.L = v & 0xFF;
    }

    getHL() {
        if (this.prefix === 0xDD) return this.reg.IX & 0xFFFF;
        if (this.prefix === 0xFD) return this.reg.IY & 0xFFFF;
        return (this.reg.H << 8) | this.reg.L;
    }
    setHL(v) {
        if (this.prefix === 0xDD) this.reg.IX = v & 0xFFFF;
        else if (this.prefix === 0xFD) this.reg.IY = v & 0xFFFF;
        else { this.reg.H = v >> 8; this.reg.L = v & 0xFF; }
    }

    getAddrHL() {
        if (this.prefix === 0xDD || this.prefix === 0xFD) {
            const d = this.fetch(); // Displacement
            const off = d > 127 ? d - 256 : d;
            return (this.getHL() + off) & 0xFFFF;
        }
        return (this.reg.H << 8) | this.reg.L;
    }

    execute(op) {
        const r = this.reg;
        switch (op) {
            case 0x00: break; // NOP

            // 16-bit Loads
            case 0x01: { const v = this.fetch16(); r.B = v >> 8; r.C = v & 0xFF; } break;
            case 0x11: { const v = this.fetch16(); r.D = v >> 8; r.E = v & 0xFF; } break;
            case 0x21: { this.setHL(this.fetch16()); } break; // LD HL, nn (Index aware)
            case 0x31: { r.SP = this.fetch16(); } break;

            // Indirect Loading (BC/DE)
            case 0x02: { this.mem.write((r.B << 8) | r.C, r.A); } break; // LD (BC), A
            case 0x12: { this.mem.write((r.D << 8) | r.E, r.A); } break; // LD (DE), A
            case 0x0A: { r.A = this.mem.read((r.B << 8) | r.C); } break; // LD A, (BC)
            case 0x1A: { r.A = this.mem.read((r.D << 8) | r.E); } break; // LD A, (DE)

            // 16-bit INC/DEC
            case 0x03: { let v = (r.B << 8) | r.C; v = (v + 1) & 0xFFFF; r.B = v >> 8; r.C = v & 0xFF; } break;
            case 0x13: { let v = (r.D << 8) | r.E; v = (v + 1) & 0xFFFF; r.D = v >> 8; r.E = v & 0xFF; } break;
            case 0x23: { this.setHL((this.getHL() + 1) & 0xFFFF); } break; // INC HL (Index)
            case 0x33: {
                r.SP++;
                if (r.SP > 0xFFFF) {
                    this.halted = true;
                    throw new Error(`Stack Overflow: SP out of bounds (0x${r.SP.toString(16).toUpperCase()})`);
                }
            } break;

            case 0x0B: { let v = (r.B << 8) | r.C; v = (v - 1) & 0xFFFF; r.B = v >> 8; r.C = v & 0xFF; } break;
            case 0x1B: { let v = (r.D << 8) | r.E; v = (v - 1) & 0xFFFF; r.D = v >> 8; r.E = v & 0xFF; } break;
            case 0x2B: { this.setHL((this.getHL() - 1) & 0xFFFF); } break; // DEC HL (Index)
            case 0x3B: {
                r.SP--;
                if (r.SP < 0) {
                    this.halted = true;
                    throw new Error(`Stack Underflow: SP out of bounds (0x${r.SP.toString(16).toUpperCase()})`);
                }
            } break;

            // 8-bit INC
            case 0x04: r.B = (r.B + 1) & 0xFF; this.setZ(r.B); this.setS(r.B); break;
            case 0x0C: r.C = (r.C + 1) & 0xFF; this.setZ(r.C); this.setS(r.C); break;
            case 0x14: r.D = (r.D + 1) & 0xFF; this.setZ(r.D); this.setS(r.D); break;
            case 0x1C: r.E = (r.E + 1) & 0xFF; this.setZ(r.E); this.setS(r.E); break;
            case 0x24: { const v = (this.getH() + 1) & 0xFF; this.setH(v); this.setZ(v); this.setS(v); } break; // INC H
            case 0x2C: { const v = (this.getL() + 1) & 0xFF; this.setL(v); this.setZ(v); this.setS(v); } break; // INC L
            case 0x3C: r.A = (r.A + 1) & 0xFF; this.setZ(r.A); this.setS(r.A); break;
            // INC (HL) (0x34)
            case 0x34: { const addr = this.getAddrHL(); const v = (this.mem.read(addr) + 1) & 0xFF; this.mem.write(addr, v); this.setZ(v); this.setS(v); } break;

            // 8-bit DEC
            case 0x05: r.B = (r.B - 1) & 0xFF; this.setZ(r.B); this.setS(r.B); break;
            case 0x0D: r.C = (r.C - 1) & 0xFF; this.setZ(r.C); this.setS(r.C); break;
            case 0x15: r.D = (r.D - 1) & 0xFF; this.setZ(r.D); this.setS(r.D); break;
            case 0x1D: r.E = (r.E - 1) & 0xFF; this.setZ(r.E); this.setS(r.E); break;
            case 0x25: { const v = (this.getH() - 1) & 0xFF; this.setH(v); this.setZ(v); this.setS(v); } break; // DEC H
            case 0x2D: { const v = (this.getL() - 1) & 0xFF; this.setL(v); this.setZ(v); this.setS(v); } break; // DEC L
            case 0x3D: r.A = (r.A - 1) & 0xFF; this.setZ(r.A); this.setS(r.A); break;
            // DEC (HL) (0x35)
            case 0x35: { const addr = this.getAddrHL(); const v = (this.mem.read(addr) - 1) & 0xFF; this.mem.write(addr, v); this.setZ(v); this.setS(v); } break;

            // 8-bit LD Immediate
            case 0x06: r.B = this.fetch(); break;
            case 0x0E: r.C = this.fetch(); break;
            case 0x16: r.D = this.fetch(); break;
            case 0x1E: r.E = this.fetch(); break;
            case 0x26: this.setH(this.fetch()); break; // LD H, n
            case 0x2E: this.setL(this.fetch()); break; // LD L, n
            case 0x3E: r.A = this.fetch(); break;
            // LD (HL), n (0x36)
            case 0x36: { const addr = this.getAddrHL(); const v = this.fetch(); this.mem.write(addr, v); } break;

            // Rotates (Acc)
            case 0x07: { const b = (r.A >> 7); r.A = ((r.A << 1) | b) & 0xFF; r.F = (r.F & 0xEC) | b; } break; // RLCA
            case 0x0F: { const b = r.A & 1; r.A = ((r.A >> 1) | (b << 7)) & 0xFF; r.F = (r.F & 0xEC) | b; } break; // RRCA
            case 0x17: { const b = (r.A >> 7); const c = r.F & 1; r.A = ((r.A << 1) | c) & 0xFF; r.F = (r.F & 0xEC) | b; } break; // RLA
            case 0x1F: { const b = r.A & 1; const c = r.F & 1; r.A = ((r.A >> 1) | (c << 7)) & 0xFF; r.F = (r.F & 0xEC) | b; } break; // RRA

            // 16-bit ADD (0x09...)
            case 0x09: { const hl = this.getHL(); const v = (r.B << 8) | r.C; const res = hl + v; this.setHL(res & 0xFFFF); if (res > 0xFFFF) r.F |= 1; else r.F &= ~1; r.F &= ~0x02; if ((res & 0x800) ^ ((hl ^ v) & 0x800)) r.F |= 0x10; else r.F &= ~0x10; break; }
            case 0x19: { const hl = this.getHL(); const v = (r.D << 8) | r.E; const res = hl + v; this.setHL(res & 0xFFFF); if (res > 0xFFFF) r.F |= 1; else r.F &= ~1; r.F &= ~0x02; if ((res & 0x800) ^ ((hl ^ v) & 0x800)) r.F |= 0x10; else r.F &= ~0x10; break; }
            case 0x29: {
                const hl = this.getHL(); const v = this.getHL(); const res = hl + v;
                this.setHL(res & 0xFFFF);
                if (res > 0xFFFF) r.F |= 1; else r.F &= ~1;
                r.F &= ~0x02;
                if ((res & 0x800) ^ ((hl ^ v) & 0x800)) r.F |= 0x10; else r.F &= ~0x10;
                break;
            }
            case 0x39: { const hl = this.getHL(); const v = r.SP; const res = hl + v; this.setHL(res & 0xFFFF); if (res > 0xFFFF) r.F |= 1; else r.F &= ~1; r.F &= ~0x02; if ((res & 0x800) ^ ((hl ^ v) & 0x800)) r.F |= 0x10; else r.F &= ~0x10; break; }

            // JR
            case 0x18: { const e = this.fetchSigned(); r.PC = (r.PC + e) & 0xFFFF; } break;
            case 0x20: { const e = this.fetchSigned(); if (!(r.F & 0x40)) r.PC = (r.PC + e) & 0xFFFF; } break;
            case 0x28: { const e = this.fetchSigned(); if (r.F & 0x40) r.PC = (r.PC + e) & 0xFFFF; } break;
            case 0x30: { const e = this.fetchSigned(); if (!(r.F & 1)) r.PC = (r.PC + e) & 0xFFFF; } break;
            case 0x38: { const e = this.fetchSigned(); if (r.F & 1) r.PC = (r.PC + e) & 0xFFFF; } break;

            // DJNZ
            case 0x10: { const e = this.fetchSigned(); r.B = (r.B - 1) & 0xFF; if (r.B !== 0) r.PC = (r.PC + e) & 0xFFFF; } break;

            // LD 16-bit from/to Memory
            case 0x22: { const addr = this.fetch16(); const v = this.getHL(); this.mem.write(addr, v & 0xFF); this.mem.write(addr + 1, v >> 8); } break; // LD (nn), HL
            case 0x2A: { const addr = this.fetch16(); const l = this.mem.read(addr); const h = this.mem.read(addr + 1); this.setHL((h << 8) | l); } break; // LD HL, (nn)
            case 0x32: { const addr = this.fetch16(); this.mem.write(addr, r.A); } break; // LD (nn), A
            case 0x3A: { const addr = this.fetch16(); r.A = this.mem.read(addr); } break; // LD A, (nn)

            // DAA (0x27)
            case 0x27: {
                let a = r.A;
                let corr = 0;
                if ((r.F & 0x10) || (a & 0x0F) > 9) corr += 0x06;
                if ((r.F & 1) || a > 0x99) { corr += 0x60; r.F |= 1; }
                if (r.F & 0x02) { // Subtract (N=1)
                    a = (a - corr) & 0xFF;
                    if (!(r.F & 1)) r.F &= ~0x10; // Half Carry handling for Sub
                } else { // Add (N=0)
                    if ((a & 0x0F) > 9) r.F |= 0x10; else r.F &= ~0x10; // H
                    a = (a + corr) & 0xFF;
                }

                r.A = a;
                // Update Z, S, P/V (Parity)
                r.F &= ~(0x80 | 0x40 | 0x04);
                if (a === 0) r.F |= 0x40;
                if (a & 0x80) r.F |= 0x80;
                { let p = a; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1; if (!(p & 1)) r.F |= 0x04; }
                break;
            }

            case 0x76: this.halted = true; break; // HALT

            // DI (0xF3)
            case 0xF3: this.iff1 = 0; break;

            // EI (0xFB)
            case 0xFB:
                this.iff1 = 1; this.iff2 = 1;
                break;

            // EX AF, AF' (0x08)
            case 0x08: {
                const tmpA = r.A; const tmpF = r.F;
                r.A = this.reg_prime.A; r.F = this.reg_prime.F;
                this.reg_prime.A = tmpA; this.reg_prime.F = tmpF;
                break;
            }
            // EXX (0xD9)
            case 0xD9: {
                const swap = (k) => { const t = r[k]; r[k] = this.reg_prime[k]; this.reg_prime[k] = t; };
                swap('B'); swap('C'); swap('D'); swap('E'); swap('H'); swap('L');
                break;
            }

            // CPL (0x2F)
            case 0x2F: r.A = (~r.A) & 0xFF; r.F |= 0x12; break; // Set H, N

            // CB Prefix (Bit Manipulation)
            case 0xCB: {
                let addr = 0;
                let useIDX = false;
                if (this.prefix) {
                    const d = this.fetch();
                    const off = d > 127 ? d - 256 : d;
                    addr = (this.getHL() + off) & 0xFFFF;
                    useIDX = true;
                }

                const sub = this.fetch();
                const rIdx = sub & 7;
                const bit = (sub >> 3) & 7;
                const mode = (sub >> 6) & 3;

                // Registers
                let val = 0;
                if (useIDX) val = this.mem.read(addr);
                else {
                    if (rIdx === 0) val = r.B;
                    else if (rIdx === 1) val = r.C;
                    else if (rIdx === 2) val = r.D;
                    else if (rIdx === 3) val = r.E;
                    else if (rIdx === 4) val = r.H;
                    else if (rIdx === 5) val = r.L;
                    else if (rIdx === 6) val = this.mem.read((r.H << 8) | r.L);
                    else if (rIdx === 7) val = r.A;
                }

                if (mode === 1) { // BIT
                    const z = (val & (1 << bit)) === 0;
                    if (z) r.F |= 0x40; else r.F &= ~0x40; // Z
                    r.F |= 0x10; // H
                    r.F &= ~0x02; // N
                } else {
                    // Modification Instructions (Write Back needed)
                    if (mode === 2) { // RES
                        val &= ~(1 << bit);
                    } else if (mode === 3) { // SET
                        val |= (1 << bit);
                    } else if (mode === 0) { // Rotates/Shifts (RLC, RRC, RL, RR, SLA, SRA, SRL)
                        // Map based on bit index logic (standard Z80 CB decoding)
                        // bit field maps to op:
                        // 0=RLC, 1=RRC, 2=RL, 3=RR, 4=SLA, 5=SRA, 6=SLL(undoc), 7=SRL
                        const startBit = bit; // Actually 'bit' var holds 3 bits (3-5) from opcode which is 'op' here
                        // wait, sub opcode structure: 00 ooo rrr
                        // mode 0 is top 2 bits 00.
                        // Middle 3 bits are Op.
                        // My 'bit' var comes from (sub >> 3) & 7. Correct.
                        const opType = bit;
                        const c = (r.F & 1);
                        let v = val;
                        let newC = 0;

                        if (opType === 0) { // RLC
                            newC = (v >> 7) & 1;
                            v = ((v << 1) | newC) & 0xFF;
                        } else if (opType === 1) { // RRC
                            newC = v & 1;
                            v = ((v >> 1) | (newC << 7)) & 0xFF;
                        } else if (opType === 2) { // RL
                            newC = (v >> 7) & 1;
                            v = ((v << 1) | c) & 0xFF;
                        } else if (opType === 3) { // RR
                            newC = v & 1;
                            v = ((v >> 1) | (c << 7)) & 0xFF;
                        } else if (opType === 4) { // SLA
                            newC = (v >> 7) & 1;
                            v = (v << 1) & 0xFF;
                        } else if (opType === 5) { // SRA
                            newC = v & 1;
                            v = ((v >> 1) | (v & 0x80)) & 0xFF;
                        } else if (opType === 7) { // SRL
                            newC = v & 1;
                            v = (v >> 1) & 0xFF;
                        }

                        val = v;
                        r.F = (r.F & 0xFE) | newC; // Update C
                        this.setZ(val);
                        this.setS(val);
                        r.F &= ~0x12; // Clear H, N (H is usually 0 for shifts, setZ handles P/V?)
                        // setZ/setS logic check... assuming simplified flags
                    }

                    // Write Back
                    if (useIDX) this.mem.write(addr, val);
                    else {
                        if (rIdx === 0) r.B = val;
                        else if (rIdx === 1) r.C = val;
                        else if (rIdx === 2) r.D = val;
                        else if (rIdx === 3) r.E = val;
                        else if (rIdx === 4) r.H = val;
                        else if (rIdx === 5) r.L = val;
                        else if (rIdx === 6) this.mem.write((r.H << 8) | r.L, val);
                        else if (rIdx === 7) r.A = val;
                    }
                }
                break;
            }

            // LD r, n (8-bit)
            case 0x3E: r.A = this.fetch(); break;
            case 0x06: r.B = this.fetch(); break;
            case 0x0E: r.C = this.fetch(); break;
            case 0x16: r.D = this.fetch(); break;
            case 0x1E: r.E = this.fetch(); break;
            case 0x26: this.setH(this.fetch()); break; // LD H, n
            case 0x2E: this.setL(this.fetch()); break; // LD L, n

            // LD rp, nn (16-bit)
            case 0x01: { const v = this.fetch16(); r.B = v >> 8; r.C = v & 0xFF; } break; // BC
            case 0x11: { const v = this.fetch16(); r.D = v >> 8; r.E = v & 0xFF; } break; // DE
            case 0x21: { const v = this.fetch16(); r.H = v >> 8; r.L = v & 0xFF; } break; // HL
            case 0x31: { r.SP = this.fetch16(); } break; // SP

            // LD (nn), HL (0x22) / LD HL, (nn) (0x2A)
            case 0x22: { const addr = this.fetch16(); this.mem.write(addr, r.L); this.mem.write(addr + 1, r.H); } break;
            case 0x2A: { const addr = this.fetch16(); const l = this.mem.read(addr); const h = this.mem.read(addr + 1); r.H = h; r.L = l; } break;

            // LD (nn), A (0x32) / LD A, (nn) (0x3A)
            case 0x32: { const addr = this.fetch16(); this.mem.write(addr, r.A); } break;
            case 0x3A: { const addr = this.fetch16(); r.A = this.mem.read(addr); } break;

            // INC r (8-bit)
            case 0x3C: r.A = (r.A + 1) & 0xFF; this.setZ(r.A); this.setS(r.A); break;
            case 0x04: r.B = (r.B + 1) & 0xFF; this.setZ(r.B); this.setS(r.B); break;
            case 0x0C: r.C = (r.C + 1) & 0xFF; this.setZ(r.C); this.setS(r.C); break;
            case 0x14: r.D = (r.D + 1) & 0xFF; this.setZ(r.D); this.setS(r.D); break;
            case 0x1C: r.E = (r.E + 1) & 0xFF; this.setZ(r.E); this.setS(r.E); break;
            case 0x24: r.H = (r.H + 1) & 0xFF; this.setZ(r.H); this.setS(r.H); break;
            case 0x2C: r.L = (r.L + 1) & 0xFF; this.setZ(r.L); this.setS(r.L); break;

            // INC rp (16-bit) - Note: No flags affected usually
            case 0x03: { let v = (r.B << 8) | r.C; v = (v + 1) & 0xFFFF; r.B = v >> 8; r.C = v & 0xFF; } break;
            case 0x13: { let v = (r.D << 8) | r.E; v = (v + 1) & 0xFFFF; r.D = v >> 8; r.E = v & 0xFF; } break;
            case 0x23: { let v = (r.H << 8) | r.L; v = (v + 1) & 0xFFFF; r.H = v >> 8; r.L = v & 0xFF; } break;
            case 0x33: { r.SP = (r.SP + 1) & 0xFFFF; } break;

            // DEC r (8-bit)
            case 0x3D: r.A = (r.A - 1) & 0xFF; this.setZ(r.A); this.setS(r.A); break;
            case 0x05: r.B = (r.B - 1) & 0xFF; this.setZ(r.B); this.setS(r.B); break;
            case 0x0D: r.C = (r.C - 1) & 0xFF; this.setZ(r.C); this.setS(r.C); break;
            case 0x15: r.D = (r.D - 1) & 0xFF; this.setZ(r.D); this.setS(r.D); break;
            case 0x1D: r.E = (r.E - 1) & 0xFF; this.setZ(r.E); this.setS(r.E); break;
            case 0x25: r.H = (r.H - 1) & 0xFF; this.setZ(r.H); this.setS(r.H); break;
            case 0x2D: r.L = (r.L - 1) & 0xFF; this.setZ(r.L); this.setS(r.L); break;

            // DEC rp (16-bit)
            case 0x0B: { let v = (r.B << 8) | r.C; v = (v - 1) & 0xFFFF; r.B = v >> 8; r.C = v & 0xFF; } break;
            case 0x1B: { let v = (r.D << 8) | r.E; v = (v - 1) & 0xFFFF; r.D = v >> 8; r.E = v & 0xFF; } break;
            case 0x2B: { let v = (r.H << 8) | r.L; v = (v - 1) & 0xFFFF; r.H = v >> 8; r.L = v & 0xFF; } break;
            case 0x3B: { r.SP = (r.SP - 1) & 0xFFFF; } break;

            // DJNZ d
            case 0x10: {
                const off = this.fetch();
                r.B = (r.B - 1) & 0xFF;
                if (r.B !== 0) {
                    const jump = off > 127 ? off - 256 : off;
                    r.PC += jump;
                }
                break;
            }

            // OUT (n), A
            case 0xD3: {
                const port = this.fetch();
                this.io.out(port, r.A);
                break;
            }

            // IN A, (n)
            case 0xDB: {
                const port = this.fetch();
                r.A = this.io.in(port);
                break;
            }

            // JP nn
            case 0xC3: r.PC = this.fetch16(); break;

            // JP Z, nn (CA) / JP NZ, nn (C2)
            case 0xCA: { const nn = this.fetch16(); if (r.F & 0x40) r.PC = nn; break; }
            case 0xC2: { const nn = this.fetch16(); if (!(r.F & 0x40)) r.PC = nn; break; }

            // JP NC, nn (D2) / JP C, nn (DA)
            case 0xD2: { const nn = this.fetch16(); if (!(r.F & 1)) r.PC = nn; break; }
            case 0xDA: { const nn = this.fetch16(); if (r.F & 1) r.PC = nn; break; }

            // JP PO, nn (E2) / JP PE, nn (EA) (Parity Odd/Even)
            case 0xE2: { const nn = this.fetch16(); if (!(r.F & 4)) r.PC = nn; break; }
            case 0xEA: { const nn = this.fetch16(); if (r.F & 4) r.PC = nn; break; }

            // JP P, nn (F2) / JP M, nn (FA) (Sign Positive/Minus)
            case 0xF2: { const nn = this.fetch16(); if (!(r.F & 0x80)) r.PC = nn; break; }
            case 0xFA: { const nn = this.fetch16(); if (r.F & 0x80) r.PC = nn; break; }

            // CALL nn
            case 0xCD: {
                const dest = this.fetch16();
                const ret = r.PC;
                this.mem.write(--r.SP, (ret >> 8) & 0xFF);
                this.mem.write(--r.SP, ret & 0xFF);
                r.PC = dest;
                break;
            }

            // RET
            case 0xC9: {
                const l = this.mem.read(r.SP++);
                const h = this.mem.read(r.SP++);
                r.PC = (h << 8) | l;
                break;
            }

            // RET cc (C0, C8, D0, D8, E0, E8, F0, F8)
            case 0xC0: case 0xC8: case 0xD0: case 0xD8: case 0xE0: case 0xE8: case 0xF0: case 0xF8: {
                const cc = (op >> 3) & 7;
                // 0=NZ, 1=Z, 2=NC, 3=C, 4=PO, 5=PE, 6=P, 7=M
                let cond = false;
                if (cc === 0) cond = !(r.F & 0x40);
                else if (cc === 1) cond = (r.F & 0x40);
                else if (cc === 2) cond = !(r.F & 1);
                else if (cc === 3) cond = (r.F & 1);
                else if (cc === 4) cond = !(r.F & 4);
                else if (cc === 5) cond = (r.F & 4);
                else if (cc === 6) cond = !(r.F & 0x80);
                else if (cc === 7) cond = (r.F & 0x80);

                if (cond) {
                    const l = this.mem.read(r.SP++);
                    const h = this.mem.read(r.SP++);
                    r.PC = (h << 8) | l;
                    // Note: RET takes 11 cycles, conditional +6 if taken usually
                }
                break;
            }

            // CALL cc (C4, CC, D4, DC, E4, EC, F4, FC)
            case 0xC4: case 0xCC: case 0xD4: case 0xDC: case 0xE4: case 0xEC: case 0xF4: case 0xFC: {
                const dest = this.fetch16();
                const cc = (op >> 3) & 7;
                let cond = false;
                if (cc === 0) cond = !(r.F & 0x40);
                else if (cc === 1) cond = (r.F & 0x40);
                else if (cc === 2) cond = !(r.F & 1);
                else if (cc === 3) cond = (r.F & 1);
                else if (cc === 4) cond = !(r.F & 4);
                else if (cc === 5) cond = (r.F & 4);
                else if (cc === 6) cond = !(r.F & 0x80);
                else if (cc === 7) cond = (r.F & 0x80);

                if (cond) {
                    const ret = r.PC;
                    this.mem.write(--r.SP, (ret >> 8) & 0xFF);
                    this.mem.write(--r.SP, ret & 0xFF);
                    r.PC = dest;
                }
                break;
            }

            // RST (C7, CF, D7, DF, E7, EF, F7, FF)
            case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF: {
                const dest = op & 0x38;
                const ret = r.PC;
                this.mem.write(--r.SP, (ret >> 8) & 0xFF);
                this.mem.write(--r.SP, ret & 0xFF);
                r.PC = dest;
                break;
            }

            // RLCA
            // RLCA (0x07)
            case 0x07: {
                const bit7 = (r.A & 0x80) >> 7;
                r.A = ((r.A << 1) | bit7) & 0xFF;
                if (bit7) r.F |= 1; else r.F &= ~1;
                r.F &= ~0x12; // H, N clear
                break;
            }
            // RRCA (0x0F)
            case 0x0F: {
                const bit0 = r.A & 1;
                r.A = ((r.A >> 1) | (bit0 << 7)) & 0xFF;
                if (bit0) r.F |= 1; else r.F &= ~1;
                r.F &= ~0x12;
                break;
            }
            // RLA (0x17)
            case 0x17: {
                const bit7 = (r.A & 0x80) >> 7;
                const oldC = r.F & 1;
                r.A = ((r.A << 1) | oldC) & 0xFF;
                if (bit7) r.F |= 1; else r.F &= ~1;
                r.F &= ~0x12;
                break;
            }
            // RRA (0x1F)
            case 0x1F: {
                const bit0 = r.A & 1;
                const oldC = r.F & 1;
                r.A = ((r.A >> 1) | (oldC << 7)) & 0xFF;
                if (bit0) r.F |= 1; else r.F &= ~1;
                r.F &= ~0x12;
                break;
            }
            // EX DE, HL (0xEB)
            case 0xEB: {
                const tmpD = r.D; const tmpE = r.E;
                r.D = r.H; r.E = r.L;
                r.H = tmpD; r.L = tmpE;
                break;
            }
            // EX AF, AF' (0x08)
            case 0x08: {
                const tmpA = r.A; const tmpF = r.F;
                r.A = this.reg_prime.A; r.F = this.reg_prime.F;
                this.reg_prime.A = tmpA; this.reg_prime.F = tmpF;
                break;
            }
            // EX (SP), HL (0xE3) - Indexable
            case 0xE3: {
                const l = this.mem.read(r.SP);
                const h = this.mem.read(r.SP + 1);
                const memVal = (h << 8) | l;
                const regVal = this.getHL(); // HL, IX, or IY
                this.mem.write(r.SP, regVal & 0xFF);
                this.mem.write(r.SP + 1, (regVal >> 8) & 0xFF);
                this.setHL(memVal);
                break;
            }
            // JP (HL) (0xE9) - Indexable
            case 0xE9: {
                r.PC = this.getHL();
                break;
            }
            // LD SP, HL (0xF9) - Indexable
            case 0xF9: {
                r.SP = this.getHL();
                break;
            }
            // EXX (0xD9)
            case 0xD9: {
                const swap = (k) => { const t = r[k]; r[k] = this.reg_prime[k]; this.reg_prime[k] = t; };
                swap('B'); swap('C'); swap('D'); swap('E'); swap('H'); swap('L');
                break;
            }

            // ALU Immediate (n)
            case 0xC6: this.arith8(0, this.fetch()); break; // ADD A, n

            case 0xCE: this.arith8(1, this.fetch()); break; // ADC A, n
            case 0xD6: this.arith8(2, this.fetch()); break; // SUB n
            case 0xDE: this.arith8(3, this.fetch()); break; // SBC A, n
            case 0xE6: this.arith8(4, this.fetch()); break; // AND n
            case 0xEE: this.arith8(5, this.fetch()); break; // XOR n
            case 0xF6: this.arith8(6, this.fetch()); break; // OR n
            case 0xFE: this.arith8(7, this.fetch()); break; // CP n

            // --- Extended Instructions ---

            // PUSH qq (BC=C5, DE=D5, HL=E5, AF=F5)
            case 0xC5: this.push((r.B << 8) | r.C); break;
            case 0xD5: this.push((r.D << 8) | r.E); break;
            case 0xE5: this.push(this.getHL()); break;
            case 0xF5: this.push((r.A << 8) | r.F); break;

            // POP qq (BC=C1, DE=D1, HL=E1, AF=F1)
            case 0xC1: { const v = this.pop(); r.B = v >> 8; r.C = v & 0xFF; } break;
            case 0xD1: { const v = this.pop(); r.D = v >> 8; r.E = v & 0xFF; } break;
            case 0xE1: { this.setHL(this.pop()); } break;
            case 0xF1: { const v = this.pop(); r.A = v >> 8; r.F = v & 0xFF; } break;

            // ED Prefix (Extended)
            case 0xED: {
                const sub = this.fetch();
                // Input matching IN r, (C) and OUT (C), r
                // IN r, (C) -> 0x40 | (r << 3)
                if ((sub & 0xC7) === 0x40) {
                    const rIdx = (sub >> 3) & 7;
                    const val = this.io.in(r.C); // Port is C
                    if (rIdx === 0) r.B = val;
                    else if (rIdx === 1) r.C = val;
                    else if (rIdx === 2) r.D = val;
                    else if (rIdx === 3) r.E = val;
                    else if (rIdx === 4) r.H = val;
                    else if (rIdx === 5) r.L = val;
                    else if (rIdx === 6) { } // IN (C) (flags only)
                    else if (rIdx === 7) r.A = val;

                    // Flags: S, Z, H=0, P/V (Parity), N=0
                    this.setZ(val); this.setS(val); r.F &= ~0x12;
                    { let p = val; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1; if (!(p & 1)) r.F |= 0x04; }
                }
                // OUT (C), r -> 0x41 | (r << 3)
                else if ((sub & 0xC7) === 0x41) {
                    const rIdx = (sub >> 3) & 7;
                    let val = 0;
                    if (rIdx === 0) val = r.B;
                    else if (rIdx === 1) val = r.C;
                    else if (rIdx === 2) val = r.D;
                    else if (rIdx === 3) val = r.E;
                    else if (rIdx === 4) val = r.H;
                    else if (rIdx === 5) val = r.L;
                    else if (rIdx === 6) val = 0; // OUT (C), 0
                    else if (rIdx === 7) val = r.A;
                    this.io.out(r.C, val);
                }
                // IM Modes
                else if (sub === 0x46) this.im = 0;
                else if (sub === 0x56) this.im = 1;
                else if (sub === 0x5E) this.im = 2;

                else if (sub === 0x47) { r.I = r.A; } // LD I, A
                else if (sub === 0x4F) { r.R = r.A; } // LD R, A
                else if (sub === 0x57) { // LD A, I
                    r.A = r.I;
                    this.setZ(r.A); this.setS(r.A);
                    r.F &= ~0x12; // H=0, N=0
                    if (this.iff2) r.F |= 0x04; else r.F &= ~0x04; // P/V = IFF2
                }
                else if (sub === 0x5F) { // LD A, R
                    r.A = r.R;
                    this.setZ(r.A); this.setS(r.A);
                    r.F &= ~0x12; // H=0, N=0
                    if (this.iff2) r.F |= 0x04; else r.F &= ~0x04; // P/V = IFF2
                }

                // NEG (0x44)
                else if (sub === 0x44) {
                    const val = r.A;
                    r.A = 0;
                    this.arith8(2, val); // SUB A, val (0 - A) -> NEG
                }

                // RETI (0x4D) / RETN (0x45)
                else if (sub === 0x4D || sub === 0x45) {
                    const l = this.mem.read(r.SP++);
                    const h = this.mem.read(r.SP++);
                    r.PC = (h << 8) | l;
                }

                // RAD/RRD (Decimal Rotate)
                // RRD (67)
                else if (sub === 0x67) {
                    const hl = (r.H << 8) | r.L;
                    const m = this.mem.read(hl);
                    const low = r.A & 0x0F;
                    r.A = (r.A & 0xF0) | (m & 0x0F);
                    const newM = ((m >> 4) & 0x0F) | (low << 4);
                    this.mem.write(hl, newM);
                    this.setZ(r.A); this.setS(r.A); r.F &= ~0x12; // H=0, N=0
                    // P/V Parity
                    { let p = r.A; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1; if (!(p & 1)) r.F |= 0x04; }
                }
                // RLD (6F)
                else if (sub === 0x6F) {
                    const hl = (r.H << 8) | r.L;
                    const m = this.mem.read(hl);
                    const low = r.A & 0x0F;
                    r.A = (r.A & 0xF0) | ((m >> 4) & 0x0F);
                    const newM = ((m << 4) & 0xF0) | low;
                    this.mem.write(hl, newM);
                    this.setZ(r.A); this.setS(r.A); r.F &= ~0x12;
                    { let p = r.A; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1; if (!(p & 1)) r.F |= 0x04; }
                }

                // Block Operations
                // LDI (A0), LDIR (B0), LDD (A8), LDDR (B8)
                else if ([0xA0, 0xB0, 0xA8, 0xB8].includes(sub)) {
                    // LDI(A0), LDIR(B0), LDD(A8), LDDR(B8)
                    const inc = (sub & 8) ? -1 : 1;
                    const repeat = (sub & 0x10) ? true : false;

                    const op = () => {
                        const hl = (r.H << 8) | r.L;
                        const de = (r.D << 8) | r.E;
                        let bc = (r.B << 8) | r.C;

                        const v = this.mem.read(hl);
                        this.mem.write(de, v);

                        const nhl = (hl + inc) & 0xFFFF;
                        const nde = (de + inc) & 0xFFFF;
                        r.H = nhl >> 8; r.L = nhl & 0xFF;
                        r.D = nde >> 8; r.E = nde & 0xFF;

                        bc = (bc - 1) & 0xFFFF;
                        r.B = bc >> 8; r.C = bc & 0xFF;

                        return bc;
                    };

                    let bc = op();
                    if (repeat && bc !== 0) {
                        // Atomic execution
                        while (bc !== 0) {
                            bc = op();
                        }
                    }

                    r.F &= ~0x16; // Clear H, N, P/V
                    if (bc !== 0) r.F |= 0x04; // Set P/V if BC!=0
                }
                // CPI (A1), CPIR (B1), CPD (A9), CPDR (B9)
                else if ([0xA1, 0xB1, 0xA9, 0xB9].includes(sub)) {
                    const inc = (sub & 8) ? -1 : 1;
                    const repeat = (sub & 0x10) ? true : false;

                    const op = () => {
                        const hl = (r.H << 8) | r.L;
                        let bc = (r.B << 8) | r.C;

                        const v = this.mem.read(hl);
                        const res = r.A - v;

                        const nhl = (hl + inc) & 0xFFFF;
                        r.H = nhl >> 8; r.L = nhl & 0xFF;

                        bc = (bc - 1) & 0xFFFF;
                        r.B = bc >> 8; r.C = bc & 0xFF;

                        r.F &= ~0x01; // Preserve C
                        // Set S, Z, H based on CP (A-v)
                        if ((res & 0xFF) === 0) r.F |= 0x40; else r.F &= ~0x40;
                        if (res & 0x80) r.F |= 0x80; else r.F &= ~0x80;
                        r.F |= 0x02; // N=1
                        // H?? (A & 0xF) < (v & 0xF)

                        r.F &= ~0x04; // P/V
                        if (bc !== 0) r.F |= 0x04;

                        return { bc, match: (res & 0xFF) === 0 };
                    };

                    let ret = op();
                    if (repeat && ret.bc !== 0 && !ret.match) {
                        while (ret.bc !== 0 && !ret.match) {
                            ret = op();
                        }
                    }
                }

                // INI (A2), INIR (B2), IND (AA), INDR (BA)
                else if ([0xA2, 0xB2, 0xAA, 0xBA].includes(sub)) {
                    const inc = (sub & 8) ? -1 : 1;
                    const repeat = (sub & 0x10) ? true : false;

                    const op = () => {
                        const hl = (r.H << 8) | r.L;
                        const v = this.io.in(r.C); // Port C
                        this.mem.write(hl, v);

                        const nhl = (hl + inc) & 0xFFFF;
                        r.H = nhl >> 8; r.L = nhl & 0xFF;

                        r.B = (r.B - 1) & 0xFF;

                        r.F |= 0x02; // N=1
                        if (r.B === 0) r.F |= 0x40; else r.F &= ~0x40; // Z if B=0

                        return r.B;
                    }

                    let b = op();
                    if (repeat && b !== 0) {
                        while (b !== 0) b = op();
                    }
                }

                // OUTI (A3), OTIR (B3), OUTD (AB), OTDR (BB)
                else if ([0xA3, 0xB3, 0xAB, 0xBB].includes(sub)) {
                    const inc = (sub & 8) ? -1 : 1;
                    const repeat = (sub & 0x10) ? true : false;

                    const op = () => {
                        const hl = (r.H << 8) | r.L;
                        const v = this.mem.read(hl);
                        this.io.out(r.C, v); // Port C

                        const nhl = (hl + inc) & 0xFFFF;
                        r.H = nhl >> 8; r.L = nhl & 0xFF;

                        r.B = (r.B - 1) & 0xFF;

                        r.F |= 0x02; // N=1
                        if (r.B === 0) r.F |= 0x40; else r.F &= ~0x40; // Z if B=0

                        return r.B;
                    }

                    let b = op();
                    if (repeat && b !== 0) {
                        while (b !== 0) b = op();
                    }
                }

                // SBC HL, ss (42, 52, 62, 72)
                else if ((sub & 0xCF) === 0x42) {
                    const ss = (sub >> 4) & 3; // 0=BC, 1=DE, 2=HL, 3=SP
                    let val = 0;
                    if (ss === 0) val = (r.B << 8) | r.C; else if (ss === 1) val = (r.D << 8) | r.E; else if (ss === 2) val = (r.H << 8) | r.L; else val = r.SP;
                    const hl = (r.H << 8) | r.L;
                    const res = hl - val - (r.F & 1);
                    r.H = (res >> 8) & 0xFF; r.L = res & 0xFF;
                    // Flags simplified for sample: Set C if Carry
                    r.F = 0; if (res < 0 || res > 0xFFFF) r.F |= 1; if ((res & 0xFFFF) === 0) r.F |= 0x40; r.F |= 0x02; // N set
                }
                // ADC HL, ss (4A, 5A, 6A, 7A)
                else if ((sub & 0xCF) === 0x4A) {
                    const ss = (sub >> 4) & 3;
                    let val = 0;
                    if (ss === 0) val = (r.B << 8) | r.C; else if (ss === 1) val = (r.D << 8) | r.E; else if (ss === 2) val = (r.H << 8) | r.L; else val = r.SP;
                    const hl = (r.H << 8) | r.L;
                    const res = hl + val + (r.F & 1);
                    r.H = (res >> 8) & 0xFF; r.L = res & 0xFF;
                    r.F = 0; if (res > 0xFFFF) r.F |= 1; if ((res & 0xFFFF) === 0) r.F |= 0x40;
                }

                // LD rp, (nn) - ED 4B, 5B, 6B, 7B
                else if ((sub & 0xCF) === 0x4B) {
                    const rIdx = (sub >> 4) & 3;
                    const l = this.fetch();
                    const h = this.fetch();
                    const addr = (h << 8) | l;
                    const vl = this.mem.read(addr);
                    const vh = this.mem.read((addr + 1) & 0xFFFF);
                    if (rIdx === 0) { r.B = vh; r.C = vl; } // BC
                    else if (rIdx === 1) { r.D = vh; r.E = vl; } // DE
                    else if (rIdx === 2) { r.H = vh; r.L = vl; } // HL
                    else if (rIdx === 3) { r.SP = (vh << 8) | vl; } // SP
                }
                // LD (nn), rp - ED 43, 53, 63, 73
                else if ((sub & 0xCF) === 0x43) {
                    const rIdx = (sub >> 4) & 3;
                    const l = this.fetch();
                    const h = this.fetch();
                    const addr = (h << 8) | l;
                    let vh, vl;
                    if (rIdx === 0) { vh = r.B; vl = r.C; }
                    else if (rIdx === 1) { vh = r.D; vl = r.E; }
                    else if (rIdx === 2) { vh = r.H; vl = r.L; }
                    else if (rIdx === 3) { vh = (r.SP >> 8) & 0xFF; vl = r.SP & 0xFF; }
                    this.mem.write(addr, vl);
                    this.mem.write((addr + 1) & 0xFFFF, vh);
                }

                else console.warn("Unknown ED Opcode:", sub.toString(16));
                break;
            }

            // LD r, r' (0x40 - 0x7F)
            // Note: 0x76 is HALT, handled above in explicit case?
            // Switch cases execute in order? No, exact match.
            // Explicit cases usually go before default in switch, but here mixed.
            case 0xFB: this.iff1 = 1; break; // EI
            case 0xF3: this.iff1 = 0; break; // DI

            default: {
                // LD r, r' (0x40 - 0x7F)
                if ((op & 0xC0) === 0x40) {
                    if (op === 0x76) { this.halted = true; break; } // HALT is 0x76
                    const s = op & 7;
                    const d = (op >> 3) & 7;
                    let val = 0;

                    // Read Source
                    if (s === 6) val = this.mem.read(this.getAddrHL());
                    else if (s === 4) val = this.getH();
                    else if (s === 5) val = this.getL();
                    else if (s === 0) val = r.B;
                    else if (s === 1) val = r.C;
                    else if (s === 2) val = r.D;
                    else if (s === 3) val = r.E;
                    else if (s === 7) val = r.A;

                    // Write Dest
                    if (d === 6) this.mem.write(this.getAddrHL(), val);
                    else if (d === 4) this.setH(val);
                    else if (d === 5) this.setL(val);
                    else if (d === 0) r.B = val;
                    else if (d === 1) r.C = val;
                    else if (d === 2) r.D = val;
                    else if (d === 3) r.E = val;
                    else if (d === 7) r.A = val;
                    break;
                }

                // ALU A, r (0x80 - 0xBF)
                if ((op & 0xC0) === 0x80) {
                    const s = op & 7;
                    const type = (op >> 3) & 7;
                    let val = 0;
                    if (s === 6) val = this.mem.read(this.getAddrHL());
                    else if (s === 4) val = this.getH();
                    else if (s === 5) val = this.getL();
                    else if (s === 0) val = r.B;
                    else if (s === 1) val = r.C;
                    else if (s === 2) val = r.D;
                    else if (s === 3) val = r.E;
                    else if (s === 7) val = r.A;
                    this.arith8(type, val);
                    break;
                }

                console.warn("Unknown Opcode:", op.toString(16).toUpperCase());
                this.halted = true; // Safety halt on unknown
                break;
            }
        }
    }
}

class Assembler {
    constructor() {
        this.sourceMap = [];
        this.labels = {};
    }

    parseNumber(s, dummyMode = false) {
        s = s.trim();
        const su = s.toUpperCase();
        if (this.labels[su] !== undefined) return this.labels[su];
        if (this.labels[s] !== undefined) return this.labels[s];
        if (s.startsWith('0x')) return parseInt(s, 16);
        const v = parseInt(s);
        if (isNaN(v)) {
            if (dummyMode) return 0; // Return 0 for unresolved labels in Pass 1
            throw new Error(`Undefined Label: ${s}`);
        }
        return v;
    }

    emitInstruction(mnemonic, args, addr, dummyMode) {
        const bytes = [];
        const fetch = (n) => bytes.push(n); // Helper if needed, but we push directly

        if (mnemonic === 'PUSH') {
            const r = args[0].toUpperCase();
            if (r === 'IX') bytes.push(0xDD, 0xE5);
            else if (r === 'IY') bytes.push(0xFD, 0xE5);
            else {
                const m = { BC: 0xC5, DE: 0xD5, HL: 0xE5, AF: 0xF5 };
                if (m[r]) bytes.push(m[r]);
                else throw new Error(`Invalid Operand for PUSH: ${r}`);
            }
        }
        else if (mnemonic === 'POP') {
            const r = args[0].toUpperCase();
            if (r === 'IX') bytes.push(0xDD, 0xE1);
            else if (r === 'IY') bytes.push(0xFD, 0xE1);
            else {
                const m = { BC: 0xC1, DE: 0xD1, HL: 0xE1, AF: 0xF1 };
                if (m[r]) bytes.push(m[r]);
                else throw new Error(`Invalid Operand for POP: ${r}`);
            }
        }
        else if (mnemonic === 'INC' || mnemonic === 'DEC') {
            const r = args[0].toUpperCase();
            const isInc = mnemonic === 'INC';
            const base8 = isInc ? 0x04 : 0x05;
            const base16 = isInc ? 0x03 : 0x0B;

            if (r === 'IX') bytes.push(0xDD, isInc ? 0x23 : 0x2B);
            else if (r === 'IY') bytes.push(0xFD, isInc ? 0x23 : 0x2B);
            else if (r.match(/\((IX|IY)/)) { // Partial check
                const idxRegex = /\((IX|IY)\s*([+-]\s*0x[0-9A-Fa-f]+|[+-]\s*[0-9]+)?\)/;
                const match = r.match(idxRegex);
                if (match) {
                    const pre = match[1] === 'IX' ? 0xDD : 0xFD;
                    let offStr = match[2] ? match[2].replace(/\s/g, '') : '+0';
                    const off = this.parseNumber(offStr, dummyMode);
                    bytes.push(pre, isInc ? 0x34 : 0x35, off & 0xFF);
                } else throw new Error(`Invalid Index Syntax for ${mnemonic}: ${r}`);
            }
            else {
                const rMap8 = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 };
                const rMap16 = { BC: 0, DE: 1, HL: 2, SP: 3 };

                if (rMap8[r] !== undefined) bytes.push(base8 | (rMap8[r] << 3));
                else if (rMap16[r] !== undefined) bytes.push(base16 | (rMap16[r] << 4));
                else throw new Error(`Invalid Operand for ${mnemonic}: ${r}`);
            }
        }
        else if (['ADD', 'SUB', 'AND', 'OR', 'XOR', 'CP', 'ADC', 'SBC'].includes(mnemonic)) {


            // ADD IX/IY, ss
            if (mnemonic === 'ADD' && (args[0].toUpperCase() === 'IX' || args[0].toUpperCase() === 'IY')) {
                const ix = args[0].toUpperCase() === 'IX';
                const ss = args[1].toUpperCase();
                const sMap = { BC: 0x09, DE: 0x19, IX: 0x29, IY: 0x29, SP: 0x39 };
                const code = sMap[ss];
                if (code !== undefined) bytes.push(ix ? 0xDD : 0xFD, code);
                else if (ss === (ix ? 'IX' : 'IY')) bytes.push(ix ? 0xDD : 0xFD, 0x29); // Handle self-add properly
                else bytes.push(0x00, 0x00);
                return bytes;
            }
            // 16-bit ADD IX/IY, ss (Wait, duplicated block in original, simplified here)
            // The original code had two blocks for ADD IX/IY. I will check.
            // The first block: sMap has IX/IY.
            // The second block: sMap has { BC: 0x09, DE: 0x19, SP: 0x39 }.
            // I'll stick to the first one which covers all, effectively.

            // ALU A, r (Implicit A)
            let r = args[0];
            if (args.length > 1 && ['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'OR', 'XOR', 'CP'].includes(mnemonic)) r = args[1];

            let rUpper = r.toUpperCase();



            // 16-bit Arithmetic (ADD HL, ss / ADC HL, ss / SBC HL, ss)
            const rpMap = { BC: 0, DE: 1, HL: 2, SP: 3 };
            const r0 = args[0].toUpperCase();
            const r1 = args[1] ? args[1].toUpperCase() : '';


            if (r0 === 'HL' && rpMap[r1] !== undefined) {
                const ss = rpMap[r1];
                if (mnemonic === 'ADD') {
                    // ADD HL, ss (09, 19, 29, 39)
                    const bases = [0x09, 0x19, 0x29, 0x39];

                    bytes.push(bases[ss]);
                    return bytes;
                } else if (mnemonic === 'ADC') {
                    // ADC HL, ss (ED 4A, 5A, 6A, 7A)
                    const bases = [0x4A, 0x5A, 0x6A, 0x7A];

                    bytes.push(0xED, bases[ss]);
                    return bytes;
                } else if (mnemonic === 'SBC') {
                    // SBC HL, ss (ED 42, 52, 62, 72)
                    const bases = [0x42, 0x52, 0x62, 0x72];
                    bytes.push(0xED, bases[ss]);
                    return bytes;
                }
            }

            const base = { ADD: 0x80, ADC: 0x88, SUB: 0x90, SBC: 0x98, AND: 0xA0, XOR: 0xA8, OR: 0xB0, CP: 0xB8 }[mnemonic];
            const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 };

            // ALU A, (IX+d)
            const idxRegex = /\((IX|IY)\s*([+-]\s*0x[0-9A-Fa-f]+|[+-]\s*[0-9]+)?\)/;
            const idxMatch = rUpper.match(idxRegex);
            if (idxMatch) {
                const idxReg = idxMatch[1];
                let offStr = idxMatch[2] ? idxMatch[2].replace(/\s/g, '') : '+0';
                const off = this.parseNumber(offStr, dummyMode);
                const pre = idxReg === 'IX' ? 0xDD : 0xFD;
                bytes.push(pre, base | 6, off & 0xFF);
            }
            else if (rMap[rUpper] !== undefined) {
                bytes.push(base + rMap[rUpper]);
            } else {
                // Try Immediate
                const n = this.parseNumber(r, dummyMode);
                const immMap = { ADD: 0xC6, ADC: 0xCE, SUB: 0xD6, SBC: 0xDE, AND: 0xE6, XOR: 0xEE, OR: 0xF6, CP: 0xFE };
                if (immMap[mnemonic]) bytes.push(immMap[mnemonic], n & 0xFF);
                else bytes.push(0x00, 0x00);
            }
        }
        else if (mnemonic === 'LD') {
            const a0 = args[0].toUpperCase();
            const a1 = args[1] ? args[1].toUpperCase() : '';

            // Handle LD I, A / LD R, A / LD A, I / LD A, R
            if (a0 === 'I' && a1 === 'A') { bytes.push(0xED, 0x47); return bytes; }
            if (a0 === 'R' && a1 === 'A') { bytes.push(0xED, 0x4F); return bytes; }
            if (a0 === 'A' && a1 === 'I') { bytes.push(0xED, 0x57); return bytes; }
            if (a0 === 'A' && a1 === 'R') { bytes.push(0xED, 0x5F); return bytes; }

            // Indexed LD (IX+d)
            const idxRegex = /\((IX|IY)\s*([+-]\s*0x[0-9A-Fa-f]+|[+-]\s*[0-9]+)?\)/;
            const idxMatch0 = args[0].match(idxRegex);
            const idxMatch1 = args[1] ? args[1].match(idxRegex) : null;

            if (idxMatch0) {
                // LD (IX+d), ...
                const idxReg = idxMatch0[1];
                let offStr = idxMatch0[2] ? idxMatch0[2].replace(/\s/g, '') : '+0';
                const off = this.parseNumber(offStr, dummyMode);
                const pre = idxReg === 'IX' ? 0xDD : 0xFD;

                const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, A: 7 };
                if (rMap[a1] !== undefined) {
                    // LD (IX+d), r
                    bytes.push(pre, 0x70 | rMap[a1], off & 0xFF);
                }
                else if (a1.match(/^[0-9A-FX]+$/)) { // LD (IX+d), n
                    const n = this.parseNumber(args[1], dummyMode);
                    bytes.push(pre, 0x36, off & 0xFF, n & 0xFF);
                }
            }
            else if (idxMatch1) {
                // LD r, (IX+d)
                const idxReg = idxMatch1[1];
                let offStr = idxMatch1[2] ? idxMatch1[2].replace(/\s/g, '') : '+0';
                const off = this.parseNumber(offStr, dummyMode);
                const pre = idxReg === 'IX' ? 0xDD : 0xFD;
                const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, A: 7 };
                if (rMap[a0] !== undefined) {
                    bytes.push(pre, 0x46 | (rMap[a0] << 3), off & 0xFF);
                }
            }
            // LD IX, nn / LD IY, nn
            else if (a0 === 'IX' || a0 === 'IY') {
                const nn = this.parseNumber(args[1], dummyMode);
                bytes.push(a0 === 'IX' ? 0xDD : 0xFD, 0x21, nn & 0xFF, (nn >> 8) & 0xFF);
            }
            // LD (nn), IX / LD (nn), IY
            else if (args[0].startsWith('(') && (a1 === 'IX' || a1 === 'IY')) {
                const nn = this.parseNumber(args[0].replace(/[()]/g, ''), dummyMode);
                bytes.push(a1 === 'IX' ? 0xDD : 0xFD, 0x22, nn & 0xFF, (nn >> 8) & 0xFF);
            }
            // LD IX, (nn) / LD IY, (nn)
            else if ((a0 === 'IX' || a0 === 'IY') && args[1].startsWith('(')) {
                const nn = this.parseNumber(args[1].replace(/[()]/g, ''), dummyMode);
                bytes.push(a0 === 'IX' ? 0xDD : 0xFD, 0x2A, nn & 0xFF, (nn >> 8) & 0xFF);
            }
            // LD SP, IX / LD SP, IY
            else if (a0 === 'SP' && (a1 === 'IX' || a1 === 'IY')) {
                bytes.push(a1 === 'IX' ? 0xDD : 0xFD, 0xF9);
            }
            // Original LD Logic (Enhanced for BC, DE, SP)
            else if (args[0].startsWith('(') && a0 !== '(HL)' && a0 !== '(BC)' && a0 !== '(DE)' && a0 !== '(C)') {
                const nn = this.parseNumber(args[0].replace(/[()]/g, ''), dummyMode);
                if (a1 === 'HL') bytes.push(0x22, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a1 === 'BC') bytes.push(0xED, 0x43, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a1 === 'DE') bytes.push(0xED, 0x53, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a1 === 'SP') bytes.push(0xED, 0x73, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a1 === 'A') bytes.push(0x32, nn & 0xFF, (nn >> 8) & 0xFF);
                else throw new Error(`Invalid LD (nn), r: ${args[0]}, ${a1}`);
            }
            else if (args[1] && args[1].startsWith('(') && a1 !== '(HL)' && a1 !== '(BC)' && a1 !== '(DE)' && a1 !== '(C)') {
                const nn = this.parseNumber(args[1].replace(/[()]/g, ''), dummyMode);
                if (a0 === 'HL') bytes.push(0x2A, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a0 === 'BC') bytes.push(0xED, 0x4B, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a0 === 'DE') bytes.push(0xED, 0x5B, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a0 === 'SP') bytes.push(0xED, 0x7B, nn & 0xFF, (nn >> 8) & 0xFF);
                else if (a0 === 'A') bytes.push(0x3A, nn & 0xFF, (nn >> 8) & 0xFF);
                else throw new Error(`Invalid LD r, (nn): ${a0}, ${args[1]}`);
            }
            else if (a0.match(/^[BCDEHL]{2}$|SP/)) {
                const rp = a0;
                const nn = this.parseNumber(args[1], dummyMode);
                const m = { BC: 0x01, DE: 0x11, HL: 0x21, SP: 0x31 };
                if (m[rp]) bytes.push(m[rp], nn & 0xFF, (nn >> 8) & 0xFF);
            }
            else {
                const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 };
                const d = a0;
                const s = a1;

                // LD Logic
                // If not matched above, handle specific invalid cases or throw
                if (rMap[d] !== undefined && rMap[s] !== undefined) {
                    bytes.push(0x40 | (rMap[d] << 3) | rMap[s]);
                }
                else if (d === 'A' && s === '(BC)') bytes.push(0x0A);
                else if (d === 'A' && s === '(DE)') bytes.push(0x1A);
                else if (d === '(BC)' && s === 'A') bytes.push(0x02);
                else if (d === '(DE)' && s === 'A') bytes.push(0x12);
                else {
                    const n = this.parseNumber(args[1], dummyMode);
                    const map = { B: 0x06, C: 0x0E, D: 0x16, E: 0x1E, H: 0x26, L: 0x2D, A: 0x3E, '(HL)': 0x36 };
                    if (map[d]) bytes.push(map[d], n);
                    else throw new Error(`Invalid LD operands: ${d}, ${s}`);
                }
            }
        }
        else if (mnemonic === 'OUT') {
            if (args[0].toUpperCase().includes('(C)')) {
                const r = args[1] ? args[1].toUpperCase() : 'A'; // Default to A if generic? No, allow explicit
                const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, A: 7 };
                if (rMap[r] !== undefined) {
                    bytes.push(0xED, 0x41 | (rMap[r] << 3));
                } else if (r === '0') {
                    bytes.push(0xED, 0x71); // OUT (C), 0
                } else throw new Error(`Invalid Operand for OUT (C), r: ${r}`);
            } else {
                // OUT (n), A
                if (args[1] && args[1].toUpperCase() !== 'A') throw new Error("OUT (n), r only supports A");
                const n = this.parseNumber(args[0].replace(/[()]/g, ''), dummyMode);
                bytes.push(0xD3, n);
            }
        }
        else if (mnemonic === 'IN') {
            if (args[1].toUpperCase().includes('(C)')) {
                // IN r, (C)
                const r = args[0].toUpperCase();
                const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, A: 7 };
                if (rMap[r] !== undefined) {
                    bytes.push(0xED, 0x40 | (rMap[r] << 3));
                } else if (r === '(C)') {
                    bytes.push(0xED, 0x70); // IN (C) - Flags only
                } else throw new Error(`Invalid Operand for IN r, (C): ${r}`);
            } else {
                // IN A, (n)
                if (args[0] && args[0].toUpperCase() !== 'A') throw new Error("IN r, (n) only supports A");
                const n = this.parseNumber(args[1].replace(/[()]/g, ''), dummyMode);
                bytes.push(0xDB, n);
            }
        }
        else if (mnemonic === 'JP') {
            const a0 = args[0].toUpperCase();
            if (a0 === '(HL)') bytes.push(0xE9);
            else if (a0 === '(IX)') bytes.push(0xDD, 0xE9);
            else if (a0 === '(IY)') bytes.push(0xFD, 0xE9);
            else if (args.length === 2) {
                // Conditional JP cc, nn
                const cc = args[0].toUpperCase();
                const n = this.parseNumber(args[1], dummyMode);
                const codes = { NZ: 0xC2, Z: 0xCA, NC: 0xD2, C: 0xDA, PO: 0xE2, PE: 0xEA, P: 0xF2, M: 0xFA };
                if (codes[cc]) bytes.push(codes[cc], n & 0xFF, (n >> 8) & 0xFF);
                else throw new Error(`Invalid Condition for JP: ${cc}`);
            } else {
                // Unconditional JP nn
                const n = this.parseNumber(args[0], dummyMode);
                bytes.push(0xC3, n & 0xFF, (n >> 8) & 0xFF);
            }
        }
        else if (mnemonic === 'JR') {
            let cc = '';
            let label = args[0];
            if (args.length > 1) {
                cc = args[0].toUpperCase();
                label = args[1];
            }
            const target = this.parseNumber(label, dummyMode);
            const current = addr;
            const offset = target - (current + 2); // Relative Jump Calculation!

            const ops = { '': 0x18, 'NZ': 0x20, 'Z': 0x28, 'NC': 0x30, 'C': 0x38 };
            if (ops[cc] !== undefined) {
                bytes.push(ops[cc], offset & 0xFF);
            } else {
                throw new Error(`Invalid Condition for JR: ${cc}`);
            }
        }
        else if (mnemonic === 'DJNZ') {
            const target = this.parseNumber(args[0], dummyMode);
            const offset = target - (addr + 2);
            bytes.push(0x10, offset & 0xFF);
        }
        else if (mnemonic === 'CALL') {
            const n = this.parseNumber(args[0], dummyMode);
            bytes.push(0xCD, n & 0xFF, (n >> 8) & 0xFF);
        }
        else if (mnemonic === 'RET') {
            if (args.length > 0) {
                const cc = args[0].toUpperCase();
                const codes = { NZ: 0xC0, Z: 0xC8, NC: 0xD0, C: 0xD8, PO: 0xE0, PE: 0xE8, P: 0xF0, M: 0xF8 };
                if (codes[cc] !== undefined) bytes.push(codes[cc]);
                else throw new Error(`Invalid Condition for RET: ${cc}`);
            } else {
                bytes.push(0xC9);
            }
        }


        else if (mnemonic === 'DB') {
            args.forEach(arg => bytes.push(this.parseNumber(arg, dummyMode) & 0xFF));
        }
        else if (mnemonic === 'DW') {
            args.forEach(arg => {
                const val = this.parseNumber(arg, dummyMode);
                bytes.push(val & 0xFF, (val >> 8) & 0xFF);
            });
        }
        else if (mnemonic === 'RLCA') bytes.push(0x07);
        else if (mnemonic === 'RRCA') bytes.push(0x0F);
        else if (mnemonic === 'RLA') bytes.push(0x17);
        else if (mnemonic === 'RRA') bytes.push(0x1F);
        else if (mnemonic === 'CPL') bytes.push(0x2F);
        else if (['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SRL'].includes(mnemonic)) {
            const r = args[0];
            const baseMap = { RLC: 0x00, RRC: 0x08, RL: 0x10, RR: 0x18, SLA: 0x20, SRA: 0x28, SRL: 0x38 };
            const base = baseMap[mnemonic];

            const idxRegex = /\((IX|IY)\s*([+-]\s*0x[0-9A-Fa-f]+|[+-]\s*[0-9]+)?\)/;
            const idxMatch = r.match(idxRegex);
            if (idxMatch) {
                const idxReg = idxMatch[1];
                let offStr = idxMatch[2] ? idxMatch[2].replace(/\s/g, '') : '+0';
                const off = this.parseNumber(offStr, dummyMode);
                const pre = idxReg === 'IX' ? 0xDD : 0xFD;
                bytes.push(pre, 0xCB, off & 0xFF, base | 6);
            } else {
                const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 };
                if (rMap[r] !== undefined) {
                    bytes.push(0xCB, base | rMap[r]);
                } else throw new Error(`Invalid Operand for ${mnemonic}: ${r}`);
            }
        }
        else if (mnemonic === 'BIT' || mnemonic === 'SET' || mnemonic === 'RES') {
            const b = this.parseNumber(args[0], dummyMode);
            const r = args[1];
            const base = (mnemonic === 'BIT') ? 0x40 : (mnemonic === 'RES' ? 0x80 : 0xC0);

            const idxRegex = /\((IX|IY)\s*([+-]\s*0x[0-9A-Fa-f]+|[+-]\s*[0-9]+)?\)/;
            const idxMatch = r.match(idxRegex);
            if (idxMatch) {
                const idxReg = idxMatch[1];
                let offStr = idxMatch[2] ? idxMatch[2].replace(/\s/g, '') : '+0';
                const off = this.parseNumber(offStr, dummyMode);
                const pre = idxReg === 'IX' ? 0xDD : 0xFD;
                bytes.push(pre, 0xCB, off & 0xFF, base | (b << 3) | 6);
            } else {
                const rMap = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 };
                if (rMap[r] !== undefined) {
                    bytes.push(0xCB, base | (b << 3) | rMap[r]);
                } else throw new Error(`Invalid Operand for ${mnemonic}: ${r}`);
            }
        }
        else if (mnemonic === 'NOP') bytes.push(0x00);
        else if (mnemonic === 'HALT') bytes.push(0x76);
        else if (mnemonic === 'EXX') bytes.push(0xD9);
        else if (mnemonic === 'EX') {
            const a0 = args[0].toUpperCase();
            const a1 = args[1].toUpperCase();
            if (a0 === 'AF' && a1 === "AF'") bytes.push(0x08);
            else if (a0 === 'DE' && a1 === 'HL') bytes.push(0xEB);
            else if (a0 === '(SP)') {
                if (a1 === 'HL') bytes.push(0xE3);
                else if (a1 === 'IX') bytes.push(0xDD, 0xE3);
                else if (a1 === 'IY') bytes.push(0xFD, 0xE3);
                else throw new Error(`Invalid EX Pair: ${a0}, ${a1}`);
            }
            else throw new Error(`Invalid EX Pair: ${a0}, ${a1}`);
        }
        else if (mnemonic === 'LDIR') bytes.push(0xED, 0xB0);
        else if (mnemonic === 'LDDR') bytes.push(0xED, 0xB8);
        else if (mnemonic === 'CPIR') bytes.push(0xED, 0xB1);
        else if (mnemonic === 'NEG') bytes.push(0xED, 0x44);
        else if (mnemonic === 'DAA') bytes.push(0x27);
        else if (mnemonic === 'RRD') bytes.push(0xED, 0x67);
        else if (mnemonic === 'RLD') bytes.push(0xED, 0x6F);
        else if (mnemonic === 'IM') {
            const mode = args[0];
            if (mode === '0') bytes.push(0xED, 0x46);
            else if (mode === '1') bytes.push(0xED, 0x56);
            else if (mode === '2') bytes.push(0xED, 0x5E);
            else throw new Error(`Invalid IM Mode: ${mode}`);
        }
        else if (mnemonic === 'RETI') bytes.push(0xED, 0x4D);
        else if (mnemonic === 'RETN') bytes.push(0xED, 0x45);
        else if (mnemonic === 'EI') bytes.push(0xFB);
        else if (mnemonic === 'DI') bytes.push(0xF3);
        else if (mnemonic === 'RST') {
            const t = this.parseNumber(args[0], dummyMode);
            bytes.push(0xC7 | (t & 0x38)); // 00H..38H -> C7..FF
        }
        else if (mnemonic === 'SCF') bytes.push(0x37);
        else if (mnemonic === 'CCF') bytes.push(0x3F);
        else if (mnemonic === 'LDI') bytes.push(0xED, 0xA0);
        else if (mnemonic === 'LDD') bytes.push(0xED, 0xA8);
        else if (mnemonic === 'CPI') bytes.push(0xED, 0xA1);
        else if (mnemonic === 'CPD') bytes.push(0xED, 0xA9);
        else if (mnemonic === 'CPDR') bytes.push(0xED, 0xB9);
        else if (mnemonic === 'INI') bytes.push(0xED, 0xA2);
        else if (mnemonic === 'INIR') bytes.push(0xED, 0xB2);
        else if (mnemonic === 'IND') bytes.push(0xED, 0xAA);
        else if (mnemonic === 'INDR') bytes.push(0xED, 0xBA);
        else if (mnemonic === 'OUTI') bytes.push(0xED, 0xA3);
        else if (mnemonic === 'OTIR') bytes.push(0xED, 0xB3);
        else if (mnemonic === 'OUTD') bytes.push(0xED, 0xAB);
        else if (mnemonic === 'OTDR') bytes.push(0xED, 0xBB);

        return bytes;
    }

    assemble(source) {
        this.sourceMap = [];
        this.labels = {};
        const lines = source.split('\n');
        const code = [];
        this.lineAddrMap = {}; // Map line index to expected address

        let addr = 0;

        // Pass 1
        for (let i = 0; i < lines.length; i++) {
            this.lineAddrMap[i] = addr; // Record start address of this line

            const commentStripped = lines[i].split(';')[0].trim();
            if (!commentStripped) continue;

            // Handle multiple instructions per line (separated by ' : ')
            const subLines = commentStripped.split(/\s:\s/);

            for (const lineContent of subLines) {
                if (!lineContent.trim()) continue;

                const parts = lineContent.replace(/,/g, ' ').split(/\s+/);

                // Check Label (ends with :)
                if (parts[0].endsWith(':')) {
                    const label = parts[0].slice(0, -1).toUpperCase();
                    this.labels[label] = addr;
                    parts.shift(); // Remove label
                }

                if (parts.length === 0) continue;

                const mnemonic = parts[0].toUpperCase();
                const args = parts.slice(1);

                // Check EQU
                if (parts.length >= 3 && parts[1].toUpperCase() === 'EQU') {
                    const val = this.parseNumber(parts[2], true);
                    this.labels[parts[0].toUpperCase()] = val;
                    continue;
                }

                // check ORG
                if (mnemonic === 'ORG') {
                    addr = this.parseNumber(args[0], true);
                    continue;
                }

                code.push({ line: i + 1, mnemonic, args, addr });

                // Sizing Logic using emitInstruction (dummyMode=true)
                if (mnemonic === 'DS') {
                    addr += this.parseNumber(args[0], true);
                } else {
                    try {
                        const bytes = this.emitInstruction(mnemonic, args, addr, true);
                        if (bytes.length === 0 && mnemonic !== 'EQU' && mnemonic !== 'ORG') {
                            console.warn(`Pass 1: Zero bytes for ${mnemonic} at line ${i + 1}`);
                        }
                        addr += bytes.length;
                    } catch (e) {
                        console.error(`Pass 1 Error on line ${i + 1}:`, e);
                        // Safety advance to avoid infinite loops or stuck addresses
                        addr += 1;
                    }
                }
            }
        }

        // Pass 2
        // Use a sparse map or pre-sized array to handle non-monotonic ORG
        // Since we want a flat binary at the end, let's find the max address first.
        let maxAddr = 0;
        code.forEach(inst => {
            // Estimate max extent
            // Note: This is an estimation. Actual bytes might vary if we had variable length,
            // but our Pass 1 already calculated exact addresses.
            // inst.addr is the start. We need length.
            // We can re-emit or just trust Pass 1 if we stored lengths?
            // Pass 1 stored 'addr' for each instruction, but not length explicitly in code array.
            // But we can infer length from next instruction's addr or just re-emit.
        });
        // Actually, Pass 1 `addr` tracks the *start* of the instruction.
        // We can just use a large Uint8Array buffer (64KB max for Z80).
        const buffer = new Uint8Array(0x10000); // 64KB Buffer
        // Track max extent written
        let endOfCode = 0;

        let listing = "--- Assembler Listing ---\nAddr   | Bytes      | Line | Source\n--------------------------------------------\n";

        code.forEach(inst => {
            const { mnemonic, args, addr, line } = inst;

            // sourceMap
            this.sourceMap[addr] = line;

            let hexBytes = "";

            if (mnemonic === 'DS') {
                // DS just reserves space, we don't overwrite with 0s necessarily?
                // Usually DS initializes to 0 or uninit. Let's leave as is (0 in Uint8Array).
                // Just update endOfCode if needed.
                const size = this.parseNumber(args[0], true);
                if (addr + size > endOfCode) endOfCode = addr + size;
            } else {
                try {
                    const instBytes = this.emitInstruction(mnemonic, args, addr, false);
                    instBytes.forEach((b, i) => {
                        buffer[addr + i] = b;
                    });

                    if (addr + instBytes.length > endOfCode) endOfCode = addr + instBytes.length;

                    hexBytes = instBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
                } catch (e) {
                    console.error(`Pass 2 Error on line ${line}:`, e);
                    throw e;
                }
            }

            const srcLineContent = lines[line - 1] ? lines[line - 1].trim() : "";
            const addrStr = addr.toString(16).padStart(4, '0').toUpperCase();
            listing += `${addrStr}   | ${hexBytes.padEnd(10)} | ${line.toString().padEnd(4)} | ${srcLineContent}\n`;
        });

        this.listing = listing;

        // Convert buffer up to endOfCode to standard array/Uint8Array for return
        return buffer.subarray(0, endOfCode);


        return new Uint8Array(bytes);
    }
}

// --- Specific Hardware Logic ---
const Hardware = {
    init() {
        this.pressedKey = 0xFF;
        this.keyBuffer = null;
        this.genLEDs();
        this.gen7Seg();
        this.genLCD();
        this.genMatrix();
        this.genKeypad();
        this.genDIPs();
        this.genBtns();
        this.initIO();
    },

    initIO() {
        // LEDs
        IO.onOut(0x00, (v) => {
            for (let i = 0; i < 8; i++) {
                const el = document.getElementById(`led-${i}`);
                if ((v >> i) & 1) el.classList.add('on'); else el.classList.remove('on');
            }
        });

        // Keypad (0x40)
        // Read: Returns key code if available, else 0xFF.
        // Logic: Input is buffered until read.
        IO.onIn(0x40, () => {
            if (Hardware.keyBuffer !== null) {
                const k = Hardware.keyBuffer;
                Hardware.keyBuffer = null; // Consume
                if (Main.logEnabled) console.log(`IO: Port 0x40 Read -> ${k}`);
                return k;
            }
            // console.log(`IO: Port 0x40 Read -> 0xFF (Empty)`);
            return 0xFF;
        });

        // 7-Seg
        // 0x10-0x17
        for (let i = 0; i < 8; i++) {
            IO.onOut(0x10 + i, (v) => {
                if (Main.logEnabled) console.log(`IO: 7-Seg Port 0x${(0x10 + i).toString(16)} Write: 0x${v.toString(16)}`);
                const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
                segs.forEach((s, b) => {
                    const el = document.getElementById(`seg-${i}-${s}`);
                    if ((v >> b) & 1) el.classList.add('on'); else el.classList.remove('on');
                });
            });
        }

        // LCD
        // 0x20 CMD, 0x21 DAT
        this.lcd = { lines: ['', ''], cursor: { r: 0, c: 0 } };

        IO.onOut(0x20, (v) => { // LCD CMD
            if (v === 0x01) { // Clear
                this.lcd.lines = ['', ''];
                this.lcd.cursor = { r: 0, c: 0 };
                this.updateLCD();
            }
            else if (v === 0x18) { // Shift Display Left
                // Simulating shifting by moving characters in the buffer
                // Real HW moves the window over DDRAM, but restricted buffer requires simple string shift.
                for (let r = 0; r < 2; r++) {
                    const line = this.lcd.lines[r].padEnd(16, ' ');
                    this.lcd.lines[r] = line.substring(1) + ' ';
                }
                this.updateLCD();
            }
            else if (v & 0x80) { // Set DDRAM Address
                const addr = v & 0x7F;
                if (addr < 0x10) this.lcd.cursor = { r: 0, c: addr };
                else if (addr >= 0x40 && addr < 0x50) this.lcd.cursor = { r: 1, c: addr - 0x40 };
            }
        });

        IO.onOut(0x21, (v) => { // LCD DATA
            const char = String.fromCharCode(v);
            const { r } = this.lcd.cursor;

            // Ensure line is initialized
            if (this.lcd.lines[r] === undefined) this.lcd.lines[r] = "";

            // Standard Behavior: Write at cursor, increment cursor.
            if (this.lcd.cursor.c < 16) {
                // Pad if needed
                if (this.lcd.lines[r].length < 16) this.lcd.lines[r] = this.lcd.lines[r].padEnd(16, ' ');

                const chars = this.lcd.lines[r].split('');
                chars[this.lcd.cursor.c] = char;
                this.lcd.lines[r] = chars.join('');
                this.lcd.cursor.c++;
                this.updateLCD();
            }
            // If >= 16, ignore (standard behavior for this limited simulator)
        });

        // Matrix
        // 0x80 - 0x9F
        for (let r = 0; r < 16; r++) {
            IO.onOut(0x80 + r * 2, (v) => {
                for (let c = 0; c < 8; c++) this.setDot(r, c, (v >> c) & 1);
            });
            IO.onOut(0x80 + r * 2 + 1, (v) => {
                for (let c = 0; c < 8; c++) this.setDot(r, c + 8, (v >> c) & 1);
            });
        }

        // DIP Switches Input (0x50 - 0x57)
        for (let i = 0; i < 8; i++) {
            IO.onIn(0x50 + i, () => {
                const el = document.getElementById(`dip-${i + 1}`);
                return el && el.classList.contains('on') ? 1 : 0;
            });
        }

        // Interrupt Buttons Input (0x60)
        IO.onIn(0x60, () => {
            return Hardware.btnState || 0;
        });

        // RTC (0xC0: Sec, 0xC1: Min, 0xC2: Hour)
        IO.onOut(0xC0, (v) => { }); // Ignore writes
        IO.onIn(0xC0, () => new Date().getSeconds());
        IO.onIn(0xC1, () => new Date().getMinutes());
        IO.onIn(0xC2, () => new Date().getHours());

        // Buzzer (0x30)
        IO.onOut(0x30, (v) => {
            Hardware.playBuzzer(v);
        });
    },

    setDot(r, c, on) {
        const el = document.getElementById(`mat-${r}-${c}`);
        if (on) el.classList.add('on'); else el.classList.remove('on');
    },

    genLEDs() {
        const c = document.getElementById('comp-leds');
        let html = '';
        for (let i = 0; i < 8; i++) {
            html += `<div class="led" id="led-${i}"></div>`;
        }
        c.innerHTML = html;
    },

    gen7Seg() {
        const c = document.getElementById('comp-7seg');
        let html = '';
        for (let i = 0; i < 8; i++) {
            // Digit container
            html += `<div class="seven-seg-digit" id="digit-${i}">`;
            // Segments
            const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
            segs.forEach(s => {
                html += `<div class="seg s-${s}" id="seg-${i}-${s}"></div>`;
            });
            html += `</div>`;
        }
        c.innerHTML = html;
    },

    genLCD() {
        // LCD HTML is static in index.html, so we just clear/init state if needed.
        this.lcd = { lines: ['', ''], cursor: { r: 0, c: 0 } };
        // Could clear content if needed
        document.getElementById('lcd-l1').innerText = "";
        document.getElementById('lcd-l2').innerText = "";
    },

    genMatrix() {
        const c = document.getElementById('comp-matrix');
        let h = '';
        for (let r = 0; r < 16; r++) {
            for (let col = 0; col < 16; col++) {
                h += `<div class="m-dot" id="mat-${r}-${col}"></div>`;
            }
        }
        c.innerHTML = h;
    },

    genKeypad() {
        const c = document.getElementById('comp-keypad');
        const keys = "123A456B789C*0#D".split('');
        c.innerHTML = keys.map(k => `<div class="key" data-k="${k}">${k}</div>`).join('');

        if (this.keypadInitialized) return;
        this.keypadInitialized = true;
        this.lastKeyTime = 0;

        c.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('key')) {
                const now = Date.now();
                if (now - this.lastKeyTime < 100) return; // Debounce 100ms
                this.lastKeyTime = now;

                const k = e.target.dataset.k;
                const map = "123A456B789C*0#D";
                this.keyBuffer = map.indexOf(k); // Buffer the key
                if (typeof IO !== 'undefined') IO.triggerInterrupt();
            }
        });

        // Removed mouseup clearing to support buffered input logic
    },

    genDIPs() {
        const c = document.getElementById('comp-dips');
        let h = '';
        for (let i = 1; i <= 8; i++) {
            h += `<div class="dip-switch" id="dip-${i}" onclick="Hardware.toggleDIP(${i})">
                    <div class="dip-slider"><div class="dip-knob"></div></div>
                    <div class="dip-label">${i}</div>
                  </div>`;
        }
        c.innerHTML = h;
    },

    toggleDIP(id) {
        document.getElementById(`dip-${id}`).classList.toggle('on');
    },

    genBtns() {
        const c = document.getElementById('comp-int-btns');
        let h = '';
        for (let i = 1; i <= 8; i++) {
            h += `<div class="push-btn" onmousedown="Hardware.pressBtn(${i})" onmouseup="Hardware.releaseBtn(${i})">${i}</div>`;
        }
        c.innerHTML = h;
        this.btnState = 0;
    },

    pressBtn(id) {
        // Trigger INT logic here
        this.btnState |= (1 << (id - 1));
        if (typeof IO !== 'undefined') IO.triggerInterrupt();
    },
    releaseBtn(id) {
        // Release logic
        this.btnState &= ~(1 << (id - 1));
    },

    updateLCD() {
        document.getElementById('lcd-l1').innerText = this.lcd.lines[0];
        document.getElementById('lcd-l2').innerText = this.lcd.lines[1];
    },

    genBuzzer() {
        // Simple visual indicator for Buzzer
        const c = document.getElementById('comp-buzzer'); // User needs to add this container or we append
        if (!c) return;
        c.innerHTML = `<div id="buzzer-icon" style="width:50px;height:50px;background:#333;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;">♪</div>`;
    },

    playBuzzer(val) {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
        }
        // Try to resume if suspended (requires user interaction first typically)
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => { });
        }

        const icon = document.getElementById('buzzer-icon');

        if (val === 0) {
            if (this.osc) {
                try {
                    this.osc.stop();
                    this.osc.disconnect();
                } catch (e) { }
                this.osc = null;
            }
            if (icon) {
                icon.style.background = '#333';
                icon.style.boxShadow = 'none';
            }
            return;
        }

        // Visual Feedback
        if (icon) {
            icon.style.background = '#e74c3c';
            icon.style.boxShadow = '0 0 15px #e74c3c';
        }

        // Audio
        if (!this.osc) {
            this.osc = this.audioCtx.createOscillator();
            this.osc.type = 'square';
            this.osc.connect(this.audioCtx.destination);
            this.osc.start();
        }
        // Frequency = val * 20 + 200 (Range: 200Hz - 5300Hz)
        const freq = 200 + (val * 20);
        this.osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
    }
};


// --- Main Initialization ---
const MEM = new Memory();
const IO = new IOController();
const CPU = new Z80(MEM, IO);
IO.bindCPU(CPU);
const ASM = new Assembler();

const DISASM = {
    hex: (n, d = 2) => n.toString(16).toUpperCase().padStart(d, '0'),

    decode(addr, mem) {
        const fetch = (o = 0) => mem.read((addr + o) & 0xFFFF);
        let op = fetch(0);
        let len = 1;
        let prefix = '';
        let offset = 0;
        let hasOffset = false;

        // Prefix Check
        if (op === 0xDD || op === 0xFD) {
            prefix = (op === 0xDD) ? 'IX' : 'IY';
            op = fetch(1);
            len++;
        }

        let txt = 'UNK ' + this.hex(op);


        const r8 = ["B", "C", "D", "E", "H", "L", "(HL)", "A"];
        const r16 = ["BC", "DE", "HL", "SP"];
        const cond = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];

        // Helper to format (IX+d)
        const getIdx = (d) => `(${prefix}${d >= 0 ? '+' : ''}${d})`;
        const getR8 = (i) => {
            if (prefix && i === 6) return 'IDX_PLACEHOLDER'; // Determine offset later? 
            // Actually, if prefix, (HL) becomes (IX+d).
            // But we need the displacement byte which is usually the 3rd byte (len=3 or 4).
            // Logic: standard opcodes use HL. If prefix, we fetch displacement at specific point.
            if (prefix && ["H", "L", "(HL)"].includes(r8[i])) {
                if (i === 6) { hasOffset = true; return 'IDX'; }
                if (i === 4) return prefix === 'IX' ? 'IXH' : 'IYH';
                if (i === 5) return prefix === 'IX' ? 'IXL' : 'IYL';
            }
            return r8[i];
        };
        // NOTE: The simple structure below makes extensive replace hard.
        // We'll patch specifically for the instructions we verified.

        if (op === 0x00) txt = 'NOP';
        else if (op === 0x76) txt = 'HALT';
        else if (op === 0xD9) txt = 'EXX';
        else if (op === 0x08) txt = "EX AF, AF'";
        else if (op === 0xEB) txt = 'EX DE, HL';
        else if (op === 0xE3) txt = `EX (SP), ${prefix || 'HL'}`;
        else if (op === 0xF9) txt = `LD SP, ${prefix || 'HL'}`;
        // LD HL, nn (21) -> LD IX, nn
        else if (op === 0x21) {
            const nn = this.hex(fetch(len) | (fetch(len + 1) << 8), 4);
            txt = `LD ${prefix || 'HL'}, ${nn}`;
            len += 2;
        }

        else if (op === 0xCD) { txt = `CALL ${this.hex(fetch(1) | (fetch(2) << 8), 4)}`; len = 3; }
        else if (op === 0xC9) txt = 'RET';
        else if (op === 0xD3) { txt = `OUT (${this.hex(fetch(1))}), A`; len = 2; }
        else if (op === 0xDB) { txt = `IN A, (${this.hex(fetch(1))})`; len = 2; }
        else if (op === 0x18) { const d = fetch(1); txt = `JR ${d > 127 ? d - 256 : d}`; len = 2; }
        else if (op === 0x20) { const d = fetch(1); txt = `JR NZ, ${d > 127 ? d - 256 : d}`; len = 2; }
        else if (op === 0x28) { const d = fetch(1); txt = `JR Z, ${d > 127 ? d - 256 : d}`; len = 2; }
        else if (op === 0x30) { const d = fetch(1); txt = `JR NC, ${d > 127 ? d - 256 : d}`; len = 2; }
        else if (op === 0x38) { const d = fetch(1); txt = `JR C, ${d > 127 ? d - 256 : d}`; len = 2; }
        else if (op === 0x10) { const d = fetch(1); txt = `DJNZ ${d > 127 ? d - 256 : d}`; len = 2; }

        // LD (HL), n (36) -> LD (IX+d), n
        else if (op === 0x36) { // Covers 36 match (LD (HL), n)
            if (prefix) {
                const d = fetch(len);
                const n = fetch(len + 1);
                const ds = d > 127 ? d - 256 : d;
                txt = `LD ${getIdx(ds)}, ${this.hex(n)}`;
                len += 2; // d + n
            } else {
                txt = `LD (HL), ${this.hex(fetch(1))}`;
                len = 2;
            }
        }

        // LD r, n
        else if ((op & 0xC7) === 0x06) { txt = `LD ${r8[(op >> 3) & 7]}, ${this.hex(fetch(1))}`; len = 2; }
        // LD r, r'
        else if ((op & 0xC0) === 0x40 && op !== 0x76) {
            const d = (op >> 3) & 7;
            const s = op & 7;
            let dName = r8[d];
            let sName = r8[s];
            if (prefix && (d === 6 || s === 6)) {
                const disp = fetch(len);
                const ds = disp > 127 ? disp - 256 : disp;
                const idxStr = getIdx(ds);
                if (d === 6) dName = idxStr;
                if (s === 6) sName = idxStr;
                len++;
            }
            txt = `LD ${dName}, ${sName}`;
        }
        // LD rp, nn
        else if ((op & 0xCF) === 0x01) { txt = `LD ${r16[(op >> 4) & 3]}, ${this.hex(fetch(1) | (fetch(2) << 8), 4)}`; len = 3; }

        // INC/DEC 16-bit
        else if ((op & 0xCF) === 0x03) { txt = `INC ${r16[(op >> 4) & 3]}`; }
        else if ((op & 0xCF) === 0x0B) { txt = `DEC ${r16[(op >> 4) & 3]}`; }

        // LD A, (BC)/(DE) and LD (BC)/(DE), A
        else if (op === 0x02) txt = 'LD (BC), A';
        else if (op === 0x12) txt = 'LD (DE), A';
        else if (op === 0x0A) txt = 'LD A, (BC)';
        else if (op === 0x1A) txt = 'LD A, (DE)';

        // EX AF, AF'
        else if (op === 0x08) txt = "EX AF, AF'";

        // ADD HL, ss -> ADD IX, ss
        else if ((op & 0xCF) === 0x09) {
            let reg = r16[(op >> 4) & 3];
            if (prefix && reg === 'HL') reg = prefix;
            txt = `ADD ${prefix || 'HL'}, ${reg}`;
        }

        // ALU (HL)
        // ... handled below in generic ALU?
        // ALU A, r
        else if ((op & 0xC0) === 0x80) {
            const ops = ["ADD", "ADC", "SUB", "SBC", "AND", "XOR", "OR", "CP"];
            const rIdx = op & 7;
            let rName = r8[rIdx];
            // Handle Index
            if (prefix && rIdx === 6) {
                const d = fetch(len);
                const ds = d > 127 ? d - 256 : d;
                rName = getIdx(ds);
                len++;
            }
            txt = `${ops[(op >> 3) & 7]} A, ${rName}`;
        }


        // LD (nn), HL etc
        else if (op === 0x22) { txt = `LD (${this.hex(fetch(1) | (fetch(2) << 8), 4)}), HL`; len = 3; }
        else if (op === 0x2A) { txt = `LD HL, (${this.hex(fetch(1) | (fetch(2) << 8), 4)})`; len = 3; }
        else if (op === 0x32) { txt = `LD (${this.hex(fetch(1) | (fetch(2) << 8), 4)}), A`; len = 3; }
        else if (op === 0x3A) { txt = `LD A, (${this.hex(fetch(1) | (fetch(2) << 8), 4)})`; len = 3; }

        else if (op === 0xEB) txt = 'EX DE, HL';
        else if (op === 0x07) txt = 'RLCA';
        else if (op === 0x0F) txt = 'RRCA';
        else if (op === 0x17) txt = 'RLA';
        else if (op === 0x1F) txt = 'RRA';

        // JP cc, nn
        else if ((op & 0xC7) === 0xC2) {
            const cc = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"][(op >> 3) & 7];
            txt = `JP ${cc}, ${this.hex(fetch(1) | (fetch(2) << 8), 4)}`;
            len = 3;
        }
        else if (op === 0xC3) {
            txt = `JP ${this.hex(fetch(1) | (fetch(2) << 8), 4)}`;
            len = 3;
        }
        else if (op === 0xE9) {
            txt = `JP ${prefix ? '(' + prefix + ')' : '(HL)'}`;
        }

        // CALL cc, nn
        else if ((op & 0xC7) === 0xC4) {
            const cc = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"][(op >> 3) & 7];
            txt = `CALL ${cc}, ${this.hex(fetch(1) | (fetch(2) << 8), 4)}`;
            len = 3;
        }

        // RET cc
        else if ((op & 0xC7) === 0xC0) {
            const cc = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"][(op >> 3) & 7];
            txt = `RET ${cc}`;
        }

        // ALU A, r
        else if ((op & 0xC0) === 0x80) {
            const ops = ["ADD", "ADC", "SUB", "SBC", "AND", "XOR", "OR", "CP"];
            txt = `${ops[(op >> 3) & 7]} A, ${r8[op & 7]}`;
        }
        // ALU n
        else if ((op & 0xC7) === 0xC6) {
            const ops = ["ADD", "ADC", "SUB", "SBC", "AND", "XOR", "OR", "CP"];
            txt = `${ops[(op >> 3) & 7]} A, ${this.hex(fetch(1))}`;
            len = 2;
        }

        // INC/DEC r
        else if ((op & 0xC7) === 0x04) txt = `INC ${r8[(op >> 3) & 7]}`;
        else if ((op & 0xC7) === 0x05) txt = `DEC ${r8[(op >> 3) & 7]}`;

        // PUSH/POP
        else if ((op & 0xCF) === 0xC5) {
            let r = ["BC", "DE", "HL", "AF"][(op >> 4) & 3];
            if (prefix && r === 'HL') r = prefix;
            txt = `PUSH ${r}`;
        }
        else if ((op & 0xCF) === 0xC1) {
            let r = ["BC", "DE", "HL", "AF"][(op >> 4) & 3];
            if (prefix && r === 'HL') r = prefix;
            txt = `POP ${r}`;
        }

        // 16-bit
        else if (op === 0x21) { txt = `LD HL, ${this.hex(fetch(1) | (fetch(2) << 8), 4)}`; len = 3; }

        else if (op === 0x2F) txt = 'CPL';
        else if (op === 0x3F) txt = 'CCF';
        else if (op === 0x37) txt = 'SCF';
        else if (op === 0x76) txt = 'HALT';
        else if (op === 0xF3) txt = 'DI';
        else if (op === 0xFB) txt = 'EI';
        else if ((op & 0xC7) === 0xC7) txt = `RST ${this.hex(op & 0x38)}`;

        // CB
        else if (op === 0xCB) {
            const sub = fetch(1);
            len = 2;
            const bit = (sub >> 3) & 7;
            const r = r8[sub & 7];
            if ((sub & 0xC0) === 0x40) txt = `BIT ${bit}, ${r}`;
            else if ((sub & 0xC0) === 0x80) txt = `RES ${bit}, ${r}`;
            else if ((sub & 0xC0) === 0xC0) txt = `SET ${bit}, ${r}`;
            else {
                const rot = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SLL", "SRL"];
                txt = `${rot[(sub >> 3) & 7]} ${r}`;
            }
        }

        // ED
        else if (op === 0xED) {
            const sub = fetch(1);
            len = 2;
            if ((sub & 0xCF) === 0x42) txt = `SBC HL, ${r16[(sub >> 4) & 3]}`;
            else if ((sub & 0xCF) === 0x4A) txt = `ADC HL, ${r16[(sub >> 4) & 3]}`;
            else if (sub === 0x79) txt = 'OUT (C), A';
            else if (sub === 0x78) txt = 'IN A, (C)';
            else if (sub === 0x44) txt = 'NEG';
            else if (sub === 0x46) txt = 'IM 0';
            else if (sub === 0x56) txt = 'IM 1';
            else if (sub === 0x5E) txt = 'IM 2';
            else if (sub === 0x45) txt = 'RETN';
            else if (sub === 0x4D) txt = 'RETI';
            else if ((sub & 0xA7) === 0xA0) { // Block Ops
                const blk = ["LDI", "CPI", "INI", "OUTI", "LDD", "CPD", "IND", "OUTD"];
                const idx = ((sub >> 3) & 3) | ((sub & 3) << 2); // Map vaguely? No simpler:
                // A0=LDI, A1=CPI, A2=INI, A3=OUTI
                // A8=LDD, A9=CPD, AA=IND, AB=OUTD
                // Just hex map
                if (sub === 0xA0) txt = "LDI"; else if (sub === 0xB0) txt = "LDIR";
                else if (sub === 0xA8) txt = "LDD"; else if (sub === 0xB8) txt = "LDDR";
                else txt = 'ED ' + this.hex(sub);
            }
            else txt = 'ED ' + this.hex(sub);
        }

        const bytes = [];
        for (let k = 0; k < len; k++) bytes.push(this.hex(fetch(k)));
        return { txt, len, bytes: bytes.join(' ') };
    },

    getLines(pc, mem, count = 5) {
        const l = [];
        let addr = pc;
        for (let i = 0; i < count; i++) {
            const d = this.decode(addr, mem);
            l.push(`<div${i === 0 ? ' style="color:yellow"' : ''}>${this.hex(addr, 4)}: <span style="color:#aaa">${d.bytes.padEnd(8)}</span> ${d.txt}</div>`);
            addr = (addr + d.len) & 0xFFFF;
        }
        return l.join('');
    },

};



// Main Controller
const Main = {
    timer: null,
    lastAssembledSource: null,
    breakpoints: new Set(),

    init() {
        try {
            Hardware.init();

            // Console Log Toggle
            this.logEnabled = false;
            const chkLog = document.getElementById('chk-log-output');
            if (chkLog) {
                chkLog.addEventListener('change', (e) => {
                    this.logEnabled = e.target.checked;
                });
            }

            this.bindEvents();

            // Auto-load
            const saved = localStorage.getItem('z80_source');
            if (saved) document.getElementById('source-code').value = saved;

            this.updateLineNumbers();
            this.updateDebug();

            // Init Speed Label
            const spdIdx = parseInt(document.getElementById('clock-speed').value);
            const spdVal = this.SPEED_LEVELS[spdIdx];
            document.getElementById('speed-val').innerText = (spdVal > 10000000) ? 'MAX' : spdVal;

            // Init Sample Selector
            if (typeof SAMPLES !== 'undefined') {
                const sel = document.getElementById('sample-selector');
                if (sel) {
                    Object.keys(SAMPLES).forEach(name => {
                        const opt = document.createElement('option');
                        opt.value = name;
                        opt.innerText = name;
                        sel.appendChild(opt);
                    });
                    sel.onchange = (e) => {
                        const name = e.target.value;
                        if (!name) return;
                        const code = SAMPLES[name];
                        if (document.getElementById('source-code').value.trim().length > 0) {
                            if (!confirm('Load sample code? Current code will be overwritten.')) {
                                sel.value = "";
                                return;
                            }
                        }
                        this.stop();
                        document.getElementById('source-code').value = code;
                        this.updateLineNumbers();
                        localStorage.setItem('z80_source', code);
                        sel.value = ""; // Reset selector
                    };
                }
            }
            this.initResizer();
        } catch (e) {
            console.error("Initialization Failed:", e);
            document.getElementById('status-bar').innerText = "System Error: " + e.message;
        }
    },

    initResizer() {
        const resizer = document.getElementById('drag-splitter');
        const idePane = document.querySelector('.ide-pane');
        if (!resizer || !idePane) return;

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none'; // Prevent text selection
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX; // Left pane width follows mouse X
            // Min/Max constraints
            if (newWidth > 350 && newWidth < window.innerWidth - 350) {
                idePane.style.width = newWidth + 'px';
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('resizing');
                document.body.style.cursor = 'default';
                document.body.style.userSelect = '';
            }
        });
    },

    bindEvents() {
        // File Open
        const fileInput = document.getElementById('file-input');
        document.getElementById('btn-open').onclick = () => {
            this.stop();
            fileInput.click();
        };
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const src = e.target.result;
                document.getElementById('source-code').value = src;
                this.updateLineNumbers();
                localStorage.setItem('z80_source', src);
                // Reset file input so same file can be selected again
                fileInput.value = '';
            };
            reader.readAsText(file);
        };

        document.getElementById('btn-save').onclick = () => {
            this.stop();
            this.saveFile();
        };
        document.getElementById('btn-listing').onclick = () => this.downloadListing();
        document.getElementById('btn-assemble').onclick = () => {
            this.stop();
            this.assemble();
        };
        document.getElementById('btn-step').onclick = () => this.step();
        document.getElementById('btn-run').onclick = () => this.run();
        document.getElementById('btn-stop').onclick = () => this.stop();
        document.getElementById('btn-reset').onclick = () => this.reset();

        const speedRange = document.getElementById('clock-speed');
        speedRange.oninput = () => {
            const idx = parseInt(speedRange.value);
            const val = this.SPEED_LEVELS[idx];
            document.getElementById('speed-val').innerText = (val > 10000000) ? 'MAX' : val;
        };

        const editor = document.getElementById('source-code');
        editor.addEventListener('input', () => {
            this.updateLineNumbers();
            localStorage.setItem('z80_source', editor.value);
        });
        editor.addEventListener('scroll', () => document.getElementById('line-numbers').scrollTop = editor.scrollTop);

        document.getElementById('line-numbers').onclick = (e) => {
            if (e.target.tagName === 'DIV') {
                const line = parseInt(e.target.innerText);
                if (!isNaN(line)) this.toggleBreakpoint(line);
            }
        };

        document.getElementById('chk-hex').addEventListener('change', () => this.updateDebug());
    },

    toggleBreakpoint(line) {
        if (this.breakpoints.has(line)) {
            this.breakpoints.delete(line);
        } else {
            this.breakpoints.add(line);
        }
        this.updateLineNumbers();
    },

    loadVerification() {
        document.getElementById('source-code').value = VERIFICATION_SOURCE;
        this.updateLineNumbers();
        this.assemble();
        this.updateStatus('READY');
        document.getElementById('status-bar').innerText = "Verification Suite Loaded & Assembled. Press Run.";
    },

    updateStatus(state) {
        const el = document.getElementById('execution-state');
        if (el) {
            el.innerText = state;
            el.style.color = (state === 'RUNNING') ? '#0f0' : (state === 'PAUSED' || state === 'STOPPED') ? 'yellow' : '#fff';
        }
    },

    saveFile() {
        const src = document.getElementById('source-code').value;
        const blob = new Blob([src], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'source.asm';
        a.click();
        URL.revokeObjectURL(url);
    },

    downloadListing() {
        if (!ASM || !ASM.listing) {
            alert("No listing available. Please Assemble first.");
            return;
        }
        const blob = new Blob([ASM.listing], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'listing.txt';
        a.click();
        URL.revokeObjectURL(url);
    },

    updateLineNumbers(autoScroll = false) {
        const editor = document.getElementById('source-code');
        const gutter = document.getElementById('line-numbers');
        const lines = editor.value.split('\n').length;
        const srcLine = ASM.sourceMap[CPU.reg.PC] || -1;

        let html = '';
        for (let i = 1; i < lines; i++) {
            let cls = '';
            if (i === srcLine) cls += ' highlight-line';
            if (this.breakpoints.has(i)) cls += ' breakpoint';
            html += `<div class="${cls.trim()}">${i}</div>`;
        }
        gutter.innerHTML = html;

        if (autoScroll && srcLine > 0 && gutter.children[srcLine - 1]) {
            const el = gutter.children[srcLine - 1];
            const top = el.offsetTop;
            const h = editor.clientHeight;
            // Center the line
            editor.scrollTop = top - h / 2;
        }
    },

    assemble() {
        const src = document.getElementById('source-code').value;
        try {
            const bin = ASM.assemble(src);
            MEM.reset();
            MEM.load(0, bin);


            if (this.logEnabled && ASM.listing) {
                console.log(ASM.listing);
            }

            CPU.reset();
            this.lastAssembledSource = src;
            this.updateDebug();

            const msg = `Assemble Success: ${bin.length} bytes`;
            document.getElementById('status-bar').innerText = msg;
            this.updateStatus('READY');
        } catch (e) {
            console.error(e);
            const msg = `Assemble Error: ${e.message}`;
            document.getElementById('status-bar').innerText = msg;
            this.updateStatus('ERROR');
            alert(msg); // Force visibility
        }
    },

    step() {
        const src = document.getElementById('source-code').value;
        if (src !== this.lastAssembledSource) this.assemble();

        try {
            CPU.step();
            this.updateDebug();
            this.updateLineNumbers(true); // Update highlight & Scroll
        } catch (e) {
            console.error(e);
            document.getElementById('status-bar').innerText = `Runtime Error: ${e.message}`;
            this.updateStatus('ERROR');
        }
        this.updateStatus('STEPPED');
    },

    SPEED_LEVELS: [10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 99999999], // Last is Max

    run() {
        const src = document.getElementById('source-code').value;
        if (src !== this.lastAssembledSource) this.assemble();

        // Debug: Dump Key Map


        if (this.timer) return;
        document.getElementById('btn-step').disabled = true;
        this.updateStatus('RUNNING');

        let steps = 0;
        this.perfTimer = setInterval(() => {
            document.getElementById('perf-hz').innerText = steps;
            steps = 0;
        }, 1000);

        // If currently on a breakpoint, step once to move off it
        const currentLine = ASM.sourceMap[CPU.reg.PC];
        if (this.breakpoints.has(currentLine)) {
            try {
                CPU.step();
                this.updateDebug();
                this.updateLineNumbers(true);
                if (CPU.halted) { this.stop(); return; }
            } catch (e) {
                this.stop();
                console.error(e);
                document.getElementById('status-bar').innerText = `Runtime Error: ${e.message}`;
                return;
            }
        }

        const runLoop = () => {
            const idx = parseInt(document.getElementById('clock-speed').value);
            const speed = this.SPEED_LEVELS[idx] || 1000;
            const isTurbo = (idx === this.SPEED_LEVELS.length - 1);

            let batch = 1;
            let interval = 1000 / speed;

            // For high speeds, use batching to overcome browser timer limits
            if (speed >= 100) {
                interval = 10; // ~100Hz refresh
                batch = Math.round(speed / 100);
            }
            if (isTurbo) {
                batch = 50000; // Large batch for max speed
            }
            if (batch < 1) batch = 1;

            for (let i = 0; i < batch; i++) {
                if (CPU.halted) break;



                if (steps % 100 === 0) {
                    if (Main.logEnabled) console.log(`PC Trace: ${DISASM.hex(CPU.reg.PC, 4)}`);
                }

                // Check Breakpoints
                const line = ASM.sourceMap[CPU.reg.PC];
                if (this.breakpoints.has(line)) {
                    this.stop();
                    document.getElementById('status-bar').innerText = `Breakpoint at line ${line}`;
                    this.updateStatus('PAUSED');
                    return;
                }

                try {
                    CPU.step();
                    steps++;
                } catch (e) {
                    this.stop();
                    console.error(e);
                    document.getElementById('status-bar').innerText = `Runtime Error: ${e.message}`;
                    return;
                }
            }

            if (!CPU.halted) this.timer = setTimeout(runLoop, interval);
            else this.stop(); // Ensure UI updates on Halt
        };
        runLoop();
    },

    stop() {
        if (this.timer) clearTimeout(this.timer);
        if (this.perfTimer) clearInterval(this.perfTimer);
        this.timer = null;
        this.perfTimer = null;
        this.perfTimer = null;
        // CPU.halted = true; // Incorrect: Do not force CPU Halt on UI Stop.
        document.getElementById('btn-step').disabled = false;
        this.updateDebug();
        this.updateLineNumbers(true); // Ensure final state is visible
        this.updateStatus('STOPPED');
    },



    reset() {
        this.stop();
        CPU.reset();
        MEM.reset();
        this.updateDebug();
        this.updateLineNumbers();
        this.updateStatus('RESET');
    },

    /**
     * Run simulation in headless mode for automated testing.
     * @param {string} sourceCode - Z80 assembly source code.
     * @param {number} maxCycles - Maximum cycles to execute (safety limit).
     * @returns {object} Result of the run.
     */
    runHeadless(sourceCode, maxCycles = 100000) {
        // 1. Assemble
        try {
            const bin = ASM.assemble(sourceCode);
            MEM.reset();
            MEM.load(0, bin);
            CPU.reset();
        } catch (e) {
            return {
                success: false,
                halted: false,
                cycles: 0,
                ports: {},
                error: "Assemble Error: " + e.message
            };
        }

        // 2. Run
        let cycles = 0;
        let error = null;
        const capturedPorts = { 0x00: 0, 0x10: 0, 0x17: 0 }; // Default verify ports

        // Hook IO for capture (Temporary override)
        const originalOut = IO.out;
        IO.out = (port, value) => {
            capturedPorts[port] = value;
            originalOut.call(IO, port, value);
        };

        try {
            while (!CPU.halted && cycles < maxCycles) {
                CPU.step();
                cycles++;
            }
        } catch (e) {
            error = "Runtime Error: " + e.message;
        } finally {
            IO.out = originalOut; // Restore
        }

        // 3. Result
        return {
            success: !error && CPU.halted, // Success implies clean Halt
            halted: CPU.halted,
            cycles: cycles,
            ports: capturedPorts,
            error: error
        };
    },

    updateDebug() {
        const reg = CPU.reg;
        const hex = document.getElementById('chk-hex').checked;
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };

        // Ensure we don't clear breakpoint visuals when updating debug
        // Actually updateLineNumbers handles it.

        const fmt = (n, w) => {
            if (hex) return n.toString(16).toUpperCase().padStart(w, '0');
            return n.toString().padStart(Math.ceil(w * 2.4), '\u00A0'); // 2.4 digits per byte approx, use nbsp for padding logic if needed or just space.
            // Actually, for decimal just raw number is fine, maybe padStart 3 or 5.
            // 8-bit: max 255 (3 chars). 16-bit: max 65535 (5 chars).
        };
        const fmt8 = (n) => hex ? '0x' + n.toString(16).toUpperCase().padStart(2, '0') : n.toString().padStart(3, '0');
        const fmt16 = (n) => hex ? '0x' + n.toString(16).toUpperCase().padStart(4, '0') : n.toString().padStart(5, '0');

        // Pairs
        set('reg-af', fmt16((reg.A << 8) | reg.F));
        set('reg-bc', fmt16((reg.B << 8) | reg.C));
        set('reg-de', fmt16((reg.D << 8) | reg.E));
        set('reg-hl', fmt16((reg.H << 8) | reg.L));

        // Singles
        set('reg-a', fmt8(reg.A));
        set('reg-f', fmt8(reg.F));
        set('reg-b', fmt8(reg.B));
        set('reg-c', fmt8(reg.C));
        set('reg-d', fmt8(reg.D));
        set('reg-e', fmt8(reg.E));
        set('reg-h', fmt8(reg.H));
        set('reg-l', fmt8(reg.L));

        // Special
        set('reg-pc', fmt16(reg.PC));
        set('reg-sp', fmt16(reg.SP));
        set('reg-ix', fmt16(reg.IX));
        set('reg-iy', fmt16(reg.IY));

        // Shadow Registers
        const regP = CPU.reg_prime;
        set('reg-af-prime', fmt16((regP.A << 8) | regP.F));
        set('reg-bc-prime', fmt16((regP.B << 8) | regP.C));
        set('reg-de-prime', fmt16((regP.D << 8) | regP.E));
        set('reg-hl-prime', fmt16((regP.H << 8) | regP.L));

        // Flags
        const f = reg.F;
        const flags =
            (f & 0x80 ? 'S' : '-') + (f & 0x40 ? 'Z' : '-') + (f & 0x20 ? 'Y' : '-') + (f & 0x10 ? 'H' : '-') +
            (f & 0x08 ? 'X' : '-') + (f & 0x04 ? 'P' : '-') + (f & 0x02 ? 'N' : '-') + (f & 0x01 ? 'C' : '-');
        set('reg-flags', flags);

        // Disassembly
        document.getElementById('disasm-view').innerHTML = DISASM.getLines(reg.PC, MEM, 6);
        this.updateMemView();
    },

    copyDebugInfo() {
        const reg = CPU.reg;
        const toHex8 = (n) => '0x' + n.toString(16).toUpperCase().padStart(2, '0');
        const toHex16 = (n) => '0x' + n.toString(16).toUpperCase().padStart(4, '0');
        const f = reg.F;
        const flags =
            (f & 0x80 ? 'S' : '-') + (f & 0x40 ? 'Z' : '-') + (f & 0x20 ? 'Y' : '-') + (f & 0x10 ? 'H' : '-') +
            (f & 0x08 ? 'X' : '-') + (f & 0x04 ? 'P' : '-') + (f & 0x02 ? 'N' : '-') + (f & 0x01 ? 'C' : '-');

        const regP = CPU.reg_prime;

        const info =
            `Registers:
AF: ${toHex16((reg.A << 8) | reg.F)} (A:${toHex8(reg.A)} F:${toHex8(reg.F)})
BC: ${toHex16((reg.B << 8) | reg.C)} (B:${toHex8(reg.B)} C:${toHex8(reg.C)})
DE: ${toHex16((reg.D << 8) | reg.E)} (D:${toHex8(reg.D)} E:${toHex8(reg.E)})
HL: ${toHex16((reg.H << 8) | reg.L)} (H:${toHex8(reg.H)} L:${toHex8(reg.L)})
AF': ${toHex16((regP.A << 8) | regP.F)}
BC': ${toHex16((regP.B << 8) | regP.C)}
DE': ${toHex16((regP.D << 8) | regP.E)}
HL': ${toHex16((regP.H << 8) | regP.L)}
PC: ${toHex16(reg.PC)}  SP: ${toHex16(reg.SP)}
IX: ${toHex16(reg.IX)}  IY: ${toHex16(reg.IY)}
Flags: ${flags}`;

        navigator.clipboard.writeText(info).then(() => {
            const btn = document.querySelector('button[onclick="Main.copyDebugInfo()"]');
            const originalText = btn.innerText;
            btn.innerText = "Copied!";
            setTimeout(() => btn.innerText = originalText, 1000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            alert("Failed to copy to clipboard.");
        });
    },

    updateMemView() {
        const el = document.getElementById('mem-addr-input');
        if (!el) return;
        if (this.dumped) return;
        const start = 0x01D0; // DIV_10
        const end = 0x01E0;
        let addr = parseInt(el.value, 16) || 0;
        let html = '';
        for (let i = 0; i < 4; i++) { // 4 lines
            const currentAddr = addr & 0xFFFF;
            let row = DISASM.hex(currentAddr, 4) + ': ';
            for (let j = 0; j < 16; j++) { // 16 bytes per line
                row += DISASM.hex(MEM.read((currentAddr + j) & 0xFFFF), 2) + ' ';
            }
            html += `<div>${row}</div>`;
            addr += 16;
        }
        document.getElementById('mem-view').innerHTML = html;
    },
    dumpMemory() {
        let content = "--- MEMORY DUMP ---\n";
        let addr = 0;
        const limit = 0x10000;
        let zeroStart = -1;

        while (addr < limit) {
            let row = DISASM.hex(addr, 4) + ': ';
            let ascii = '';
            let allZero = true;

            for (let j = 0; j < 16; j++) {
                const v = MEM.read(addr + j);
                row += DISASM.hex(v, 2) + ' ';
                ascii += (v >= 32 && v <= 126) ? String.fromCharCode(v) : '.';
                if (v !== 0) allZero = false;
            }

            if (allZero) {
                if (zeroStart === -1) zeroStart = addr;
            } else {
                // Flush zero block if exits
                if (zeroStart !== -1) {
                    const count = (addr - zeroStart) / 16;
                    if (count > 0) {
                        // Only skip if more than 1 line, or just always show summary?
                        // User said "indicate skipped".
                        content += `${DISASM.hex(zeroStart, 4)} - ${DISASM.hex(addr - 1, 4)} : ... (Skipped ${count} lines of all zeros)\n`;
                    }
                    zeroStart = -1;
                }
                content += row + ' | ' + ascii + '\n';
            }

            addr += 16;
        }

        // Final flush
        if (zeroStart !== -1) {
            const count = (limit - zeroStart) / 16;
            content += `${DISASM.hex(zeroStart, 4)} - ${DISASM.hex(limit - 1, 4)} : ... (Skipped ${count} lines of all zeros)\n`;
        }

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'memory_dump.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    dumpDisasm() {
        let content = "--- DISASSEMBLY DUMP ---\n";
        let addr = 0;
        const limit = 0x10000; // Full 64KB

        let nopStart = -1;

        while (addr < limit) {
            const d = DISASM.decode(addr, MEM);

            // Check for NOP (0x00)
            if (d.bytes === '00') {
                if (nopStart === -1) nopStart = addr;
            } else {
                // Flush NOPs if any
                if (nopStart !== -1) {
                    const count = addr - nopStart;
                    if (count > 15) {
                        content += `${DISASM.hex(nopStart, 4)} - ${DISASM.hex(addr - 1, 4)} : ... (Skipped ${count} NOPs)\n`;
                    } else {
                        content += `${DISASM.hex(nopStart, 4)}: 00       NOP\n`;
                    }
                    nopStart = -1;
                }

                // Print current instruction
                content += `${DISASM.hex(addr, 4)}: ${d.bytes.padEnd(8)} ${d.txt}\n`;
            }

            addr += d.len;
        }

        // Final flush
        if (nopStart !== -1) {
            content += `${DISASM.hex(nopStart, 4)} - ${DISASM.hex(limit - 1, 4)} : ... (Skipped ${limit - nopStart} NOPs)\n`;
        }

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'disassembly_dump.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};

window.onload = () => Main.init();
// End of script

